'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const H = require('../helpers');
const { requireAuth, flash } = require('../auth');

const router = express.Router();

function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
}

// The first account is created from the login screen, exactly once: the marker
// below is written when it is created and the form disappears afterwards.
const SETUP_KEY = 'setup_completed';

async function setupOpen() {
  const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [SETUP_KEY]);
  return !(rows.length && rows[0].value === 'true');
}

async function markSetupDone() {
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, 'true')
     ON CONFLICT (key) DO UPDATE SET value = 'true'`,
    [SETUP_KEY]
  );
}

function regenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.get('/login', async (req, res, next) => {
  try {
    if (req.user) return res.redirect('/admin');
    res.render('admin/login', {
      title: res.locals.t('login_title'),
      error: req.query.expired ? res.locals.t('session_expired') : null,
      next: safeNext(req.query.next),
      username: '',
      email: '',
      canSetup: await setupOpen(),
    });
  } catch (err) { next(err); }
});

router.get('/setup', async (req, res, next) => {
  try {
    if (req.user) return res.redirect('/admin');
    if (!(await setupOpen())) {
      flash(req, 'error', res.locals.t('setup_closed'));
      return res.redirect('/admin/login');
    }
    const settings = await H.getSettings();
    res.render('admin/setup', {
      title: res.locals.t('setup_title'),
      errors: [],
      values: { full_name: '', email: '', username: '' },
      minLength: Math.max(8, parseInt(settings.password_min_length, 10) || 10),
    });
  } catch (err) { next(err); }
});

router.post('/setup', async (req, res, next) => {
  try {
    if (!(await setupOpen())) {
      flash(req, 'error', res.locals.t('setup_closed'));
      return res.redirect('/admin/login');
    }
    const settings = await H.getSettings();
    const min = Math.max(8, parseInt(settings.password_min_length, 10) || 10);
    const t = res.locals.t;
    const fullName = String(req.body.full_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm_password || '');
    const values = { full_name: fullName, email, username };
    const errors = [];

    if (!fullName) errors.push({ field: 'full_name', message: t('required_error') });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push({ field: 'email', message: t('invalid_email') });
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) errors.push({ field: 'username', message: t('invalid_username') });
    const policy = H.passwordProblem(password, min);
    if (policy) errors.push({ field: 'password', message: t('password_policy', { n: min }) });
    if (password !== confirm) errors.push({ field: 'confirm_password', message: t('password_mismatch') });

    if (!errors.length) {
      const { rows } = await pool.query(
        `SELECT (SELECT 1 FROM employees WHERE lower(username) = $1) AS u,
                (SELECT 1 FROM employees WHERE lower(email) = $2) AS e`,
        [username, email]
      );
      if (rows[0].u) errors.push({ field: 'username', message: t('username_taken') });
      if (rows[0].e) errors.push({ field: 'email', message: t('email_taken') });
    }

    if (errors.length) {
      return res.status(422).render('admin/setup', { title: t('setup_title'), errors, values, minLength: min });
    }

    const hash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      `INSERT INTO employees (full_name, username, email, password_hash, job_title_ar, job_title_fr,
         is_demo, must_change_password) VALUES ($1,$2,$3,$4,'مدير المنصة','Administrateur',false,false)
       RETURNING id`,
      [fullName, username, email, hash]
    );
    const employeeId = inserted.rows[0].id;
    await pool.query(
      `INSERT INTO employee_roles (employee_id, role_id) SELECT $1, id FROM roles WHERE key = 'super_admin'`,
      [employeeId]
    );
    await markSetupDone();

    await regenerate(req);
    req.session.employeeId = employeeId;
    req.session.lastSeen = Date.now();
    req.session.csrf = require('crypto').randomBytes(24).toString('hex');
    req.user = { id: employeeId, full_name: fullName };
    await H.audit(req, { action: 'account_created', entityType: 'employee', entityId: employeeId });
    flash(req, 'success', t('account_created'));
    res.redirect('/admin');
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const ip = (req.ip || '').replace('::ffff:', '');
    const settings = await H.getSettings();

    const attempts = await pool.query(
      `SELECT count(*)::int AS n FROM login_attempts
       WHERE successful = false AND created_at > now() - interval '15 minutes'
         AND (ip = $1 OR username = $2)`,
      [ip, username]
    );
    if (attempts.rows[0].n >= 12) {
      await pool.query('INSERT INTO login_attempts (username, ip, successful) VALUES ($1,$2,false)', [username, ip]);
      return res.status(429).render('admin/login', {
        title: res.locals.t('login_title'),
        error: res.locals.t('rate_limited'),
        next: safeNext(req.body.next),
        username,
        email,
        canSetup: await setupOpen(),
      });
    }

    const { rows } = await pool.query(
      `SELECT * FROM employees WHERE lower(username) = $1 AND deleted_at IS NULL`, [username]
    );
    const employee = rows[0];
    const fail = async (message) => {
      await pool.query('INSERT INTO login_attempts (username, ip, successful) VALUES ($1,$2,false)', [username, ip]);
      if (employee) {
        const failed = employee.failed_attempts + 1;
        const lock = failed >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await pool.query('UPDATE employees SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [employee.id, failed, lock]);
      }
      await H.audit(req, { action: 'login_failed', entityType: 'auth', entityId: username, newValues: { ip } });
      return res.status(401).render('admin/login', {
        title: res.locals.t('login_title'),
        error: message,
        next: safeNext(req.body.next),
        username,
        email,
        canSetup: await setupOpen(),
      });
    };

    if (!employee) return fail(res.locals.t('invalid_credentials'));
    if (String(employee.email || '').toLowerCase() !== email) return fail(res.locals.t('invalid_credentials'));
    if (!employee.is_active) return fail(res.locals.t('account_disabled'));
    if (employee.locked_until && new Date(employee.locked_until) > new Date()) {
      return fail(res.locals.t('account_locked'));
    }

    const ok = await bcrypt.compare(password, employee.password_hash);
    if (!ok) return fail(res.locals.t('invalid_credentials'));

    await pool.query(
      `UPDATE employees SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
      [employee.id]
    );
    await pool.query('INSERT INTO login_attempts (username, ip, successful) VALUES ($1,$2,true)', [username, ip]);

    const mustChange = employee.must_change_password;
    await regenerate(req);
    req.session.employeeId = employee.id;
    req.session.lastSeen = Date.now();
    req.session.csrf = require('crypto').randomBytes(24).toString('hex');
    flash(req, 'success', res.locals.t('login_success'));

    req.user = { id: employee.id, full_name: employee.full_name };
    await H.audit(req, { action: 'login', entityType: 'auth', entityId: employee.id });

    if (mustChange) return res.redirect('/admin/change-password');
    return res.redirect(safeNext(req.body.next));
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await H.audit(req, { action: 'logout', entityType: 'auth', entityId: req.user.id });
    req.session.destroy(() => {
      res.clearCookie('audiolef.sid');
      res.redirect('/admin/login');
    });
  } catch (err) { next(err); }
});

