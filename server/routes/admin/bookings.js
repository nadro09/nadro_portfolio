'use strict';
const express = require('express');
const { pool } = require('../../db');
const { requirePerm } = require('../../auth');
const H = require('../../helpers');
const { BOOKING_FLOW } = require('../../i18n');

const router = express.Router();

async function loadBooking(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    const { rows } = await pool.query(
      `SELECT b.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr,
              c.name_ar AS center_ar, c.name_fr AS center_fr, c.code AS center_code,
              s.name_ar AS service_ar, s.name_fr AS service_fr, s.slug AS service_slug,
              e.full_name AS assigned_name,
              cu.email AS customer_email, cu.id AS customer_id
       FROM bookings b
       LEFT JOIN wilayas w ON w.id = b.wilaya_id
       LEFT JOIN centers c ON c.id = b.center_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN employees e ON e.id = b.assigned_employee_id
       LEFT JOIN customers cu ON cu.id = b.customer_id
       WHERE b.id = $1 AND b.deleted_at IS NULL`, [id]
    );
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    if (req.user.scopeCenterId && rows[0].center_id !== req.user.scopeCenterId) {
      return res.status(403).render('errors/403', { title: res.locals.t('forbidden_title') });
    }
    req.booking = rows[0];
    next();
  } catch (err) { next(err); }
}

async function staffOptions(user) {
  const params = [];
  let sql = `SELECT id, full_name, center_id FROM employees WHERE is_active = true AND deleted_at IS NULL`;
  if (user.scopeCenterId) {
    params.push(user.scopeCenterId);
    sql += ` AND center_id = $1`;
  }
  sql += ' ORDER BY full_name';
  return (await pool.query(sql, params)).rows;
}

async function centerOptions(user) {
  const params = [];
  let sql = `SELECT id, code, name_ar, name_fr FROM centers WHERE deleted_at IS NULL AND is_active = true`;
  if (user.scopeCenterId) {
    params.push(user.scopeCenterId);
    sql += ` AND id = $1`;
  }
  sql += ' ORDER BY name_ar';
  return (await pool.query(sql, params)).rows;
}

