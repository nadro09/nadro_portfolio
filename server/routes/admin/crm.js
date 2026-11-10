'use strict';
const express = require('express');
const { pool } = require('../../db');
const { requirePerm } = require('../../auth');
const H = require('../../helpers');
const { MESSAGE_FLOW } = require('../../i18n');

const customers = express.Router();
const contactMessages = express.Router();

// ================= CUSTOMERS =================
async function loadCustomer(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `SELECT cu.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr, e.full_name AS assigned_name
       FROM customers cu
       LEFT JOIN wilayas w ON w.id = cu.wilaya_id
       LEFT JOIN employees e ON e.id = cu.assigned_employee_id
       WHERE cu.id = $1 AND cu.deleted_at IS NULL`, [id]
    );
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    req.customer = rows[0];
    next();
  } catch (err) { next(err); }
}

customers.get('/', requirePerm('customers.view'), async (req, res, next) => {
  try {
    const params = [req.user.scopeCenterId];
    let where = `cu.deleted_at IS NULL
      AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = cu.id AND b.center_id = $1::int))`;
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      where += ` AND (cu.full_name ILIKE $2 OR cu.phone ILIKE $2 OR coalesce(cu.email,'') ILIKE $2)`;
    }
    if (req.query.wilaya) {
      params.push(parseInt(req.query.wilaya, 10));
      where += ` AND cu.wilaya_id = $${params.length}`;
    }
    const total = await pool.query(`SELECT count(*)::int AS n FROM customers cu WHERE ${where}`, params);
    const pager = H.paginate(req, total.rows[0].n, 15);
    const listParams = [...params, pager.perPage, pager.offset];
    const { rows } = await pool.query(
      `SELECT cu.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr,
              (SELECT count(*)::int FROM bookings b WHERE b.customer_id = cu.id AND b.deleted_at IS NULL) AS bookings_count,
              (SELECT max(b.created_at) FROM bookings b WHERE b.customer_id = cu.id) AS last_booking
       FROM customers cu LEFT JOIN wilayas w ON w.id = cu.wilaya_id
       WHERE ${where} ORDER BY cu.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, listParams
    );
    const wilayas = await pool.query('SELECT id, name_ar, name_fr FROM wilayas ORDER BY id');
    res.render('admin/customers', {
      title: res.locals.t('customers_count'), active: 'customers', customers: rows, pager,
      filters: req.query, wilayas: wilayas.rows,
    });
  } catch (err) { next(err); }
});

customers.post('/', requirePerm('customers.edit'), async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name || '').trim();
    const phone = H.normalizePhone(req.body.phone);
    const email = String(req.body.email || '').trim();
    if (!fullName || !H.validPhone(phone)) {
      req.session.flash = { type: 'error', message: res.locals.t('required_error') };
      return res.redirect('/admin/customers');
    }
    const existing = await pool.query('SELECT id FROM customers WHERE phone = $1 AND deleted_at IS NULL', [phone]);
    if (existing.rowCount) {
      req.session.flash = { type: 'warning', message: res.locals.t('duplicate_phone') };
      return res.redirect(`/admin/customers/${existing.rows[0].id}`);
    }
    const ins = await pool.query(
      `INSERT INTO customers (full_name, phone, email, wilaya_id, city, notes, assigned_employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [fullName, phone, email || null, parseInt(req.body.wilaya_id, 10) || null,
        String(req.body.city || '').trim() || null, String(req.body.notes || '').trim() || null, req.user.id]
    );
    await H.audit(req, { action: 'customer_created', entityType: 'customer', entityId: ins.rows[0].id, newValues: { fullName, phone } });
    req.session.flash = { type: 'success', message: res.locals.t('customer_saved') };
    res.redirect(`/admin/customers/${ins.rows[0].id}`);
  } catch (err) { next(err); }
});

