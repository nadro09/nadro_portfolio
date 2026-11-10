'use strict';
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../../db');
const { requirePerm, hasPermission } = require('../../auth');
const H = require('../../helpers');

const centers = express.Router();
const wilayas = express.Router();
const users = express.Router();

// ================= CENTERS =================
centers.get('/', requirePerm('centers.view'), async (req, res, next) => {
  try {
    const params = [req.user.scopeCenterId];
    let where = `c.deleted_at IS NULL AND ($1::int IS NULL OR c.id = $1::int)`;
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      where += ` AND (c.name_ar ILIKE $${params.length} OR c.name_fr ILIKE $${params.length}
                 OR c.code ILIKE $${params.length} OR c.city_ar ILIKE $${params.length})`;
    }
    if (req.query.wilaya) {
      params.push(parseInt(req.query.wilaya, 10));
      where += ` AND c.wilaya_id = $${params.length}`;
    }
    if (req.query.status === 'active') where += ' AND c.is_active = true';
    if (req.query.status === 'inactive') where += ' AND c.is_active = false';
    const { rows } = await pool.query(
      `SELECT c.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr,
              (SELECT count(*)::int FROM employees e WHERE e.center_id = c.id AND e.deleted_at IS NULL) AS staff_count,
              (SELECT count(*)::int FROM bookings b WHERE b.center_id = c.id AND b.deleted_at IS NULL) AS bookings_count
       FROM centers c JOIN wilayas w ON w.id = c.wilaya_id
       WHERE ${where} ORDER BY c.is_active DESC, w.id, c.name_ar`, params
    );
    const wil = await pool.query('SELECT id, name_ar, name_fr FROM wilayas ORDER BY id');
    res.render('admin/centers', {
      title: res.locals.t('centers_manage'), active: 'centers', centers: rows,
      wilayas: wil.rows, filters: req.query,
    });
  } catch (err) { next(err); }
});

async function centerFormData() {
  const [wil, services] = await Promise.all([
    pool.query('SELECT id, name_ar, name_fr FROM wilayas ORDER BY id'),
    pool.query('SELECT id, name_ar, name_fr FROM services ORDER BY sort_order'),
  ]);
  return { wilayas: wil.rows, services: services.rows };
}

centers.get('/new', requirePerm('centers.manage'), async (req, res, next) => {
  try {
    const data = await centerFormData();
    res.render('admin/center-form', {
      title: res.locals.t('add_center'), active: 'centers', center: null, selectedServices: [], ...data, errors: [],
    });
  } catch (err) { next(err); }
});

centers.get('/:id/edit', requirePerm('centers.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT * FROM centers WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    const data = await centerFormData();
    const svc = await pool.query('SELECT service_id FROM center_services WHERE center_id = $1', [id]);
    res.render('admin/center-form', {
      title: res.locals.t('edit_center'), active: 'centers', center: rows[0],
      selectedServices: svc.rows.map((r) => r.service_id), ...data, errors: [],
    });
  } catch (err) { next(err); }
});