function buildFilters(req, params = []) {
  const where = ['b.deleted_at IS NULL'];
  const filters = {
    q: String(req.query.q || '').trim(),
    status: String(req.query.status || ''),
    wilaya: parseInt(req.query.wilaya, 10) || null,
    center: parseInt(req.query.center, 10) || null,
    service: parseInt(req.query.service, 10) || null,
    from: String(req.query.from || ''),
    to: String(req.query.to || ''),
    view: req.query.view === 'calendar' ? 'calendar' : 'table',
    month: /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : new Date().toISOString().slice(0, 7),
  };
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(b.customer_name ILIKE $${params.length} OR b.phone ILIKE $${params.length} OR b.reference ILIKE $${params.length})`);
  }
  if (BOOKING_FLOW.includes(filters.status)) {
    params.push(filters.status);
    where.push(`b.status = $${params.length}`);
  }
  if (filters.wilaya) {
    params.push(filters.wilaya);
    where.push(`b.wilaya_id = $${params.length}`);
  }
  if (filters.center) {
    params.push(filters.center);
    where.push(`b.center_id = $${params.length}`);
  }
  if (filters.service) {
    params.push(filters.service);
    where.push(`b.service_id = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    where.push(`b.preferred_date >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`b.preferred_date <= $${params.length}::date`);
  }
  const scope = H.centerScope(req.user, params, 'b.center_id');
  return { where: where.join(' AND ') + scope, filters };
}

router.get('/', requirePerm('bookings.view'), async (req, res, next) => {
  try {
    const params = [];
    const { where, filters } = buildFilters(req, params);
    const total = await pool.query(`SELECT count(*)::int AS n FROM bookings b WHERE ${where}`, params);
    const pager = H.paginate(req, total.rows[0].n, 15);
    const listParams = [...params, pager.perPage, pager.offset];
    const rows = await pool.query(
      `SELECT b.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr,
              c.name_ar AS center_ar, c.name_fr AS center_fr,
              s.name_ar AS service_ar, s.name_fr AS service_fr, e.full_name AS assigned_name
       FROM bookings b
       LEFT JOIN wilayas w ON w.id = b.wilaya_id
       LEFT JOIN centers c ON c.id = b.center_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN employees e ON e.id = b.assigned_employee_id
       WHERE ${where} ORDER BY b.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, listParams
    );

    let calendar = null;
    if (filters.view === 'calendar') {
      const cParams = [];
      const { where: cWhere } = buildFilters({ ...req, query: { ...req.query, view: 'calendar' } }, cParams);
      cParams.push(`${filters.month}-01`);
      const calRows = await pool.query(
        `SELECT b.id, b.reference, b.customer_name, b.status, b.preferred_date, b.preferred_time, b.confirmed_date,
                s.name_ar AS service_ar, s.name_fr AS service_fr
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         WHERE ${cWhere} AND to_char(coalesce(b.confirmed_date, b.preferred_date), 'YYYY-MM') = to_char($${cParams.length}::date, 'YYYY-MM')
         ORDER BY coalesce(b.confirmed_date, b.preferred_date), b.preferred_time`, cParams
      );
      const [year, month] = filters.month.split('-').map(Number);
      const first = new Date(Date.UTC(year, month - 1, 1));
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const startOffset = first.getUTCDay(); // 0 = Sunday
      calendar = { year, month, daysInMonth, startOffset, byDay: {} };
      for (const r of calRows.rows) {
        const d = r.confirmed_date || r.preferred_date;
        const iso = typeof d === 'string' ? d.slice(0, 10) : H.formatIsoDate(d);
        (calendar.byDay[iso] ||= []).push(r);
      }
    }

    const [wilayas, centers, services, staff] = await Promise.all([
      pool.query('SELECT id, name_ar, name_fr FROM wilayas ORDER BY id'),
      centerOptions(req.user),
      pool.query('SELECT id, name_ar, name_fr FROM services ORDER BY sort_order'),
      staffOptions(req.user),
    ]);

    res.render('admin/bookings', {
      title: res.locals.t('menu_bookings'), active: 'bookings', bookings: rows.rows, pager,
      filters, wilayas: wilayas.rows, centers, services: services.rows, staff, calendar,
      statusFlow: BOOKING_FLOW,
    });
  } catch (err) { next(err); }
});

