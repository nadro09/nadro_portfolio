'use strict';
const { pool } = require('./db');
const { t, STATUS_META } = require('./i18n');

const TZ = 'Africa/Algiers';

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('day')}/${get('month')}/${get('year')}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return `${formatDate(d)} ${time}`;
}

function formatIsoDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d+]/g, '');
}

function validPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function validEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || '').trim());
}

function escapeCsv(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM system_settings');
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

async function getContentRows() {
  const { rows } = await pool.query(
    'SELECT key, section, type, value_ar, value_fr, draft_ar, draft_fr, published_at FROM website_content ORDER BY section, key'
  );
  return rows;
}

function contentMap(rows, preview, lang) {
  const map = {};
  for (const r of rows) {
    const draftReady = r.draft_ar !== null || r.draft_fr !== null;
    if (preview && draftReady) {
      map[r.key] = {
        ar: r.draft_ar !== null ? r.draft_ar : r.value_ar,
        fr: r.draft_fr !== null ? r.draft_fr : r.value_fr,
        type: r.type,
        draftReady: true,
      };
    } else {
      map[r.key] = { ar: r.value_ar, fr: r.value_fr, type: r.type, draftReady };
    }
  }
  return map;
}

function statusLabel(lang, status) {
  return STATUS_META[status]?.[lang] || status;
}

function paginate(req, total, perPage = 15) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);
  return {
    page: current,
    pages,
    perPage,
    offset: (current - 1) * perPage,
    total,
    from: total === 0 ? 0 : (current - 1) * perPage + 1,
    to: Math.min(current * perPage, total),
  };
}

function pageQuery(base, pager) {
  const q = new URLSearchParams(base);
  q.set('page', String(pager.page));
  return q.toString();
}

function withLang(pathname, lang) {
  const sep = pathname.includes('?') ? '&' : '?';
  return `${pathname}${sep}lang=${lang}`;
}

// Personal free-text fields are encrypted in the database, so the audit log
// must not keep a plain-text copy of them either.
const SENSITIVE_KEYS = new Set(['notes', 'internal_notes', 'body', 'note', 'password', 'new_password', 'current_password', 'confirm_password']);

function redact(values) {
  if (!values || typeof values !== 'object') return values;
  if (Array.isArray(values)) return values.map(redact);
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = SENSITIVE_KEYS.has(key) && value !== null && value !== undefined && value !== ''
      ? '[encrypted]'
      : (value && typeof value === 'object' ? redact(value) : value);
  }
  return out;
}

async function audit(req, { action, entityType, entityId = null, oldValues = null, newValues = null }) {
  const actor = req.user;
  try {
    await pool.query(
      `INSERT INTO audit_logs (employee_id, actor_name, action, entity_type, entity_id, old_values, new_values, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        actor ? actor.id : null,
        actor ? actor.full_name : (req.body?.username || 'anonymous'),
        action,
        entityType,
        entityId === null ? null : String(entityId),
        oldValues ? JSON.stringify(redact(oldValues)) : null,
        newValues ? JSON.stringify(redact(newValues)) : null,
        String(req.ip || '').replace('::ffff:', ''),
        String((typeof req.get === 'function' ? req.get('user-agent') : '') || '').slice(0, 300),
      ]
    );
  } catch (err) {
    console.error('audit failed', err.message);
  }
}

async function notifyPermission(permKey, payload, { centerId = null, excludeEmployeeId = null } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT e.id, r.all_centers
       FROM employees e
       JOIN employee_roles er ON er.employee_id = e.id
       JOIN roles r ON r.id = er.role_id
       JOIN role_permissions rp ON rp.role_id = er.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE p.key = $1 AND e.is_active = true AND e.deleted_at IS NULL
         AND ($2::int IS NULL OR r.all_centers = true OR e.center_id = $2::int)`,
      [permKey, centerId]
    );
    const ids = [...new Set(rows.map((r) => r.id))].filter((id) => id !== excludeEmployeeId);
    for (const id of ids) {
      await pool.query(
        `INSERT INTO notifications (employee_id, type, title_ar, title_fr, body_ar, body_fr, link, entity_type, entity_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, payload.type, payload.titleAr, payload.titleFr, payload.bodyAr || null, payload.bodyFr || null,
          payload.link || null, payload.entityType || null, payload.entityId || null]
      );
    }
    return ids.length;
  } catch (err) {
    console.error('notify failed', err.message);
    return 0;
  }
}

async function notifyEmployees(employeeIds, payload) {
  const unique = [...new Set(employeeIds.filter(Boolean))];
  for (const id of unique) {
    await pool.query(
      `INSERT INTO notifications (employee_id, type, title_ar, title_fr, body_ar, body_fr, link, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, payload.type, payload.titleAr, payload.titleFr, payload.bodyAr || null, payload.bodyFr || null,
        payload.link || null, payload.entityType || null, payload.entityId || null]
    );
  }
}

function passwordProblem(password, minLength = 10) {
  const value = String(password || '');
  if (value.length < minLength) return t('ar', 'password_policy', { n: minLength });
  if (!/[A-Za-z\u0600-\u06FF]/.test(value) || !/\d/.test(value)) return t('ar', 'password_policy', { n: minLength });
  return null;
}

// Center-scoped users see their own center plus not-yet-assigned records
// (so a receptionist can process a fresh website request).
function centerScope(user, params, column = 'b.center_id') {
  if (user && user.scopeCenterId) {
    params.push(user.scopeCenterId);
    return ` AND (${column} = $${params.length} OR ${column} IS NULL)`;
  }
  return '';
}

function redirectBack(req, res, fallback) {
  const ref = req.get('referer');
  if (ref && ref.startsWith(req.protocol + '://' + req.get('host'))) {
    try {
      const url = new URL(ref);
      return res.redirect(url.pathname + url.search);
    } catch { /* ignore */ }
  }
  return res.redirect(fallback);
}

module.exports = {
  formatDate, formatDateTime, formatIsoDate, normalizePhone, validPhone, validEmail,
  escapeCsv, getSettings, getContentRows, contentMap, statusLabel, paginate, pageQuery,
  withLang, audit, notifyPermission, notifyEmployees, passwordProblem, redirectBack, TZ, centerScope,
};
