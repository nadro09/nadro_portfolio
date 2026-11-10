'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, requirePerm, verifyCsrfAfterUpload } = require('../auth');
const H = require('../helpers');
const ai = require('../ai');
const { coverageMap } = require('../coverage');

const router = express.Router();

router.use(requireAuth);

// The AI assistant is offered on every admin page; it reports itself as
// unavailable (instead of inventing answers) until AI_API_KEY is configured.
router.use((req, res, next) => {
  res.locals.aiConfigured = ai.isConfigured();
  next();
});

// Shared admin chrome data.
router.use(async (req, res, next) => {
  try {
    if (!req.user) return next();
    const [notif, unread] = await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM notifications WHERE employee_id = $1 AND is_read = false', [req.user.id]),
      pool.query(
        `SELECT count(*)::int AS n
         FROM internal_messages m
         JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.employee_id = $1
         WHERE m.deleted_at IS NULL AND m.sender_id <> $1
           AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)`,
        [req.user.id]
      ),
    ]);
    res.locals.unreadNotifications = notif.rows[0].n;
    res.locals.unreadConversations = unread.rows[0].n;
    const roleNames = await pool.query(
      `SELECT r.name_ar, r.name_fr FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = $1`,
      [req.user.id]
    );
    res.locals.userRoleNames = roleNames.rows;
    res.locals.displayName = req.user.full_name;
    next();
  } catch (err) { next(err); }
});

router.get('/', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const params = [];
    const scope = H.centerScope(req.user, params);
    const bookingsWhere = `WHERE b.deleted_at IS NULL ${scope}`;

    const counts = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE b.status = 'new')::int AS new,
              count(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
              count(*) FILTER (WHERE b.status = 'completed')::int AS completed
       FROM bookings b ${bookingsWhere}`, params
    );
    const contactNew = await pool.query(
      `SELECT count(*)::int AS n FROM contact_messages m
       WHERE m.deleted_at IS NULL AND m.status = 'new'
         AND ($1::int IS NULL OR EXISTS (
            SELECT 1 FROM customers cu JOIN bookings b ON b.customer_id = cu.id
            WHERE cu.phone = m.phone AND b.center_id = $1::int))`,
      [req.user.scopeCenterId]
    );
    const customers = await pool.query(
      `SELECT count(DISTINCT cu.id)::int AS n FROM customers cu
       WHERE cu.deleted_at IS NULL
         AND ($1::int IS NULL OR EXISTS (
            SELECT 1 FROM bookings b WHERE b.customer_id = cu.id AND b.center_id = $1::int))`,
      [req.user.scopeCenterId]
    );
    const centers = await pool.query(
      `SELECT count(*)::int AS n FROM centers c WHERE c.is_active = true AND c.deleted_at IS NULL
         AND ($1::int IS NULL OR c.id = $1::int)`, [req.user.scopeCenterId]
    );
    const employees = await pool.query(
      `SELECT count(*)::int AS n FROM employees e WHERE e.is_active = true AND e.deleted_at IS NULL
         AND ($1::int IS NULL OR e.center_id = $1::int)`, [req.user.scopeCenterId]
    );

    const dayParams = [];
    const dayScope = H.centerScope(req.user, dayParams, 'b.center_id');
    const byDay = await pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(b.id)::int AS n
       FROM generate_series(current_date - interval '13 days', current_date, interval '1 day') AS d(day)
       LEFT JOIN bookings b ON b.created_at::date = d.day AND b.deleted_at IS NULL ${dayScope}
       GROUP BY d.day ORDER BY d.day`, dayParams
    );
    const wilayaParams = [];
    const wilayaScope = H.centerScope(req.user, wilayaParams, 'b.center_id');
    const byWilaya = await pool.query(
      `SELECT w.name_ar, w.name_fr, count(b.id)::int AS n
       FROM bookings b JOIN wilayas w ON w.id = b.wilaya_id
       WHERE b.deleted_at IS NULL ${wilayaScope}
       GROUP BY w.id ORDER BY n DESC LIMIT 8`, wilayaParams
    );
    const serviceParams = [];
    const serviceScope = H.centerScope(req.user, serviceParams, 'b.center_id');
    const byService = await pool.query(
      `SELECT s.name_ar, s.name_fr, count(b.id)::int AS n
       FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.deleted_at IS NULL ${serviceScope}
       GROUP BY s.id ORDER BY n DESC`, serviceParams
    );

    const latestParams = [];
    const latestScope = H.centerScope(req.user, latestParams, 'b.center_id');
    const latestBookings = await pool.query(
      `SELECT b.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr,
              s.name_ar AS service_ar, s.name_fr AS service_fr
       FROM bookings b
       LEFT JOIN wilayas w ON w.id = b.wilaya_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.deleted_at IS NULL ${latestScope}
       ORDER BY b.created_at DESC LIMIT 6`, latestParams
    );
    const latestMessages = await pool.query(
      `SELECT m.*, w.name_ar AS wilaya_ar, w.name_fr AS wilaya_fr
       FROM contact_messages m LEFT JOIN wilayas w ON w.id = m.wilaya_id
       WHERE m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 6`
    );
    const latestActivity = await pool.query(
      `SELECT a.*, e.full_name FROM audit_logs a LEFT JOIN employees e ON e.id = a.employee_id
       ORDER BY a.created_at DESC LIMIT 8`
    );

    const map = await coverageMap();

    res.render('admin/dashboard', {
      title: res.locals.t('menu_dashboard'),
      active: 'dashboard',
      map,
      counts: counts.rows[0],
      contactNew: contactNew.rows[0].n,
      customersCount: customers.rows[0].n,
      centersCount: centers.rows[0].n,
      employeesCount: employees.rows[0].n,
      byDay: byDay.rows,
      byWilaya: byWilaya.rows,
      byService: byService.rows,
      latestBookings: latestBookings.rows,
      latestMessages: latestMessages.rows,
      latestActivity: latestActivity.rows,
    });
  } catch (err) { next(err); }
});