router.get('/export.csv', requirePerm('bookings.export'), async (req, res, next) => {
  try {
    const params = [];
    const { where } = buildFilters(req, params);
    const { rows } = await pool.query(
      `SELECT b.reference, b.customer_name, b.phone, b.status, w.name_ar AS wilaya, b.city,
              c.name_ar AS center, s.name_ar AS service, b.preferred_date, b.preferred_time,
              b.confirmed_date, b.confirmed_time, b.created_at, e.full_name AS assigned
       FROM bookings b
       LEFT JOIN wilayas w ON w.id = b.wilaya_id
       LEFT JOIN centers c ON c.id = b.center_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN employees e ON e.id = b.assigned_employee_id
       WHERE ${where} ORDER BY b.created_at DESC`, params
    );
    const header = ['reference', 'name', 'phone', 'status', 'wilaya', 'city', 'center', 'service',
      'preferred_date', 'preferred_time', 'confirmed_date', 'confirmed_time', 'created_at', 'assigned'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.reference, r.customer_name, r.phone, r.status, r.wilaya, r.city, r.center, r.service,
        H.formatIsoDate(r.preferred_date), r.preferred_time, H.formatIsoDate(r.confirmed_date), r.confirmed_time,
        H.formatDateTime(r.created_at), r.assigned,
      ].map(H.escapeCsv).join(','));
    }
    await H.audit(req, { action: 'bookings_exported', entityType: 'booking', newValues: { rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audiolef-bookings-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (err) { next(err); }
});

router.get('/:id', requirePerm('bookings.view'), loadBooking, async (req, res, next) => {
  try {
    const [history, staff, centers, wilayas] = await Promise.all([
      pool.query(
        `SELECT h.*, e.full_name FROM booking_history h LEFT JOIN employees e ON e.id = h.employee_id
         WHERE h.booking_id = $1 ORDER BY h.created_at DESC`, [req.booking.id]
      ),
      staffOptions(req.user),
      centerOptions(req.user),
      pool.query('SELECT id, name_ar, name_fr FROM wilayas ORDER BY id'),
    ]);
    res.render('admin/booking-detail', {
      title: req.booking.reference, active: 'bookings', booking: req.booking, history: history.rows,
      staff, centers, wilayas: wilayas.rows, statusFlow: BOOKING_FLOW, errors: [],
    });
  } catch (err) { next(err); }
});

async function recordHistory(req, booking, action, oldValue, newValue, note) {
  await pool.query(
    `INSERT INTO booking_history (booking_id, employee_id, action, old_value, new_value, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [booking.id, req.user.id, action, oldValue === null ? null : String(oldValue),
      newValue === null ? null : String(newValue), note || null]
  );
}

async function notifyAssigned(req, bookingId, titleAr, titleFr, bodyAr, bodyFr) {
  const { rows } = await pool.query('SELECT assigned_employee_id FROM bookings WHERE id = $1', [bookingId]);
  const assigned = rows[0]?.assigned_employee_id;
  if (assigned && assigned !== req.user.id) {
    await H.notifyEmployees([assigned], {
      type: 'booking_update', titleAr, titleFr, bodyAr, bodyFr,
      link: `/admin/bookings/${bookingId}`, entityType: 'booking', entityId: bookingId,
    });
  }
}

router.post('/:id/status', requirePerm('bookings.edit'), loadBooking, async (req, res, next) => {
  try {
    const status = String(req.body.status || '');
    if (!BOOKING_FLOW.includes(status) || status === req.booking.status) {
      return res.redirect(`/admin/bookings/${req.booking.id}`);
    }
    const note = String(req.body.note || '').trim();
    await pool.query(
      `UPDATE bookings SET status = $2,
         confirmed_date = CASE WHEN $2 = 'confirmed' AND confirmed_date IS NULL THEN preferred_date ELSE confirmed_date END,
         confirmed_time = CASE WHEN $2 = 'confirmed' AND confirmed_time IS NULL THEN preferred_time ELSE confirmed_time END
       WHERE id = $1`, [req.booking.id, status]
    );
    await recordHistory(req, req.booking, 'status_changed', req.booking.status, status, note);
    await H.audit(req, {
      action: 'booking_status_changed', entityType: 'booking', entityId: req.booking.id,
      oldValues: { status: req.booking.status }, newValues: { status, note },
    });
    if (status === 'cancelled') {
      await notifyAssigned(req, req.booking.id, 'تم إلغاء موعد', 'Rendez-vous annulé',
        `${req.booking.customer_name} — ${req.booking.reference}`, `${req.booking.customer_name} — ${req.booking.reference}`);
    } else {
      await notifyAssigned(req, req.booking.id, 'تحديث حالة موعد', 'Statut de rendez-vous mis à jour',
        `${req.booking.customer_name} — ${res.locals.statusLabel(status)}`, `${req.booking.customer_name} — ${res.locals.statusLabel(status)}`);
    }
    req.session.flash = { type: 'success', message: res.locals.t('status_updated') };
    res.redirect(`/admin/bookings/${req.booking.id}`);
  } catch (err) { next(err); }
});

router.post('/:id/assign', requirePerm('bookings.assign'), loadBooking, async (req, res, next) => {
  try {
    const staffId = parseInt(req.body.assigned_employee_id, 10) || null;
    const centerId = parseInt(req.body.center_id, 10) || null;
    if (req.user.scopeCenterId && centerId && centerId !== req.user.scopeCenterId) {
      return res.status(403).render('errors/403', { title: res.locals.t('forbidden_title') });
    }
    if (staffId) {
      const staff = await pool.query('SELECT id, center_id FROM employees WHERE id = $1 AND is_active = true AND deleted_at IS NULL', [staffId]);
      if (!staff.rowCount) return res.redirect(`/admin/bookings/${req.booking.id}`);
    }
    await pool.query(
      `UPDATE bookings SET assigned_employee_id = $2, center_id = COALESCE($3, center_id) WHERE id = $1`,
      [req.booking.id, staffId, centerId]
    );
    await recordHistory(req, req.booking, 'assignment_changed',
      `employee:${req.booking.assigned_employee_id || '-'} center:${req.booking.center_id || '-'}`,
      `employee:${staffId || '-'} center:${centerId || req.booking.center_id || '-'}`);
    await H.audit(req, {
      action: 'booking_assigned', entityType: 'booking', entityId: req.booking.id,
      oldValues: { assigned_employee_id: req.booking.assigned_employee_id, center_id: req.booking.center_id },
      newValues: { assigned_employee_id: staffId, center_id: centerId },
    });
    if (staffId && staffId !== req.user.id) {
      await H.notifyEmployees([staffId], {
        type: 'booking_assigned', titleAr: 'تم تعيينك على موعد', titleFr: 'Un rendez-vous vous a été affecté',
        bodyAr: `${req.booking.customer_name} — ${req.booking.reference}`,
        bodyFr: `${req.booking.customer_name} — ${req.booking.reference}`,
        link: `/admin/bookings/${req.booking.id}`, entityType: 'booking', entityId: req.booking.id,
      });
    }
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect(`/admin/bookings/${req.booking.id}`);
  } catch (err) { next(err); }
});

router.post('/:id/schedule', requirePerm('bookings.edit'), loadBooking, async (req, res, next) => {
  try {
    const date = String(req.body.confirmed_date || '');
    const time = String(req.body.confirmed_time || '').trim();
    if (!date) return res.redirect(`/admin/bookings/${req.booking.id}`);
    await pool.query('UPDATE bookings SET confirmed_date = $2, confirmed_time = $3 WHERE id = $1', [req.booking.id, date, time || null]);
    await recordHistory(req, req.booking, 'schedule_changed',
      `${H.formatIsoDate(req.booking.confirmed_date)} ${req.booking.confirmed_time || ''}`.trim(),
      `${date} ${time}`.trim());
    await H.audit(req, {
      action: 'booking_rescheduled', entityType: 'booking', entityId: req.booking.id,
      oldValues: { date: H.formatIsoDate(req.booking.confirmed_date), time: req.booking.confirmed_time },
      newValues: { date, time },
    });
    await notifyAssigned(req, req.booking.id, 'تم تغيير موعد', 'Rendez-vous déplacé',
      `${req.booking.customer_name} — ${date} ${time}`, `${req.booking.customer_name} — ${date} ${time}`);
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect(`/admin/bookings/${req.booking.id}`);
  } catch (err) { next(err); }
});

router.post('/:id/notes', requirePerm('bookings.edit'), loadBooking, async (req, res, next) => {
  try {
    const notes = String(req.body.internal_notes || '').trim();
    const contactResult = String(req.body.contact_result || '').trim();
    await pool.query('UPDATE bookings SET internal_notes = $2, contact_result = COALESCE(NULLIF($3,\'\'), contact_result) WHERE id = $1',
      [req.booking.id, notes || null, contactResult]);
    await recordHistory(req, req.booking, 'notes_updated', req.booking.internal_notes, notes);
    await H.audit(req, {
      action: 'booking_notes_updated', entityType: 'booking', entityId: req.booking.id,
      oldValues: { internal_notes: req.booking.internal_notes }, newValues: { internal_notes: notes, contact_result: contactResult || null },
    });
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect(`/admin/bookings/${req.booking.id}`);
  } catch (err) { next(err); }
});

router.get('/:id/print', requirePerm('bookings.view'), loadBooking, (req, res) => {
  res.render('admin/booking-print', { booking: req.booking, layout: false });
});

module.exports = router;