router.get('/change-password', requireAuth, (req, res) => {
  res.render('admin/change-password', { title: res.locals.t('change_password'), errors: [] });
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const settings = await H.getSettings();
    const min = Math.max(8, parseInt(settings.password_min_length, 10) || 10);
    const current = String(req.body.current_password || '');
    const next1 = String(req.body.new_password || '');
    const next2 = String(req.body.confirm_password || '');
    const errors = [];
    const hash = req.user ? (await pool.query('SELECT password_hash FROM employees WHERE id = $1', [req.user.id])).rows[0].password_hash : null;
    if (!hash || !(await bcrypt.compare(current, hash))) errors.push({ field: 'current_password', message: res.locals.t('password_wrong') });
    const policy = H.passwordProblem(next1, min);
    if (policy) errors.push({ field: 'new_password', message: res.locals.t('password_policy', { n: min }) });
    if (next1 !== next2) errors.push({ field: 'confirm_password', message: res.locals.t('password_mismatch') });
    if (errors.length) {
      return res.status(422).render('admin/change-password', { title: res.locals.t('change_password'), errors });
    }
    const newHash = await bcrypt.hash(next1, 10);
    await pool.query(
      'UPDATE employees SET password_hash = $2, must_change_password = false, failed_attempts = 0, locked_until = NULL WHERE id = $1',
      [req.user.id, newHash]
    );
    await H.audit(req, { action: 'password_changed', entityType: 'employee', entityId: req.user.id });
    flash(req, 'success', res.locals.t('password_changed'));
    res.redirect('/admin');
  } catch (err) { next(err); }
});

module.exports = router;
