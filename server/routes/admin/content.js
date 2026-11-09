'use strict';
const express = require('express');
const path = require('path');
const multer = require('multer');
const { pool } = require('../../db');
const { requirePerm, verifyCsrfAfterUpload } = require('../../auth');
const H = require('../../helpers');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'data', 'uploads');

const contentUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(UPLOAD_DIR, 'content'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png';
      cb(null, `content-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype)) return cb(null, true);
    return cb(new Error('file_type_not_allowed'));
  },
});

const SECTIONS = {
  branding: { ar: 'الهوية والشعار', fr: 'Identité et logo' },
  hero: { ar: 'قسم البداية (Hero)', fr: 'Section d’accueil' },
  intro: { ar: 'قسم التعريف والعلامات', fr: 'Présentation et marques' },
  how: { ar: 'قسم كيف نعمل', fr: 'Section comment ça marche' },
  audiogram: { ar: 'مثال تخطيط السمع', fr: 'Exemple d’audiogramme' },
  centers: { ar: 'قسم المراكز', fr: 'Section centres' },
  map: { ar: 'خريطة التغطية', fr: 'Carte de couverture' },
  faq: { ar: 'قسم الأسئلة الشائعة', fr: 'Section FAQ' },
  contact: { ar: 'التواصل والروابط الاجتماعية', fr: 'Contact et réseaux sociaux' },
  footer: { ar: 'التذييل', fr: 'Pied de page' },
  legal: { ar: 'الصفحات القانونية', fr: 'Pages légales' },
};

router.get('/', requirePerm('content.view'), async (req, res, next) => {
  try {
    const [rows, faqs, services, versions] = await Promise.all([
      pool.query('SELECT * FROM website_content ORDER BY section, key'),
      pool.query('SELECT * FROM faqs ORDER BY sort_order, id'),
      pool.query('SELECT * FROM services ORDER BY sort_order, id'),
      pool.query(`SELECT content_key, count(*)::int AS n, max(published_at) AS last_at FROM content_versions GROUP BY content_key`),
    ]);
    const versionMap = {};
    for (const v of versions.rows) versionMap[v.content_key] = v;
    const grouped = {};
    for (const row of rows.rows) {
      const section = row.section || 'general';
      (grouped[section] ||= []).push(row);
    }
    res.render('admin/content', {
      title: res.locals.t('content_title'), active: 'content',
      grouped, sections: SECTIONS, faqs: faqs.rows, services: services.rows, versionMap,
    });
  } catch (err) { next(err); }
});

router.post('/draft', requirePerm('content.manage'), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT key FROM website_content');
    let changed = 0;
    for (const row of rows) {
      const arKey = `ar__${row.key}`;
      const frKey = `fr__${row.key}`;
      if (req.body[arKey] === undefined && req.body[frKey] === undefined) continue;
      await pool.query(
        `UPDATE website_content SET draft_ar = $2, draft_fr = $3, updated_by = $4 WHERE key = $1`,
        [row.key, String(req.body[arKey] ?? ''), String(req.body[frKey] ?? ''), req.user.id]
      );
      changed += 1;
    }
    await H.audit(req, { action: 'content_draft_saved', entityType: 'website_content', newValues: { fields: changed } });
    req.session.flash = { type: 'success', message: res.locals.t('content_draft_saved') };
    res.redirect('/admin/content');
  } catch (err) { next(err); }
});

router.post('/publish', requirePerm('content.publish'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM website_content WHERE draft_ar IS NOT NULL OR draft_fr IS NOT NULL'
    );
    if (!rows.length) {
      req.session.flash = { type: 'warning', message: res.locals.t('no_data') };
      return res.redirect('/admin/content');
    }
    for (const row of rows) {
      const ar = row.draft_ar !== null ? row.draft_ar : row.value_ar;
      const fr = row.draft_fr !== null ? row.draft_fr : row.value_fr;
      await pool.query(
        `UPDATE website_content SET value_ar = $2, value_fr = $3, draft_ar = NULL, draft_fr = NULL,
           published_at = now(), updated_by = $4 WHERE id = $1`,
        [row.id, ar, fr, req.user.id]
      );
      await pool.query(
        `INSERT INTO content_versions (content_key, value_ar, value_fr, published_by)
         VALUES ($1,$2,$3,$4)`, [row.key, ar, fr, req.user.id]
      );
    }
    await H.audit(req, {
      action: 'content_published', entityType: 'website_content',
      newValues: { keys: rows.map((r) => r.key) },
    });
    req.session.flash = { type: 'success', message: res.locals.t('content_published') };
    res.redirect('/admin/content');
  } catch (err) { next(err); }
});

router.post('/discard', requirePerm('content.manage'), async (req, res, next) => {
  try {
    await pool.query('UPDATE website_content SET draft_ar = NULL, draft_fr = NULL WHERE draft_ar IS NOT NULL OR draft_fr IS NOT NULL');
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect('/admin/content');
  } catch (err) { next(err); }
});

router.post('/upload', requirePerm('content.manage'), verifyCsrfAfterUpload, (req, res, next) => {
  contentUpload.single('image')(req, res, async (err) => {
    if (err) {
      req.session.flash = { type: 'error', message: res.locals.t(err.message === 'file_type_not_allowed' ? 'file_type_not_allowed' : 'file_too_large') };
      return res.redirect('/admin/content');
    }
    try {
      const key = String(req.body.key || '');
      if (!req.file || !key) return res.redirect('/admin/content');
      const rel = `/uploads/content/${req.file.filename}`;
      const upd = await pool.query(
        `UPDATE website_content SET draft_ar = $2, draft_fr = $2, updated_by = $3 WHERE key = $1 AND type = 'image' RETURNING key`,
        [key, rel, req.user.id]
      );
      if (!upd.rowCount) {
        req.session.flash = { type: 'error', message: res.locals.t('file_type_not_allowed') };
        return res.redirect('/admin/content');
      }
      await H.audit(req, { action: 'content_image_uploaded', entityType: 'website_content', entityId: key, newValues: { path: rel } });
      req.session.flash = { type: 'success', message: res.locals.t('content_draft_saved') };
      res.redirect('/admin/content');
    } catch (e) { next(e); }
  });
});

router.get('/versions/:key', requirePerm('content.view'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const content = await pool.query('SELECT * FROM website_content WHERE key = $1', [key]);
    if (!content.rowCount) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    const versions = await pool.query(
      `SELECT v.*, e.full_name FROM content_versions v LEFT JOIN employees e ON e.id = v.published_by
       WHERE v.content_key = $1 ORDER BY v.published_at DESC`, [key]
    );
    res.render('admin/content-versions', {
      title: res.locals.t('versions'), active: 'content', content: content.rows[0], versions: versions.rows,
    });
  } catch (err) { next(err); }
});

router.post('/versions/:id/restore', requirePerm('content.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const v = await pool.query('SELECT * FROM content_versions WHERE id = $1', [id]);
    if (!v.rowCount) return res.redirect('/admin/content');
    await pool.query(
      `UPDATE website_content SET draft_ar = $2, draft_fr = $3, updated_by = $4 WHERE key = $1`,
      [v.rows[0].content_key, v.rows[0].value_ar, v.rows[0].value_fr, req.user.id]
    );
    await H.audit(req, { action: 'content_version_restored', entityType: 'website_content', entityId: v.rows[0].content_key, newValues: { version: id } });
    req.session.flash = { type: 'success', message: res.locals.t('content_draft_saved') };
    res.redirect('/admin/content/versions/' + encodeURIComponent(v.rows[0].content_key));
  } catch (err) { next(err); }
});

// ---------- FAQ ----------
router.post('/faqs/save', requirePerm('content.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.body.id, 10) || null;
    const qAr = String(req.body.question_ar || '').trim();
    const qFr = String(req.body.question_fr || '').trim();
    const aAr = String(req.body.answer_ar || '').trim();
    const aFr = String(req.body.answer_fr || '').trim();
    if (!qAr || !qFr || !aAr || !aFr) {
      req.session.flash = { type: 'error', message: res.locals.t('required_error') };
      return res.redirect('/admin/content#faqs');
    }
    if (id) {
      await pool.query(
        `UPDATE faqs SET question_ar=$2, question_fr=$3, answer_ar=$4, answer_fr=$5 WHERE id=$1`,
        [id, qAr, qFr, aAr, aFr]
      );
      await H.audit(req, { action: 'faq_updated', entityType: 'faq', entityId: id });
    } else {
      const max = await pool.query('SELECT coalesce(max(sort_order), 0) + 1 AS n FROM faqs');
      const ins = await pool.query(
        `INSERT INTO faqs (question_ar, question_fr, answer_ar, answer_fr, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [qAr, qFr, aAr, aFr, max.rows[0].n]
      );
      await H.audit(req, { action: 'faq_created', entityType: 'faq', entityId: ins.rows[0].id });
    }
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect('/admin/content#faqs');
  } catch (err) { next(err); }
});

