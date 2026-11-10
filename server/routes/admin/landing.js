'use strict';
const express = require('express');
const { pool } = require('../../db');
const { requirePerm } = require('../../auth');
const H = require('../../helpers');
const { renderLandingPage, STARTER_HTML } = require('../../landing');

const router = express.Router();

function normalizeSlug(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function findPage(id) {
  const { rows } = await pool.query('SELECT * FROM landing_pages WHERE id = $1 AND deleted_at IS NULL', [id]);
  return rows[0] || null;
}

function publicUrl(req, slug) {
  return `${req.protocol}://${req.get('host')}/lp/${slug}`;
}

router.get('/', requirePerm('landing.view'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT lp.*, e.full_name AS author
       FROM landing_pages lp
       LEFT JOIN employees e ON e.id = lp.updated_by
       WHERE lp.deleted_at IS NULL
       ORDER BY lp.updated_at DESC`
    );
    res.render('admin/landing', {
      title: res.locals.t('landing_title'), active: 'landing',
      pages: rows.map((p) => ({ ...p, url: publicUrl(req, p.slug) })),
    });
  } catch (err) { next(err); }
});

router.get('/new', requirePerm('landing.manage'), (req, res) => {
  res.render('admin/landing-edit', {
    title: res.locals.t('landing_new'), active: 'landing',
    page: null, code: STARTER_HTML, url: null, isNew: true,
  });
});

router.post('/', requirePerm('landing.manage'), async (req, res, next) => {
  try {
    const slug = normalizeSlug(req.body.slug || req.body.title_ar || req.body.title_fr);
    const titleAr = String(req.body.title_ar || '').trim();
    const titleFr = String(req.body.title_fr || '').trim();
    if (!slug || !(titleAr || titleFr)) {
      req.session.flash = { type: 'error', message: res.locals.t('required_error') };
      return res.redirect('/admin/landing/new');
    }
    const exists = await pool.query('SELECT 1 FROM landing_pages WHERE slug = $1', [slug]);
    if (exists.rowCount) {
      req.session.flash = { type: 'error', message: res.locals.t('landing_slug_hint') };
      return res.redirect('/admin/landing/new');
    }
    const { rows } = await pool.query(
      `INSERT INTO landing_pages (slug, title_ar, title_fr, html, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
      [slug, titleAr, titleFr, String(req.body.html || STARTER_HTML), req.user.id]
    );
    await H.audit(req, {
      action: 'landing_created', entityType: 'landing_page', entityId: String(rows[0].id),
      newValues: { slug, title_ar: titleAr, title_fr: titleFr },
    });
    req.session.flash = { type: 'success', message: res.locals.t('landing_created') };
    res.redirect(`/admin/landing/${rows[0].id}`);
  } catch (err) { next(err); }
});

router.get('/:id', requirePerm('landing.view'), async (req, res, next) => {
  try {
    const page = await findPage(req.params.id);
    if (!page) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    res.render('admin/landing-edit', {
      title: page.title_ar || page.title_fr || page.slug, active: 'landing',
      page, code: page.html, url: publicUrl(req, page.slug), isNew: false,
    });
  } catch (err) { next(err); }
});

router.post('/:id', requirePerm('landing.manage'), async (req, res, next) => {
  try {
    const page = await findPage(req.params.id);
    if (!page) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    const slug = normalizeSlug(req.body.slug || page.slug);
    const titleAr = String(req.body.title_ar || '').trim();
    const titleFr = String(req.body.title_fr || '').trim();
    if (!slug || !(titleAr || titleFr)) {
      req.session.flash = { type: 'error', message: res.locals.t('required_error') };
      return res.redirect(`/admin/landing/${page.id}`);
    }
    const clash = await pool.query('SELECT 1 FROM landing_pages WHERE slug = $1 AND id <> $2', [slug, page.id]);
    if (clash.rowCount) {
      req.session.flash = { type: 'error', message: res.locals.t('landing_slug_hint') };
      return res.redirect(`/admin/landing/${page.id}`);
    }
    await pool.query(
      `UPDATE landing_pages SET slug = $2, title_ar = $3, title_fr = $4, html = $5, updated_by = $6
       WHERE id = $1`,
      [page.id, slug, titleAr, titleFr, String(req.body.html ?? ''), req.user.id]
    );
    await H.audit(req, {
      action: 'landing_updated', entityType: 'landing_page', entityId: String(page.id),
      oldValues: { slug: page.slug, title_ar: page.title_ar, title_fr: page.title_fr },
      newValues: { slug, title_ar: titleAr, title_fr: titleFr },
    });
    req.session.flash = { type: 'success', message: res.locals.t('landing_saved') };
    res.redirect(`/admin/landing/${page.id}`);
  } catch (err) { next(err); }
});

router.post('/:id/publish', requirePerm('landing.publish'), async (req, res, next) => {
  try {
    const page = await findPage(req.params.id);
    if (!page) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    await pool.query(
      `UPDATE landing_pages SET status = 'published', published_at = COALESCE(published_at, now()), updated_by = $2
       WHERE id = $1`, [page.id, req.user.id]
    );
    await H.audit(req, { action: 'landing_published', entityType: 'landing_page', entityId: String(page.id), newValues: { slug: page.slug } });
    req.session.flash = { type: 'success', message: res.locals.t('landing_published') };
    res.redirect(`/admin/landing/${page.id}`);
  } catch (err) { next(err); }
});

router.post('/:id/unpublish', requirePerm('landing.publish'), async (req, res, next) => {
  try {
    const page = await findPage(req.params.id);
    if (!page) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    await pool.query(`UPDATE landing_pages SET status = 'draft', updated_by = $2 WHERE id = $1`, [page.id, req.user.id]);
    await H.audit(req, { action: 'landing_unpublished', entityType: 'landing_page', entityId: String(page.id), newValues: { slug: page.slug } });
    req.session.flash = { type: 'success', message: res.locals.t('landing_unpublished') };
    res.redirect(`/admin/landing/${page.id}`);
  } catch (err) { next(err); }
});

router.post('/:id/delete', requirePerm('landing.publish'), async (req, res, next) => {
  try {
    const page = await findPage(req.params.id);
    if (!page) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    await pool.query('UPDATE landing_pages SET deleted_at = now(), status = $2 WHERE id = $1', [page.id, 'draft']);
    await H.audit(req, { action: 'landing_deleted', entityType: 'landing_page', entityId: String(page.id), oldValues: { slug: page.slug } });
    req.session.flash = { type: 'success', message: res.locals.t('landing_deleted') };
    res.redirect('/admin/landing');
  } catch (err) { next(err); }
});

// Authenticated preview (works before publishing, and inside an iframe).
router.get('/:id/preview', requirePerm('landing.view'), async (req, res, next) => {
  try {
    const page = await findPage(req.params.id);
    if (!page) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    const logoRow = await pool.query("SELECT value_ar FROM website_content WHERE key = 'site_logo'");
    const logo = (logoRow.rows[0] && logoRow.rows[0].value_ar) || undefined;
    res.set('Cache-Control', 'no-store');
    res.type('html').send(renderLandingPage(page, { logo, brand: res.locals.brand }));
  } catch (err) { next(err); }
});

module.exports = router;