centers.post('/save', requirePerm('centers.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.body.id, 10) || null;
    const data = await centerFormData();
    const values = {
      code: String(req.body.code || '').trim().toUpperCase(),
      name_ar: String(req.body.name_ar || '').trim(),
      name_fr: String(req.body.name_fr || '').trim(),
      wilaya_id: parseInt(req.body.wilaya_id, 10) || null,
      city_ar: String(req.body.city_ar || '').trim(),
      city_fr: String(req.body.city_fr || '').trim(),
      address_ar: String(req.body.address_ar || '').trim(),
      address_fr: String(req.body.address_fr || '').trim(),
      latitude: req.body.latitude ? Number(req.body.latitude) : null,
      longitude: req.body.longitude ? Number(req.body.longitude) : null,
      phone_primary: String(req.body.phone_primary || '').trim(),
      phone_secondary: String(req.body.phone_secondary || '').trim(),
      email: String(req.body.email || '').trim(),
      opening_hours_ar: String(req.body.opening_hours_ar || '').trim(),
      opening_hours_fr: String(req.body.opening_hours_fr || '').trim(),
      is_active: req.body.is_active === 'on',
    };
    const errors = [];
    if (!values.code) errors.push({ field: 'code', message: res.locals.t('field_required') });
    if (!values.name_ar || !values.name_fr) errors.push({ field: 'name_ar', message: res.locals.t('field_required') });
    if (!values.wilaya_id) errors.push({ field: 'wilaya_id', message: res.locals.t('field_required') });
    if (!values.city_ar) errors.push({ field: 'city_ar', message: res.locals.t('field_required') });
    if (values.latitude !== null && (Number.isNaN(values.latitude) || Math.abs(values.latitude) > 90)) {
      errors.push({ field: 'latitude', message: res.locals.t('field_required') });
    }
    if (values.longitude !== null && (Number.isNaN(values.longitude) || Math.abs(values.longitude) > 180)) {
      errors.push({ field: 'longitude', message: res.locals.t('field_required') });
    }
    if (errors.length) {
      return res.status(422).render('admin/center-form', {
        title: id ? res.locals.t('edit_center') : res.locals.t('add_center'), active: 'centers',
        center: { ...values, id }, selectedServices: [].concat(req.body.services || []).map(Number), ...data, errors,
      });
    }
    let centerId = id;
    if (id) {
      await pool.query(
        `UPDATE centers SET code=$2, name_ar=$3, name_fr=$4, wilaya_id=$5, city_ar=$6, city_fr=$7,
           address_ar=$8, address_fr=$9, latitude=$10, longitude=$11, phone_primary=$12, phone_secondary=$13,
           email=$14, opening_hours_ar=$15, opening_hours_fr=$16, is_active=$17 WHERE id=$1`,
        [id, values.code, values.name_ar, values.name_fr, values.wilaya_id, values.city_ar, values.city_fr,
          values.address_ar, values.address_fr, values.latitude, values.longitude, values.phone_primary,
          values.phone_secondary, values.email || null, values.opening_hours_ar, values.opening_hours_fr, values.is_active]
      );
      const old = await pool.query('SELECT * FROM centers WHERE id = $1', [id]);
      await H.audit(req, { action: 'center_updated', entityType: 'center', entityId: id, oldValues: old.rows[0], newValues: values });
    } else {
      const ins = await pool.query(
        `INSERT INTO centers (code, name_ar, name_fr, wilaya_id, city_ar, city_fr, address_ar, address_fr,
           latitude, longitude, phone_primary, phone_secondary, email, opening_hours_ar, opening_hours_fr, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [values.code, values.name_ar, values.name_fr, values.wilaya_id, values.city_ar, values.city_fr,
          values.address_ar, values.address_fr, values.latitude, values.longitude, values.phone_primary,
          values.phone_secondary, values.email || null, values.opening_hours_ar, values.opening_hours_fr, values.is_active]
      );
      centerId = ins.rows[0].id;
      await H.audit(req, { action: 'center_created', entityType: 'center', entityId: centerId, newValues: values });
      await H.notifyPermission('centers.view', {
        type: 'center_added', titleAr: 'تمت إضافة مركز', titleFr: 'Nouveau centre ajouté',
        bodyAr: values.name_ar, bodyFr: values.name_fr,
        link: `/admin/centers/${centerId}`, entityType: 'center', entityId: centerId,
      }, { excludeEmployeeId: req.user.id });
    }
    const serviceIds = [].concat(req.body.services || []).map(Number).filter(Boolean);
    await pool.query('DELETE FROM center_services WHERE center_id = $1', [centerId]);
    for (const sid of serviceIds) {
      await pool.query('INSERT INTO center_services (center_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [centerId, sid]);
    }
    req.session.flash = { type: 'success', message: res.locals.t('center_saved') };
    res.redirect(`/admin/centers/${centerId}`);
  } catch (err) {
    if (err.code === '23505') {
      req.session.flash = { type: 'error', message: res.locals.t('duplicate_phone') };
      return res.redirect(req.body.id ? `/admin/centers/${req.body.id}/edit` : '/admin/centers/new');
    }
    next(err);
  }
});

centers.get('/:id', requirePerm('centers.view'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (req.user.scopeCenterId && id !== req.user.scopeCenterId) {
      return res.status(403).render('errors/403', { title: res.locals.t('forbidden_title') });
    }
    const { rows } = await pool.query(
      `SELECT c.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr FROM centers c
       JOIN wilayas w ON w.id = c.wilaya_id WHERE c.id = $1 AND c.deleted_at IS NULL`, [id]
    );
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    const [staff, bookings, services] = await Promise.all([
      pool.query(`SELECT e.id, e.full_name, e.username, e.email, e.is_active, e.job_title_ar, e.job_title_fr,
                         string_agg(r.name_ar, '، ') AS roles
                  FROM employees e LEFT JOIN employee_roles er ON er.employee_id = e.id
                  LEFT JOIN roles r ON r.id = er.role_id
                  WHERE e.center_id = $1 AND e.deleted_at IS NULL GROUP BY e.id ORDER BY e.full_name`, [id]),
      pool.query(`SELECT b.*, s.name_ar AS service_ar, s.name_fr AS service_fr
                  FROM bookings b LEFT JOIN services s ON s.id = b.service_id
                  WHERE b.center_id = $1 AND b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 10`, [id]),
      pool.query(`SELECT s.name_ar, s.name_fr FROM center_services cs JOIN services s ON s.id = cs.service_id
                  WHERE cs.center_id = $1 ORDER BY s.sort_order`, [id]),
    ]);
    res.render('admin/center-detail', {
      title: rows[0].name_ar, active: 'centers', center: rows[0],
      staff: staff.rows, bookings: bookings.rows, services: services.rows,
    });
  } catch (err) { next(err); }
});

centers.post('/:id/toggle', requirePerm('centers.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `UPDATE centers SET is_active = NOT is_active WHERE id = $1 AND deleted_at IS NULL RETURNING is_active, name_ar, name_fr`, [id]
    );
    if (rows.length) {
      await H.audit(req, { action: rows[0].is_active ? 'center_activated' : 'center_deactivated', entityType: 'center', entityId: id });
    }
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect('back');
  } catch (err) { next(err); }
});

// ================= WILAYAS =================
wilayas.get('/', requirePerm('wilayas.view'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = '1=1';
    if (q) {
      params.push(`%${q}%`);
      where = `(w.name_ar ILIKE $1 OR w.name_fr ILIKE $1 OR w.id::text = $2)`;
      params.push(q);
    }
    const { rows } = await pool.query(
      `SELECT w.*,
              (SELECT count(*)::int FROM centers c WHERE c.wilaya_id = w.id AND c.deleted_at IS NULL AND c.is_active) AS centers_count,
              (SELECT count(*)::int FROM centers c WHERE c.wilaya_id = w.id AND c.deleted_at IS NULL AND NOT c.is_active) AS inactive_centers,
              (SELECT count(*)::int FROM bookings b WHERE b.wilaya_id = w.id AND b.deleted_at IS NULL) AS bookings_count,
              (SELECT count(*)::int FROM customers cu WHERE cu.wilaya_id = w.id AND cu.deleted_at IS NULL) AS customers_count
       FROM wilayas w WHERE ${where} ORDER BY w.id`, params
    );
    res.render('admin/wilayas', {
      title: res.locals.t('wilayas_title'), active: 'wilayas', wilayas: rows, filters: { q },
    });
  } catch (err) { next(err); }
});

wilayas.post('/:id', requirePerm('wilayas.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const nameAr = String(req.body.name_ar || '').trim();
    const nameFr = String(req.body.name_fr || '').trim();
    if (nameAr && nameFr) {
      await pool.query('UPDATE wilayas SET name_ar = $2, name_fr = $3 WHERE id = $1', [id, nameAr, nameFr]);
      await H.audit(req, { action: 'wilaya_updated', entityType: 'wilaya', entityId: id, newValues: { nameAr, nameFr } });
    }
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect('/admin/wilayas');
  } catch (err) { next(err); }
});

// ================= USERS & ROLES =================
async function roleData() {
  const roles = await pool.query('SELECT * FROM roles ORDER BY id');
  const perms = await pool.query('SELECT * FROM permissions ORDER BY category, key');
  const map = await pool.query(
    `SELECT rp.role_id, p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`
  );
  const byRole = {};
  for (const r of map.rows) (byRole[r.role_id] ||= []).push(r.key);
  return { roles: roles.rows, permissions: perms.rows, byRole };
}

users.get('/', requirePerm('users.view'), async (req, res, next) => {
  try {
    const params = [req.user.scopeCenterId];
    let where = `e.deleted_at IS NULL AND ($1::int IS NULL OR e.center_id = $1::int)`;
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      where += ` AND (e.full_name ILIKE $${params.length} OR e.username ILIKE $${params.length} OR e.email ILIKE $${params.length})`;
    }
    if (req.query.role) {
      params.push(String(req.query.role));
      where += ` AND EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = e.id AND r.key = $${params.length})`;
    }
    if (req.query.status === 'active') where += ' AND e.is_active = true';
    if (req.query.status === 'inactive') where += ' AND e.is_active = false';
    const { rows } = await pool.query(
      `SELECT e.*, c.name_ar AS center_ar, c.name_fr AS center_fr,
              (SELECT string_agg(r.name_ar, '، ') FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = e.id) AS roles_ar,
              (SELECT string_agg(r.name_fr, ', ') FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = e.id) AS roles_fr
       FROM employees e LEFT JOIN centers c ON c.id = e.center_id
       WHERE ${where} ORDER BY e.is_active DESC, e.full_name`, params
    );
    const roles = await pool.query('SELECT key, name_ar, name_fr FROM roles ORDER BY id');
    const centersList = await pool.query('SELECT id, name_ar, name_fr FROM centers WHERE deleted_at IS NULL ORDER BY name_ar');
    res.render('admin/users', {
      title: res.locals.t('users'), active: 'users', users: rows, roles: roles.rows,
      centers: centersList.rows, filters: req.query,
    });
  } catch (err) { next(err); }
});

users.get('/roles', requirePerm('users.manage'), async (req, res, next) => {
  try {
    const data = await roleData();
    res.render('admin/roles', {
      title: res.locals.t('roles'), active: 'users', ...data,
    });
  } catch (err) { next(err); }
});

users.post('/roles/:id', requirePerm('users.manage'), async (req, res, next) => {
  try {
    const roleId = parseInt(req.params.id, 10);
    const role = (await pool.query('SELECT * FROM roles WHERE id = $1', [roleId])).rows[0];
    if (!role || role.key === 'super_admin') {
      req.session.flash = { type: 'error', message: res.locals.t('cannot_grant_higher') };
      return res.redirect('/admin/users/roles');
    }
    const keys = [].concat(req.body.permissions || []).filter((k) => typeof k === 'string');
    const allowed = await pool.query('SELECT key FROM permissions');
    const validKeys = new Set(allowed.rows.map((r) => r.key));
    const old = await pool.query(
      `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, [roleId]
    );
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const key of keys) {
      if (!validKeys.has(key)) continue;
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = $2 ON CONFLICT DO NOTHING`,
        [roleId, key]
      );
    }
    await H.audit(req, {
      action: 'role_permissions_updated', entityType: 'role', entityId: roleId,
      oldValues: { permissions: old.rows.map((r) => r.key) }, newValues: { permissions: keys },
    });
    const memberIds = await pool.query('SELECT employee_id FROM employee_roles WHERE role_id = $1', [roleId]);
    await H.notifyEmployees(memberIds.rows.map((r) => r.employee_id), {
      type: 'permissions_changed', titleAr: 'تم تحديث صلاحيات دورك', titleFr: 'Les permissions de votre rôle ont changé',
      bodyAr: role.name_ar, bodyFr: role.name_fr, link: '/admin/profile', entityType: 'role', entityId: roleId,
    });
    req.session.flash = { type: 'success', message: res.locals.t('role_saved') };
    res.redirect('/admin/users/roles');
  } catch (err) { next(err); }
});

async function userFormData(req) {
  const roles = await pool.query('SELECT * FROM roles ORDER BY id');
  const centersList = await pool.query(
    `SELECT id, name_ar, name_fr FROM centers WHERE deleted_at IS NULL
     ${req.user.scopeCenterId ? 'AND id = ' + Number(req.user.scopeCenterId) : ''} ORDER BY name_ar`
  );
  const byRole = await roleData();
  return { roles: roles.rows, centers: centersList.rows, permissionsByRole: byRole.byRole, allPermissions: byRole.permissions };
}

users.get('/new', requirePerm('users.manage'), async (req, res, next) => {
  try {
    const data = await userFormData(req);
    res.render('admin/user-form', {
      title: res.locals.t('add_user'), active: 'users', employee: null,
      selectedRoles: [], ...data, errors: [], tempPassword: null,
    });
  } catch (err) { next(err); }
});

users.get('/:id/edit', requirePerm('users.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    if (req.user.scopeCenterId && rows[0].center_id !== req.user.scopeCenterId && rows[0].id !== req.user.id) {
      return res.status(403).render('errors/403', { title: res.locals.t('forbidden_title') });
    }
    const selected = await pool.query('SELECT role_id FROM employee_roles WHERE employee_id = $1', [id]);
    const data = await userFormData(req);
    res.render('admin/user-form', {
      title: res.locals.t('edit_user'), active: 'users', employee: rows[0],
      selectedRoles: selected.rows.map((r) => r.role_id), ...data, errors: [], tempPassword: null,
    });
  } catch (err) { next(err); }
});

users.post('/save', requirePerm('users.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.body.id, 10) || null;
    const data = await userFormData(req);
    const fullName = String(req.body.full_name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const jobAr = String(req.body.job_title_ar || '').trim();
    const jobFr = String(req.body.job_title_fr || '').trim();
    const centerId = parseInt(req.body.center_id, 10) || null;
    const isActive = req.body.is_active === 'on';
    const selectedRoles = [].concat(req.body.roles || []).map(Number).filter(Boolean);
    const errors = [];
    if (fullName.length < 3) errors.push({ field: 'full_name', message: res.locals.t('field_required') });
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) errors.push({ field: 'username', message: res.locals.t('field_required') });
    if (!H.validEmail(email)) errors.push({ field: 'email', message: res.locals.t('invalid_email') });
    if (!selectedRoles.length) errors.push({ field: 'roles', message: res.locals.t('field_required') });

    const roleRows = await pool.query('SELECT * FROM roles WHERE id = ANY($1::int[])', [selectedRoles]);
    if (roleRows.rowCount !== selectedRoles.length) errors.push({ field: 'roles', message: res.locals.t('field_required') });

    // Cannot grant permissions beyond your own (super admin exempt).
    if (!hasPermission(req.user, 'settings.manage')) {
      const rolePerms = await roleData();
      const mine = new Set(req.user.permissions);
      for (const roleId of selectedRoles) {
        for (const key of (rolePerms.byRole[roleId] || [])) {
          if (!mine.has(key)) {
            errors.push({ field: 'roles', message: res.locals.t('cannot_grant_higher') });
            break;
          }
        }
      }
    }

    if (id === req.user.id) {
      const currentRoles = await pool.query('SELECT role_id FROM employee_roles WHERE employee_id = $1', [id]);
      const same = currentRoles.rows.map((r) => r.role_id).sort().join(',') === [...selectedRoles].sort().join(',');
      if (!same) errors.push({ field: 'roles', message: res.locals.t('cannot_edit_self_roles') });
      if (!isActive) errors.push({ field: 'is_active', message: res.locals.t('cannot_edit_self_roles') });
    }

    // Non all-centers roles need a center.
    const requiresCenter = roleRows.rows.some((r) => !r.all_centers);
    if (requiresCenter && !centerId) errors.push({ field: 'center_id', message: res.locals.t('field_required') });

    if (errors.length) {
      return res.status(422).render('admin/user-form', {
        title: id ? res.locals.t('edit_user') : res.locals.t('add_user'), active: 'users',
        employee: { id, full_name: fullName, username, email, phone, job_title_ar: jobAr, job_title_fr: jobFr, center_id: centerId, is_active: isActive },
        selectedRoles, ...data, errors, tempPassword: null,
      });
    }

    let employeeId = id;
    let tempPassword = null;
    if (id) {
      await pool.query(
        `UPDATE employees SET full_name=$2, username=$3, email=$4, phone=$5, job_title_ar=$6, job_title_fr=$7,
           center_id=$8, is_active=$9 WHERE id=$1`,
        [id, fullName, username, email, phone || null, jobAr || null, jobFr || null, centerId, isActive]
      );
      const old = await pool.query('SELECT full_name, username, email, center_id, is_active FROM employees WHERE id = $1', [id]);
      await H.audit(req, {
        action: 'employee_updated', entityType: 'employee', entityId: id,
        oldValues: old.rows[0], newValues: { full_name: fullName, username, email, centerId, isActive },
      });
    } else {
      tempPassword = 'Alf-' + crypto.randomBytes(4).toString('hex') + '1';
      const hash = await bcrypt.hash(tempPassword, 10);
      const settings = await H.getSettings();
      const min = parseInt(settings.password_min_length, 10) || 10;
      if (tempPassword.length < min) tempPassword = tempPassword + 'Aa1';
      const ins = await pool.query(
        `INSERT INTO employees (full_name, username, email, phone, password_hash, center_id, job_title_ar, job_title_fr,
           is_active, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
        [fullName, username, email, phone || null, await bcrypt.hash(tempPassword, 10), centerId, jobAr || null, jobFr || null, isActive]
      );
      employeeId = ins.rows[0].id;
      await H.audit(req, { action: 'employee_created', entityType: 'employee', entityId: employeeId, newValues: { fullName, username, email, centerId } });
    }

    await pool.query('DELETE FROM employee_roles WHERE employee_id = $1', [employeeId]);
    for (const roleId of selectedRoles) {
      await pool.query('INSERT INTO employee_roles (employee_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [employeeId, roleId]);
    }
    if (id) {
      await H.audit(req, { action: 'employee_roles_updated', entityType: 'employee', entityId: id, newValues: { roles: selectedRoles } });
    }

    if (employeeId !== req.user.id) {
      await H.notifyEmployees([employeeId], {
        type: id ? 'account_updated' : 'account_created',
        titleAr: id ? 'تم تحديث حسابك' : 'تم إنشاء حسابك',
        titleFr: id ? 'Votre compte a été mis à jour' : 'Votre compte a été créé',
        bodyAr: id ? 'راجع بياناتك وصلاحياتك في ملفك الشخصي.' : 'راجع بريدك أو تواصل مع الإدارة للحصول على كلمة المرور المؤقتة.',
        bodyFr: id ? 'Consultez vos informations et permissions dans votre profil.' : 'Contactez l’administration pour votre mot de passe temporaire.',
        link: '/admin/profile', entityType: 'employee', entityId: employeeId,
      });
    }

    if (tempPassword) {
      req.session.flash = { type: 'success', message: res.locals.t('user_saved') + ' — ' + res.locals.t('temp_password') + ': ' + tempPassword };
    } else {
      req.session.flash = { type: 'success', message: res.locals.t('user_saved') };
    }
    res.redirect('/admin/users');
  } catch (err) {
    if (err.code === '23505') {
      req.session.flash = { type: 'error', message: res.locals.t('duplicate_phone') };
      return res.redirect('/admin/users');
    }
    next(err);
  }
});