// ---------- AI assistant ----------
// One endpoint serves the floating assistant (chat) and the reply suggestions
// inside internal conversations (mode=reply).
router.post('/ai', async (req, res) => {
  const lang = res.locals.lang === 'fr' ? 'fr' : 'ar';
  try {
    if (!ai.isConfigured()) return res.status(503).json({ error: 'not_configured' });
    const mode = req.body && req.body.mode === 'reply' ? 'reply' : 'chat';
    const message = String((req.body && req.body.message) || '').slice(0, 6000).trim();
    if (!message) return res.status(400).json({ error: 'empty' });

    const system = [
      'You are the assistant inside AUDIOLEF, an audiology network management platform in Algeria.',
      'Help staff with bookings, customers, centers, internal messages, website content and settings.',
      'Be concise, practical and never invent data you were not given.',
      lang === 'fr' ? 'Answer in French.' : 'Answer in Arabic.',
      mode === 'reply'
        ? 'Draft a short, professional reply from the signed-in employee to the internal conversation below. Return only the message text.'
        : '',
      `Signed-in employee: ${req.user.full_name}.`,
    ].filter(Boolean).join('\n');

    const history = Array.isArray(req.body && req.body.history)
      ? req.body.history.slice(-8)
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      : [];

    const reply = await ai.chat([{ role: 'system', content: system }, ...history, { role: 'user', content: message }]);
    res.json({ reply });
  } catch (err) {
    console.error('[ai]', err.code || '', err.message);
    res.status(502).json({ error: err.code === 'AI_NOT_CONFIGURED' ? 'not_configured' : 'provider' });
  }
});

// ---------- Notifications ----------
router.get('/notifications', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.user.id]
    );
    res.render('admin/notifications', {
      title: res.locals.t('menu_notifications'), active: 'notifications', notifications: rows,
    });
  } catch (err) { next(err); }
});

router.post('/notifications/:id/read', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `UPDATE notifications SET is_read = true, read_at = now()
       WHERE id = $1 AND employee_id = $2 AND is_read = false RETURNING link`, [id, req.user.id]
    );
    if (rows.length && rows[0].link) return res.redirect(rows[0].link);
    res.redirect('/admin/notifications');
  } catch (err) { next(err); }
});

router.post('/notifications/read-all', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = true, read_at = now() WHERE employee_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.redirect('/admin/notifications');
  } catch (err) { next(err); }
});

// ---------- Profile ----------
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads'), 'avatars'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    return cb(new Error('file_type_not_allowed'));
  },
});