customers.get('/:id', requirePerm('customers.view'), loadCustomer, async (req, res, next) => {
  try {
    const [bookings, notes, contacts, staff, wilayas, centers] = await Promise.all([
      pool.query(
        `SELECT b.*, s.name_ar AS service_ar, s.name_fr AS service_fr, c.name_ar AS center_ar, c.name_fr AS center_fr
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN centers c ON c.id = b.center_id
         WHERE b.customer_id = $1 AND b.deleted_at IS NULL ORDER BY b.created_at DESC`, [req.customer.id]
      ),
      pool.query(
        `SELECT n.*, e.full_name FROM customer_notes n LEFT JOIN employees e ON e.id = n.employee_id
         WHERE n.customer_id = $1 ORDER BY n.created_at DESC`, [req.customer.id]
      ),
      pool.query(
        `SELECT ct.*, e.full_name FROM customer_contacts ct LEFT JOIN employees e ON e.id = ct.employee_id
         WHERE ct.customer_id = $1 ORDER BY ct.created_at DESC`, [req.customer.id]
      ),
      pool.query('SELECT id, full_name FROM employees WHERE is_active = true AND deleted_at IS NULL ORDER BY full_name'),
      pool.query('SELECT id, name_ar, name_fr FROM wilayas ORDER BY id'),
      pool.query('SELECT id, name_ar, name_fr FROM centers WHERE deleted_at IS NULL ORDER BY name_ar'),
    ]);
    res.render('admin/customer-detail', {
      title: req.customer.full_name, active: 'customers', customer: req.customer,
      bookings: bookings.rows, notes: notes.rows, contacts: contacts.rows,
      staff: staff.rows, wilayas: wilayas.rows, centers: centers.rows,
    });
  } catch (err) { next(err); }
});

customers.post('/:id', requirePerm('customers.edit'), loadCustomer, async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name || '').trim();
    const phone = H.normalizePhone(req.body.phone);
    if (!fullName || !H.validPhone(phone)) {
      req.session.flash = { type: 'error', message: res.locals.t('required_error') };
      return res.redirect(`/admin/customers/${req.customer.id}`);
    }
    if (phone !== req.customer.phone) {
      const dup = await pool.query('SELECT id FROM customers WHERE phone = $1 AND deleted_at IS NULL AND id <> $2', [phone, req.customer.id]);
      if (dup.rowCount) {
        req.session.flash = { type: 'warning', message: res.locals.t('duplicate_phone') };
        return res.redirect(`/admin/customers/${req.customer.id}`);
      }
    }
    await pool.query(
      `UPDATE customers SET full_name = $2, phone = $3, email = $4, wilaya_id = $5, city = $6,
              notes = $7, assigned_employee_id = $8 WHERE id = $1`,
      [req.customer.id, fullName, phone, String(req.body.email || '').trim() || null,
        parseInt(req.body.wilaya_id, 10) || null, String(req.body.city || '').trim() || null,
        String(req.body.notes || '').trim() || null, parseInt(req.body.assigned_employee_id, 10) || null]
    );
    await H.audit(req, {
      action: 'customer_updated', entityType: 'customer', entityId: req.customer.id,
      oldValues: { full_name: req.customer.full_name, phone: req.customer.phone, email: req.customer.email },
      newValues: { full_name: fullName, phone, email: req.body.email },
    });
    req.session.flash = { type: 'success', message: res.locals.t('customer_saved') };
    res.redirect(`/admin/customers/${req.customer.id}`);
  } catch (err) { next(err); }
});

customers.post('/:id/notes', requirePerm('customers.edit'), loadCustomer, async (req, res, next) => {
  try {
    const body = String(req.body.body || '').trim();
    if (body) {
      await pool.query('INSERT INTO customer_notes (customer_id, employee_id, body) VALUES ($1,$2,$3)', [req.customer.id, req.user.id, body]);
      await H.audit(req, { action: 'customer_note_added', entityType: 'customer', entityId: req.customer.id });
    }
    res.redirect(`/admin/customers/${req.customer.id}`);
  } catch (err) { next(err); }
});

customers.post('/:id/contacts', requirePerm('customers.edit'), loadCustomer, async (req, res, next) => {
  try {
    const summary = String(req.body.summary || '').trim();
    if (summary) {
      await pool.query(
        'INSERT INTO customer_contacts (customer_id, employee_id, channel, summary) VALUES ($1,$2,$3,$4)',
        [req.customer.id, req.user.id, ['phone', 'visit', 'email'].includes(req.body.channel) ? req.body.channel : 'phone', summary]
      );
      await H.audit(req, { action: 'customer_contact_logged', entityType: 'customer', entityId: req.customer.id, newValues: { summary } });
    }
    res.redirect(`/admin/customers/${req.customer.id}`);
  } catch (err) { next(err); }
});

