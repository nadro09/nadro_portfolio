'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const helmet = require('helmet');

const { pool, initDb } = require('./db');
const { t, STATUS_META } = require('./i18n');
const helpers = require('./helpers');
const auth = require('./auth');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

for (const dir of [UPLOAD_DIR, path.join(UPLOAD_DIR, 'avatars'), path.join(UPLOAD_DIR, 'content'), path.join(UPLOAD_DIR, 'attachments')]) {
  fs.mkdirSync(dir, { recursive: true });
}

app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view cache', false);
app.locals.appName = 'AUDIOLEF';
app.locals.UPLOAD_DIR = UPLOAD_DIR;

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // The sandbox preview renders the app inside an iframe on another origin.
  frameguard: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: true }));

// Public media (brand images / hero). Internal attachments are served through
// an authenticated admin route and live outside this public folder.
app.use('/uploads/avatars', express.static(path.join(UPLOAD_DIR, 'avatars'), { maxAge: '1h' }));
app.use('/uploads/content', express.static(path.join(UPLOAD_DIR, 'content'), { maxAge: '1h' }));

// Minimal cookie parser (only simple key=value cookies are used).
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    for (const pair of raw.split(';')) {
      const idx = pair.indexOf('=');
      if (idx > 0) req.cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  next();
});

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[audiolef] SESSION_SECRET is not set — using an ephemeral secret (development only).');
}

app.use(session({
  name: 'audiolef.sid',
  store: new PgStore({ pool, tableName: 'session' }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

app.use(auth.attachUser);
app.use(auth.csrfToken);

let settingsCache = { value: null, at: 0 };
async function settings() {
  if (settingsCache.value && Date.now() - settingsCache.at < 5000) return settingsCache.value;
  const value = await helpers.getSettings();
  settingsCache = { value, at: Date.now() };
  return value;
}
app.set('settingsRefresh', () => { settingsCache = { value: null, at: 0 }; });

app.use(async (req, res, next) => {
  try {
    const cfg = await settings();
    const preferred = req.user && req.user.language_pref === 'fr' ? 'fr' : 'ar';
    const lang = req.query.lang === 'fr' || req.query.lang === 'ar'
      ? req.query.lang
      : (req.cookies.lang === 'fr' || req.cookies.lang === 'ar'
        ? req.cookies.lang
        : (req.user ? preferred : (cfg.default_language === 'fr' ? 'fr' : 'ar')));
    if (req.query.lang === 'fr' || req.query.lang === 'ar') {
      res.cookie('lang', lang, { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: 'lax' });
    }
    res.locals.lang = lang;
    res.locals.dir = lang === 'fr' ? 'ltr' : 'rtl';
    res.locals.settings = cfg;
    // Brand tokens are editable from the admin settings page; only valid hex
    // values are accepted, otherwise the AUDIOLEF defaults are kept.
    const hexColor = (value, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toLowerCase() : fallback);
    res.locals.brand = {
      primary: hexColor(cfg.brand_primary, '#075b43'),
      secondary: hexColor(cfg.brand_secondary, '#16a34a'),
      accent: hexColor(cfg.brand_accent, '#e52323'),
      bg: hexColor(cfg.brand_bg, '#f8fafc'),
      ink: hexColor(cfg.brand_ink, '#1f2937'),
    };
    res.locals.t = (key, vars) => t(lang, key, vars);
    res.locals.statusMeta = STATUS_META;
    res.locals.statusLabel = (s) => (STATUS_META[s] ? STATUS_META[s][lang] : s);
    res.locals.formatDate = helpers.formatDate;
    res.locals.formatDateTime = helpers.formatDateTime;
    res.locals.formatIsoDate = helpers.formatIsoDate;
    res.locals.langSwitch = (pathname) => helpers.withLang(pathname, lang === 'ar' ? 'fr' : 'ar');
    res.locals.langUrl = (target) => {
      const q = new URLSearchParams(req.query);
      q.set('lang', target);
      return `${req.path}?${q.toString()}`;
    };
    res.locals.flash = req.session.flash || null;
    if (req.session.flash) delete req.session.flash;
    res.locals.previewMode = Boolean(
      req.query.preview === '1' && req.user && req.user.permissions.includes('content.manage')
    );
    const contentRows = await helpers.getContentRows();
    const cMap = helpers.contentMap(contentRows, res.locals.previewMode, lang);
    res.locals.contentRows = contentRows;
    res.locals.c = (key) => {
      const row = cMap[key];
      if (!row) return '';
      return (row[lang] || row.ar || '');
    };
    next();
  } catch (err) {
    next(err);
  }
});

app.use(auth.sessionIdleGuard(settings));

// CSRF validation runs after the language/content locals are attached so a
// rejected request can still render the localized 403 page.
app.use(auth.verifyCsrf);

app.use('/uploads/attachments', (req, res) => res.status(404).render('errors/404', { title: t(res.locals.lang, 'not_found_title') }));

app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error' });
  }
});

app.use((req, res) => {
  res.status(404).render('errors/404', { title: t(res.locals.lang, 'not_found_title') });
});

app.use((err, req, res, _next) => {
  console.error('[audiolef]', err);
  if (res.headersSent) return;
  res.status(500).render('errors/500', { title: t(res.locals.lang || 'ar', 'error_title') });
});

async function start() {
  try {
    await initDb();
  } catch (err) {
    console.error('[audiolef] database initialization failed:', err.message);
    process.exitCode = 1;
    return;
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[audiolef] listening on 0.0.0.0:${PORT}`);
  });
}

start();

module.exports = app;