router.get('/profile', async (req, res, next) => {
  try {
    const activity = await pool.query(
      `SELECT * FROM audit_logs WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.user.id]
    );
    res.render('admin/profile', {
      title: res.locals.t('menu_profile'), active: 'profile', activity: activity.rows, errors: [],
    });
  } catch (err) { next(err); }
});

router.post('/profile', async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name || '').trim();
    const email = String(req.body.email || '').trim();
    const phone = String(req.body.phone || '').trim();
    const jobAr = String(req.body.job_title_ar || '').trim();
    const jobFr = String(req.body.job_title_fr || '').trim();
    const language = req.body.language_pref === 'fr' ? 'fr' : 'ar';
    const errors = [];
    if (fullName.length < 3) errors.push({ field: 'full_name', message: res.locals.t('field_required') });
    if (!H.validEmail(email)) errors.push({ field: 'email', message: res.locals.t('invalid_email') });
    if (errors.length) {
      const activity = await pool.query('SELECT * FROM audit_logs WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
      return res.status(422).render('admin/profile', { title: res.locals.t('menu_profile'), active: 'profile', activity: activity.rows, errors });
    }
    await pool.query(
      `UPDATE employees SET full_name = $2, email = $3, phone = $4, job_title_ar = $5, job_title_fr = $6, language_pref = $7
       WHERE id = $1`,
      [req.user.id, fullName, email, phone || null, jobAr || null, jobFr || null, language]
    );
    await H.audit(req, { action: 'profile_updated', entityType: 'employee', entityId: req.user.id, newValues: { fullName, email } });
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect('/admin/profile');
  } catch (err) { next(err); }
});

router.post('/profile/avatar', verifyCsrfAfterUpload, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      req.session.flash = { type: 'error', message: res.locals.t(err.message === 'file_type_not_allowed' ? 'file_type_not_allowed' : 'file_too_large') };
      return res.redirect('/admin/profile');
    }
    try {
      if (!req.file) return res.redirect('/admin/profile');
      const rel = `/uploads/avatars/${req.file.filename}`;
      const old = await pool.query('SELECT avatar_path FROM employees WHERE id = $1', [req.user.id]);
      await pool.query('UPDATE employees SET avatar_path = $2 WHERE id = $1', [req.user.id, rel]);
      if (old.rows[0]?.avatar_path) {
        const prev = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads'), old.rows[0].avatar_path.replace('/uploads/', ''));
        fs.promises.unlink(prev).catch(() => {});
      }
      await H.audit(req, { action: 'avatar_updated', entityType: 'employee', entityId: req.user.id });
      req.session.flash = { type: 'success', message: res.locals.t('saved') };
      res.redirect('/admin/profile');
    } catch (e) { next(e); }
  });
});

// ---------- Audit ----------
router.get('/audit', requirePerm('audit.view'), async (req, res, next) => {
  try {
    const params = [];
    const where = ['1=1'];
    if (req.query.employee) {
      params.push(parseInt(req.query.employee, 10));
      where.push(`a.employee_id = $${params.length}`);
    }
    if (req.query.action) {
      params.push(String(req.query.action));
      where.push(`a.action = $${params.length}`);
    }
    if (req.query.entity) {
      params.push(String(req.query.entity));
      where.push(`a.entity_type = $${params.length}`);
    }
    if (req.query.from) {
      params.push(String(req.query.from));
      where.push(`a.created_at >= $${params.length}::date`);
    }
    if (req.query.to) {
      params.push(String(req.query.to));
      where.push(`a.created_at < ($${params.length}::date + interval '1 day')`);
    }
    const clause = where.join(' AND ');
    const total = await pool.query(`SELECT count(*)::int AS n FROM audit_logs a WHERE ${clause}`, params);
    const pager = H.paginate(req, total.rows[0].n, 25);
    const listParams = [...params, pager.perPage, pager.offset];
    const { rows } = await pool.query(
      `SELECT a.*, e.full_name FROM audit_logs a LEFT JOIN employees e ON e.id = a.employee_id
       WHERE ${clause} ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    );
    const employees = await pool.query('SELECT id, full_name FROM employees ORDER BY full_name');
    const actions = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    const entities = await pool.query('SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type');
    res.render('admin/audit', {
      title: res.locals.t('audit_log'), active: 'audit', logs: rows, pager, filters: req.query,
      employees: employees.rows, actions: actions.rows, entities: entities.rows,
    });
  } catch (err) { next(err); }
});