router.post('/faqs/:id/toggle', requirePerm('content.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('UPDATE faqs SET is_active = NOT is_active WHERE id = $1', [id]);
    await H.audit(req, { action: 'faq_toggled', entityType: 'faq', entityId: id });
    res.redirect('/admin/content#faqs');
  } catch (err) { next(err); }
});

// ---------- Services ----------
router.post('/services/save', requirePerm('content.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.body.id, 10) || null;
    const nameAr = String(req.body.name_ar || '').trim();
    const nameFr = String(req.body.name_fr || '').trim();
    const descAr = String(req.body.description_ar || '').trim();
    const descFr = String(req.body.description_fr || '').trim();
    const slug = String(req.body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const min = parseInt(req.body.duration_min, 10) || null;
    const max = parseInt(req.body.duration_max, 10) || null;
    if (!nameAr || !nameFr || !slug) {
      req.session.flash = { type: 'error', message: res.locals.t('required_error') };
      return res.redirect('/admin/content#services');
    }
    if (id) {
      await pool.query(
        `UPDATE services SET slug=$2, name_ar=$3, name_fr=$4, description_ar=$5, description_fr=$6,
           duration_min=$7, duration_max=$8, icon=$9, is_active=$10 WHERE id=$1`,
        [id, slug, nameAr, nameFr, descAr, descFr, min, max, String(req.body.icon || 'ear'), req.body.is_active === 'on']
      );
      await H.audit(req, { action: 'service_updated', entityType: 'service', entityId: id });
    } else {
      const sort = await pool.query('SELECT coalesce(max(sort_order), 0) + 1 AS n FROM services');
      const ins = await pool.query(
        `INSERT INTO services (slug, name_ar, name_fr, description_ar, description_fr, duration_min, duration_max, icon, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [slug, nameAr, nameFr, descAr, descFr, min, max, String(req.body.icon || 'ear'), sort.rows[0].n]
      );
      await H.audit(req, { action: 'service_created', entityType: 'service', entityId: ins.rows[0].id });
    }
    req.session.flash = { type: 'success', message: res.locals.t('saved') };
    res.redirect('/admin/content#services');
  } catch (err) {
    if (err.code === '23505') {
      req.session.flash = { type: 'error', message: res.locals.t('duplicate_phone') };
      return res.redirect('/admin/content#services');
    }
    next(err);
  }
});

router.post('/services/:id/toggle', requirePerm('content.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('UPDATE services SET is_active = NOT is_active WHERE id = $1', [id]);
    await H.audit(req, { action: 'service_toggled', entityType: 'service', entityId: id });
    res.redirect('/admin/content#services');
  } catch (err) { next(err); }
});

module.exports = router;
