'use strict';
const crypto = require('crypto');
const { pool } = require('./db');
const { t } = require('./i18n');

const USER_SQL = `
  SELECT e.id, e.full_name, e.username, e.email, e.phone, e.avatar_path, e.center_id,
         e.job_title_ar, e.job_title_fr, e.language_pref, e.is_active, e.is_demo,
         e.must_change_password, e.last_login_at, e.created_at,
         c.name_ar AS center_name_ar, c.name_fr AS center_name_fr, c.code AS center_code
  FROM employees e
  LEFT JOIN centers c ON c.id = e.center_id
  WHERE e.id = $1 AND e.deleted_at IS NULL`;

const PERM_SQL = `
  SELECT DISTINCT p.key, r.key AS role_key, r.all_centers, r.name_ar AS role_name_ar, r.name_fr AS role_name_fr
  FROM employee_roles er
  JOIN roles r ON r.id = er.role_id
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE er.employee_id = $1`;

async function attachUser(req, res, next) {
  res.locals.currentUser = null;
  req.user = null;
  if (!req.session || !req.session.employeeId) return next();
  try {
    const { rows } = await pool.query(USER_SQL, [req.session.employeeId]);
    if (!rows.length || !rows[0].is_active) {
      req.session.employeeId = null;
      return next();
    }
    const perms = await pool.query(PERM_SQL, [req.session.employeeId]);
    const permissions = [...new Set(perms.rows.map((r) => r.key))];
    const roles = [...new Set(perms.rows.map((r) => r.role_key))];
    const allCenters = perms.rows.some((r) => r.all_centers);
    req.user = {
      ...rows[0],
      permissions,
      roles,
      all_centers: allCenters,
      scopeCenterId: allCenters ? null : rows[0].center_id,
    };
    res.locals.currentUser = req.user;
    res.locals.can = (key) => permissions.includes(key);
    res.locals.hasRole = (key) => roles.includes(key);
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    const next = encodeURIComponent(req.originalUrl);
    return res.redirect('/admin/login?next=' + next);
  }
  if (req.user.must_change_password && req.path !== '/change-password' && req.path !== '/logout') {
    return res.redirect('/admin/change-password');
  }
  return next();
}

function hasPermission(user, key) {
  return Boolean(user && user.permissions.includes(key));
}

function requirePerm(key) {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
    }
    if (!hasPermission(req.user, key)) {
      return res.status(403).render('errors/403', {
        title: t(res.locals.lang, 'forbidden_title'),
      });
    }
    return next();
  };
}

function requireAnyPerm(keys) {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
    }
    if (!keys.some((k) => hasPermission(req.user, k))) {
      return res.status(403).render('errors/403', { title: t(res.locals.lang, 'forbidden_title') });
    }
    return next();
  };
}

function csrfToken(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
}

function csrfOk(req) {
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  const expected = req.session && req.session.csrf;
  if (!token || !expected) return false;
  const given = Buffer.from(String(token));
  const stored = Buffer.from(String(expected));
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

function verifyCsrf(req, res, next) {
  if (req.method === 'POST' && !req.is('multipart/form-data')) {
    if (!csrfOk(req)) {
      return res.status(403).render('errors/403', { title: t(res.locals.lang, 'forbidden_title') });
    }
  }
  next();
}

function verifyCsrfAfterUpload(req, res, next) {
  if (!csrfOk(req)) {
    return res.status(403).render('errors/403', { title: t(res.locals.lang, 'forbidden_title') });
  }
  next();
}

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function sessionIdleGuard(getSettings) {
  return async (req, res, next) => {
    if (!req.session || !req.session.employeeId) return next();
    let minutes = 30;
    try {
      const cfg = await getSettings();
      minutes = Math.max(5, parseInt(cfg.session_idle_minutes, 10) || 30);
    } catch { /* keep default */ }
    const now = Date.now();
    const last = req.session.lastSeen || now;
    if (now - last > minutes * 60 * 1000) {
      return req.session.destroy(() => {
        res.clearCookie('audiolef.sid');
        res.redirect('/admin/login?expired=1');
      });
    }
    req.session.lastSeen = now;
    next();
  };
}

module.exports = {
  attachUser, requireAuth, requirePerm, requireAnyPerm, hasPermission,
  csrfToken, verifyCsrf, verifyCsrfAfterUpload, flash, sessionIdleGuard, csrfOk,
};