// ---------- Settings ----------
router.get('/settings', requirePerm('settings.view'), async (req, res, next) => {
  try {
    const settings = await H.getSettings();
    res.render('admin/settings', { title: res.locals.t('settings_title'), active: 'settings', settings });
  } catch (err) { next(err); }
});

router.post('/settings', requirePerm('settings.manage'), async (req, res, next) => {
  try {
    const allowed = ['company_name', 'company_email', 'default_language', 'years_experience', 'years_experience_note',
      'booking_slot_minutes', 'working_hours_ar', 'working_hours_fr', 'password_min_length',
      'session_idle_minutes', 'notify_new_bookings', 'notify_new_messages', 'backup_note',
      'brand_primary', 'brand_secondary', 'brand_accent', 'brand_bg', 'brand_ink',
      'hero_media_type', 'hero_video_url'];
    const colorKeys = ['brand_primary', 'brand_secondary', 'brand_accent', 'brand_bg', 'brand_ink'];
    const old = await H.getSettings();
    for (const key of allowed) {
      const isToggle = ['notify_new_bookings', 'notify_new_messages'].includes(key);
      if (!isToggle && req.body[key] === undefined) continue;
      let value = String(req.body[key] ?? '').trim();
      if (key === 'default_language' && !['ar', 'fr'].includes(value)) value = 'ar';
      if (isToggle) value = req.body[key] === 'on' ? '1' : '0';
      if (key === 'password_min_length') value = String(Math.min(64, Math.max(8, parseInt(value, 10) || 10)));
      if (key === 'session_idle_minutes') value = String(Math.min(720, Math.max(5, parseInt(value, 10) || 30)));
      if (key === 'booking_slot_minutes') value = String(Math.min(240, Math.max(10, parseInt(value, 10) || 30)));
      if (key === 'years_experience') value = value === '' ? '' : String(Math.max(0, parseInt(value, 10) || 0));
      if (colorKeys.includes(key)) {
        if (!/^#[0-9a-fA-F]{6}$/.test(value)) continue;
        value = value.toLowerCase();
      }
      if (key === 'hero_media_type') value = ['image', 'video', 'gallery'].includes(value) ? value : 'image';
      if (key === 'hero_video_url') value = value.slice(0, 500);
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by) VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, value, req.user.id]
      );
    }
    await H.audit(req, { action: 'settings_updated', entityType: 'settings', entityId: null, oldValues: old, newValues: req.body });
    req.app.get('settingsRefresh')();
    req.session.flash = { type: 'success', message: res.locals.t('settings_saved') };
    res.redirect('/admin/settings');
  } catch (err) { next(err); }
});

// ---------- Backup ----------
router.get('/backup', requirePerm('backup.run'), async (req, res, next) => {
  try {
    const tables = ['wilayas', 'roles', 'permissions', 'role_permissions', 'services', 'centers', 'center_services',
      'employees', 'employee_roles', 'customers', 'customer_notes', 'customer_contacts', 'bookings', 'booking_history',
      'contact_messages', 'contact_message_history', 'internal_conversations', 'conversation_participants',
      'internal_messages', 'notifications', 'website_content', 'content_versions', 'faqs', 'system_settings', 'audit_logs'];
    const dump = { generated_at: new Date().toISOString(), app: 'AUDIOLEF' };
    for (const table of tables) {
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      dump[table] = rows;
    }
    await H.audit(req, { action: 'backup_downloaded', entityType: 'backup' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audiolef-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(dump, null, 2));
  } catch (err) { next(err); }
});

router.use('/bookings', require('./admin/bookings'));
router.use('/customers', require('./admin/crm').customers);
router.use('/contact-messages', require('./admin/crm').contactMessages);
router.use('/centers', require('./admin/directory').centers);
router.use('/wilayas', require('./admin/directory').wilayas);
router.use('/users', require('./admin/directory').users);
router.use('/content', require('./admin/content'));
router.use('/landing', require('./admin/landing'));
router.use('/messages', require('./admin/messaging'));

module.exports = router;