users.post('/:id/toggle', requirePerm('users.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) {
      req.session.flash = { type: 'error', message: res.locals.t('cannot_edit_self_roles') };
      return res.redirect('/admin/users');
    }
    const { rows } = await pool.query(
      'UPDATE employees SET is_active = NOT is_active WHERE id = $1 AND deleted_at IS NULL RETURNING is_active, full_name', [id]
    );
    if (rows.length) {
      await H.audit(req, { action: rows[0].is_active ? 'employee_activated' : 'employee_deactivated', entityType: 'employee', entityId: id });
      req.session.flash = { type: 'success', message: res.locals.t(rows[0].is_active ? 'user_activated' : 'user_deactivated') };
    }
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

users.post('/:id/reset-password', requirePerm('users.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) {
      req.session.flash = { type: 'error', message: res.locals.t('cannot_edit_self_roles') };
      return res.redirect('/admin/users');
    }
    const settings = await H.getSettings();
    const min = Math.max(8, parseInt(settings.password_min_length, 10) || 10);
    let temp = 'Alf-' + crypto.randomBytes(4).toString('hex') + '1';
    if (temp.length < min) temp += 'A1';
    const hash = await bcrypt.hash(temp, 10);
    await pool.query(
      'UPDATE employees SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL WHERE id = $1',
      [id, hash]
    );
    await H.audit(req, { action: 'password_reset', entityType: 'employee', entityId: id });
    req.session.flash = {
      type: 'success',
      message: res.locals.t('temp_password') + ': ' + temp + ' — ' + res.locals.t('temp_password_hint'),
    };
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

module.exports = { centers, wilayas, users };