// ================= CONTACT MESSAGES =================
async function loadMessage(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `SELECT m.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr, e.full_name AS assigned_name
       FROM contact_messages m
       LEFT JOIN wilayas w ON w.id = m.wilaya_id
       LEFT JOIN employees e ON e.id = m.assigned_employee_id
       WHERE m.id = $1 AND m.deleted_at IS NULL`, [id]
    );
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    req.message = rows[0];
    next();
  } catch (err) { next(err); }
}

contactMessages.get('/', requirePerm('contact_messages.view'), async (req, res, next) => {
  try {
    const params = [];
    const where = ['m.deleted_at IS NULL'];
    if (MESSAGE_FLOW.includes(req.query.status)) {
      params.push(req.query.status);
      where.push(`m.status = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      where.push(`(m.full_name ILIKE $${params.length} OR m.phone ILIKE $${params.length} OR m.subject ILIKE $${params.length})`);
    }
    const clause = where.join(' AND ');
    const total = await pool.query(`SELECT count(*)::int AS n FROM contact_messages m WHERE ${clause}`, params);
    const pager = H.paginate(req, total.rows[0].n, 15);
    const listParams = [...params, pager.perPage, pager.offset];
    const { rows } = await pool.query(
      `SELECT m.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr, e.full_name AS assigned_name
       FROM contact_messages m LEFT JOIN wilayas w ON w.id = m.wilaya_id LEFT JOIN employees e ON e.id = m.assigned_employee_id
       WHERE ${clause} ORDER BY m.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, listParams
    );
    res.render('admin/contact-messages', {
      title: res.locals.t('menu_contact_messages'), active: 'contact-messages', messages: rows,
      pager, filters: req.query, statusFlow: MESSAGE_FLOW,
    });
  } catch (err) { next(err); }
});

contactMessages.get('/:id', requirePerm('contact_messages.view'), loadMessage, async (req, res, next) => {
  try {
    const [history, staff] = await Promise.all([
      pool.query(
        `SELECT h.*, e.full_name FROM contact_message_history h LEFT JOIN employees e ON e.id = h.employee_id
         WHERE h.message_id = $1 ORDER BY h.created_at DESC`, [req.message.id]
      ),
      pool.query('SELECT id, full_name FROM employees WHERE is_active = true AND deleted_at IS NULL ORDER BY full_name'),
    ]);
    res.render('admin/contact-message-detail', {
      title: req.message.subject, active: 'contact-messages', message: req.message,
      history: history.rows, staff: staff.rows, statusFlow: MESSAGE_FLOW,
    });
  } catch (err) { next(err); }
});

contactMessages.post('/:id', requirePerm('contact_messages.edit'), loadMessage, async (req, res, next) => {
  try {
    const status = MESSAGE_FLOW.includes(req.body.status) ? req.body.status : req.message.status;
    const assigned = parseInt(req.body.assigned_employee_id, 10) || null;
    const notes = String(req.body.internal_notes || '').trim();
    await pool.query(
      `UPDATE contact_messages SET status = $2, assigned_employee_id = $3, internal_notes = $4 WHERE id = $1`,
      [req.message.id, status, assigned, notes || null]
    );
    if (status !== req.message.status) {
      await pool.query(
        `INSERT INTO contact_message_history (message_id, employee_id, action, old_value, new_value)
         VALUES ($1,$2,'status_changed',$3,$4)`, [req.message.id, req.user.id, req.message.status, status]
      );
    }
    await H.audit(req, {
      action: 'contact_message_updated', entityType: 'contact_message', entityId: req.message.id,
      oldValues: { status: req.message.status, assigned_employee_id: req.message.assigned_employee_id },
      newValues: { status, assigned_employee_id: assigned },
    });
    if (assigned && assigned !== req.user.id && assigned !== req.message.assigned_employee_id) {
      await H.notifyEmployees([assigned], {
        type: 'contact_assigned', titleAr: 'تم تعيينك على رسالة تواصل', titleFr: 'Un message vous a été affecté',
        bodyAr: `${req.message.full_name} — ${req.message.subject}`,
        bodyFr: `${req.message.full_name} — ${req.message.subject}`,
        link: `/admin/contact-messages/${req.message.id}`, entityType: 'contact_message', entityId: req.message.id,
      });
    }
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect(`/admin/contact-messages/${req.message.id}`);
  } catch (err) { next(err); }
});

module.exports = { customers, contactMessages };
