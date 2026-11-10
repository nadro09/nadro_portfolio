'use strict';
const express = require('express');
const { pool } = require('../db');
const { t } = require('../i18n');
const H = require('../helpers');
const ai = require('../ai');

const router = express.Router();

// Simple per-IP throttle for the two public forms.
const buckets = new Map();
function throttle(max, windowMs) {
  return (req, res, next) => {
    const key = (req.ip || 'unknown') + ':' + req.path;
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      buckets.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).render('errors/429', { title: res.locals.t('rate_limited') });
    }
    next();
  };
}

const CENTER_SELECT = `
  SELECT c.id, c.code, c.name_ar, c.name_fr, c.city_ar, c.city_fr, c.address_ar, c.address_fr,
         c.latitude, c.longitude, c.phone_primary, c.phone_secondary, c.email,
         c.opening_hours_ar, c.opening_hours_fr, c.is_active, c.is_demo,
         w.id AS wilaya_id, w.name_ar AS wilaya_name_ar, w.name_fr AS wilaya_name_fr,
         COALESCE((
           SELECT json_agg(json_build_object('id', s.id, 'slug', s.slug, 'name_ar', s.name_ar, 'name_fr', s.name_fr) ORDER BY s.sort_order)
           FROM center_services cs JOIN services s ON s.id = cs.service_id
           WHERE cs.center_id = c.id AND s.is_active = true
         ), '[]'::json) AS services
  FROM centers c
  JOIN wilayas w ON w.id = c.wilaya_id
  WHERE c.is_active = true AND c.deleted_at IS NULL`;

async function commonData() {
  const [services, wilayas, settings] = await Promise.all([
    pool.query('SELECT * FROM services WHERE is_active = true ORDER BY sort_order, id'),
    pool.query('SELECT * FROM wilayas ORDER BY id'),
    H.getSettings(),
  ]);
  return {
    services: services.rows,
    wilayas: wilayas.rows,
    settings,
  };
}

const { coverageMap } = require('../coverage');

// Hero media is chosen in the admin settings page: a single image, a gallery
// of up to three uploaded images, or a video (YouTube / Vimeo / MP4 file).
function heroMedia(settings) {
  const type = ['video', 'gallery'].includes(settings.hero_media_type) ? settings.hero_media_type : 'image';
  const url = String(settings.hero_video_url || '').trim();
  // A link set in the admin always wins, whatever the media type is.
  let embed = null;
  if (url) {
    const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{6,})/);
    const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (yt) embed = `https://www.youtube.com/embed/${yt[1]}`;
    else if (vimeo) embed = `https://player.vimeo.com/video/${vimeo[1]}`;
  }
  return { type, url, embed };
}

async function publicStats() {
  const [centers, services, wilayas, settings] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM centers WHERE is_active = true AND deleted_at IS NULL`),
    pool.query(`SELECT count(*)::int AS n FROM services WHERE is_active = true`),
    pool.query(`SELECT count(DISTINCT c.wilaya_id)::int AS n FROM centers c
                WHERE c.is_active = true AND c.deleted_at IS NULL`),
    H.getSettings(),
  ]);
  const years = parseInt(settings.years_experience, 10);
  return {
    centersCount: centers.rows[0].n,
    servicesCount: services.rows[0].n,
    wilayasCount: wilayas.rows[0].n,
    years: Number.isFinite(years) && years > 0 ? years : null,
    yearsNote: settings.years_experience_note || '',
  };
}

router.get('/', async (req, res, next) => {
  try {
    const [base, stats, centers, faqs, map] = await Promise.all([
      commonData(),
      publicStats(),
      pool.query(`${CENTER_SELECT} ORDER BY c.is_demo ASC, w.id ASC, c.id ASC LIMIT 6`),
      pool.query('SELECT * FROM faqs WHERE is_active = true ORDER BY sort_order, id LIMIT 6'),
      coverageMap(),
    ]);
    res.render('public/home', {
      nav: 'home',
      stats,
      centers: centers.rows,
      faqs: faqs.rows,
      map,
      hero: heroMedia(res.locals.settings || base.settings),
      ...base,
    });
  } catch (err) { next(err); }
});

router.get('/services', async (req, res, next) => {
  try {
    const base = await commonData();
    res.render('public/services', { nav: 'services', ...base });
  } catch (err) { next(err); }
});

router.get('/services/:slug', async (req, res, next) => {
  try {
    const base = await commonData();
    const { rows } = await pool.query('SELECT * FROM services WHERE slug = $1 AND is_active = true', [req.params.slug]);
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    const centers = await pool.query(
      `${CENTER_SELECT} AND EXISTS (SELECT 1 FROM center_services cs WHERE cs.center_id = c.id AND cs.service_id = $1)
       ORDER BY w.id LIMIT 8`, [rows[0].id]
    );
    res.render('public/service-detail', { nav: 'services', service: rows[0], centers: centers.rows, ...base });
  } catch (err) { next(err); }
});

router.get('/centers', async (req, res, next) => {
  try {
    const base = await commonData();
    const wilayaId = parseInt(req.query.wilaya, 10) || null;
    const q = String(req.query.q || '').trim();
    const params = [];
    let sql = CENTER_SELECT;
    if (wilayaId) {
      params.push(wilayaId);
      sql += ` AND c.wilaya_id = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (c.name_ar ILIKE $${params.length} OR c.name_fr ILIKE $${params.length}
                 OR c.city_ar ILIKE $${params.length} OR c.city_fr ILIKE $${params.length})`;
    }
    sql += ' ORDER BY w.id, c.name_ar';
    const centers = await pool.query(sql, params);
    res.render('public/centers', {
      nav: 'centers', centers: centers.rows, filters: { wilaya: wilayaId, q }, ...base,
    });
  } catch (err) { next(err); }
});

router.get('/faq', async (req, res, next) => {
  try {
    const base = await commonData();
    const faqs = await pool.query('SELECT * FROM faqs WHERE is_active = true ORDER BY sort_order, id');
    res.render('public/faq', { nav: 'faq', faqs: faqs.rows, ...base });
  } catch (err) { next(err); }
});

router.get('/booking', async (req, res, next) => {
  try {
    const base = await commonData();
    const centers = await pool.query(`${CENTER_SELECT} ORDER BY w.id`);
    res.render('public/booking', {
      nav: 'booking',
      centers: centers.rows,
      errors: [],
      old: {
        service_id: req.query.service ? String(req.query.service) : '',
        center_id: req.query.center ? String(req.query.center) : '',
      },
      ...base,
    });
  } catch (err) { next(err); }
});

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: H.TZ }).format(new Date());
}

router.post('/booking', throttle(8, 10 * 60 * 1000), async (req, res, next) => {
  try {
    const base = await commonData();
    const centers = await pool.query(`${CENTER_SELECT} ORDER BY w.id`);
    const old = {
      full_name: String(req.body.full_name || '').trim(),
      phone: String(req.body.phone || '').trim(),
      email: String(req.body.email || '').trim(),
      wilaya_id: req.body.wilaya_id || '',
      city: String(req.body.city || '').trim(),
      center_id: req.body.center_id || '',
      service_id: req.body.service_id || '',
      preferred_date: String(req.body.preferred_date || ''),
      preferred_time: String(req.body.preferred_time || ''),
      notes: String(req.body.notes || '').trim(),
    };
    const errors = [];
    if (old.full_name.length < 3) errors.push({ field: 'full_name', message: res.locals.t('field_required') });
    if (!H.validPhone(old.phone)) errors.push({ field: 'phone', message: res.locals.t('invalid_phone') });
    if (old.email && !H.validEmail(old.email)) errors.push({ field: 'email', message: res.locals.t('invalid_email') });
    const wilayaId = parseInt(old.wilaya_id, 10);
    if (!wilayaId || !base.wilayas.some((w) => w.id === wilayaId)) errors.push({ field: 'wilaya_id', message: res.locals.t('field_required') });
    if (!old.city) errors.push({ field: 'city', message: res.locals.t('field_required') });
    const serviceId = parseInt(old.service_id, 10);
    if (!serviceId || !base.services.some((s) => s.id === serviceId)) errors.push({ field: 'service_id', message: res.locals.t('field_required') });
    if (!old.preferred_date || old.preferred_date < todayIso()) {
      errors.push({ field: 'preferred_date', message: res.locals.t('field_required') });
    }
    if (!old.preferred_time) errors.push({ field: 'preferred_time', message: res.locals.t('field_required') });
    if (req.body.consent !== 'on') errors.push({ field: 'consent', message: res.locals.t('consent_required') });

    const centerId = parseInt(old.center_id, 10) || null;
    if (centerId && !centers.rows.some((c) => c.id === centerId)) {
      errors.push({ field: 'center_id', message: res.locals.t('field_required') });
    }

    if (errors.length) {
      return res.status(422).render('public/booking', {
        nav: 'booking', centers: centers.rows, errors, old, ...base,
      });
    }

    const phone = H.normalizePhone(old.phone);
    const customer = await pool.query('SELECT id FROM customers WHERE phone = $1 AND deleted_at IS NULL', [phone]);
    let customerId;
    if (customer.rowCount) {
      customerId = customer.rows[0].id;
      await pool.query(
        `UPDATE customers SET email = COALESCE(NULLIF($2,''), email), wilaya_id = $3,
                city = COALESCE(NULLIF($4,''), city), updated_at = now() WHERE id = $1`,
        [customerId, old.email, wilayaId, old.city]
      );
    } else {
      const inserted = await pool.query(
        `INSERT INTO customers (full_name, phone, email, wilaya_id, city)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [old.full_name, phone, old.email || null, wilayaId, old.city]
      );
      customerId = inserted.rows[0].id;
    }

    let reference = '';
    let bookingId = null;
    for (let attempt = 0; attempt < 6 && !bookingId; attempt += 1) {
      const suffix = String(Math.floor(1000 + Math.random() * 9000));
      const stamp = new Date();
      const ym = `${String(stamp.getUTCFullYear()).slice(2)}${String(stamp.getUTCMonth() + 1).padStart(2, '0')}`;
      reference = `ALF-${ym}-${suffix}`;
      try {
        const ins = await pool.query(
          `INSERT INTO bookings (reference, customer_id, customer_name, phone, wilaya_id, city, center_id,
             service_id, preferred_date, preferred_time, notes, status, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new','website') RETURNING id`,
          [reference, customerId, old.full_name, phone, wilayaId, old.city, centerId, serviceId,
            old.preferred_date, old.preferred_time, old.notes || null]
        );
        bookingId = ins.rows[0].id;
      } catch (err) {
        if (err.code !== '23505') throw err;
      }
    }
    if (!bookingId) throw new Error('could not allocate booking reference');

    await pool.query(
      `INSERT INTO booking_history (booking_id, employee_id, action, new_value, note)
       VALUES ($1, NULL, 'created', 'new', $2)`,
      [bookingId, 'website']
    );

    const service = base.services.find((s) => s.id === serviceId);
    const wilaya = base.wilayas.find((w) => w.id === wilayaId);
    if (base.settings.notify_new_bookings !== '0') {
      await H.notifyPermission('bookings.view', {
        type: 'booking_new',
        titleAr: 'طلب موعد جديد',
        titleFr: 'Nouvelle demande de rendez-vous',
        bodyAr: `${old.full_name} — ${service?.name_ar || ''} — ${wilaya?.name_ar || ''} — ${old.preferred_date} ${old.preferred_time}`,
        bodyFr: `${old.full_name} — ${service?.name_fr || ''} — ${wilaya?.name_fr || ''} — ${old.preferred_date} ${old.preferred_time}`,
        link: `/admin/bookings/${bookingId}`,
        entityType: 'booking',
        entityId: bookingId,
      }, { centerId });
    }

    return res.redirect(`/booking/success/${encodeURIComponent(reference)}`);
  } catch (err) { next(err); }
});

router.get('/booking/success/:reference', async (req, res, next) => {
  try {
    const base = await commonData();
    const { rows } = await pool.query(
      `SELECT b.reference, b.customer_name, b.preferred_date, b.preferred_time, b.status,
              s.name_ar AS service_ar, s.name_fr AS service_fr,
              c.name_ar AS center_ar, c.name_fr AS center_fr
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN centers c ON c.id = b.center_id
       WHERE b.reference = $1 AND b.deleted_at IS NULL`, [req.params.reference]
    );
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    res.render('public/booking-success', { nav: 'booking', booking: rows[0], ...base });
  } catch (err) { next(err); }
});

router.get('/contact', async (req, res, next) => {
  try {
    const base = await commonData();
    res.render('public/contact', { nav: 'contact', errors: [], old: {}, sent: req.query.sent === '1', ...base });
  } catch (err) { next(err); }
});

router.post('/contact', throttle(6, 10 * 60 * 1000), async (req, res, next) => {
  try {
    const base = await commonData();
    const old = {
      full_name: String(req.body.full_name || '').trim(),
      phone: String(req.body.phone || '').trim(),
      email: String(req.body.email || '').trim(),
      wilaya_id: req.body.wilaya_id || '',
      subject: String(req.body.subject || '').trim(),
      body: String(req.body.body || '').trim(),
    };
    const errors = [];
    if (old.full_name.length < 3) errors.push({ field: 'full_name', message: res.locals.t('field_required') });
    if (!H.validPhone(old.phone)) errors.push({ field: 'phone', message: res.locals.t('invalid_phone') });
    if (old.email && !H.validEmail(old.email)) errors.push({ field: 'email', message: res.locals.t('invalid_email') });
    if (old.subject.length < 3) errors.push({ field: 'subject', message: res.locals.t('field_required') });
    if (old.body.length < 10) errors.push({ field: 'body', message: res.locals.t('field_required') });

    if (errors.length) {
      return res.status(422).render('public/contact', { nav: 'contact', errors, old, sent: false, ...base });
    }

    const wilayaId = parseInt(old.wilaya_id, 10) || null;
    const ins = await pool.query(
      `INSERT INTO contact_messages (full_name, phone, email, wilaya_id, subject, body)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [old.full_name, H.normalizePhone(old.phone), old.email || null, wilayaId, old.subject, old.body]
    );
    const wilaya = base.wilayas.find((w) => w.id === wilayaId);
    if (base.settings.notify_new_messages !== '0') {
      await H.notifyPermission('contact_messages.view', {
        type: 'contact_new',
        titleAr: 'رسالة تواصل جديدة',
        titleFr: 'Nouveau message de contact',
        bodyAr: `${old.full_name} — ${old.subject}${wilaya ? ' — ' + wilaya.name_ar : ''}`,
        bodyFr: `${old.full_name} — ${old.subject}${wilaya ? ' — ' + wilaya.name_fr : ''}`,
        link: `/admin/contact-messages/${ins.rows[0].id}`,
        entityType: 'contact_message',
        entityId: ins.rows[0].id,
      });
    }
    res.redirect('/contact?sent=1');
  } catch (err) { next(err); }
});

router.get('/privacy', async (req, res, next) => {
  try {
    const base = await commonData();
    res.render('public/legal', { nav: 'privacy', docKey: 'privacy_policy', ...base });
  } catch (err) { next(err); }
});

router.get('/terms', async (req, res, next) => {
  try {
    const base = await commonData();
    res.render('public/legal', { nav: 'terms', docKey: 'terms_of_use', ...base });
  } catch (err) { next(err); }
});

// Public assistant -----------------------------------------------------------
// Answers questions about hearing care, services and bookings. Uses the same
// AI client as the admin tools; without a key it answers "not configured" so
// the widget can point visitors to the phone number instead of guessing.
const assistantHits = new Map();
function assistantThrottle(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const entry = assistantHits.get(key);
  if (!entry || now - entry.start > windowMs) {
    assistantHits.set(key, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 20) return res.status(429).json({ error: 'rate_limited' });
  return next();
}

let assistantFactsCache = { value: null, at: 0 };
async function assistantFacts() {
  if (assistantFactsCache.value && Date.now() - assistantFactsCache.at < 60000) {
    return assistantFactsCache.value;
  }
  const [services, centers, settings] = await Promise.all([
    pool.query('SELECT name_ar, name_fr FROM services WHERE is_active = true ORDER BY sort_order, id'),
    pool.query(`SELECT count(*)::int AS total, count(DISTINCT city_ar)::int AS cities
                FROM centers WHERE is_active = true AND deleted_at IS NULL`),
    H.getSettings(),
  ]);
  const value = {
    services: services.rows.map((s) => `${s.name_ar} / ${s.name_fr}`),
    centers: centers.rows[0].total,
    cities: centers.rows[0].cities,
    phone: settings.phone_primary || '',
    email: settings.contact_email || '',
    hoursAr: settings.working_hours_ar || '',
    hoursFr: settings.working_hours_fr || '',
  };
  assistantFactsCache = { value, at: Date.now() };
  return value;
}

function assistantSystemPrompt(lang, facts) {
  const shared = [
    facts.services.length ? `- الخدمات / Services: ${facts.services.join(' • ')}` : null,
    `- ${facts.centers} centres / مراكز`,
    facts.phone ? `- Téléphone / الهاتف: ${facts.phone}` : null,
    facts.email ? `- E-mail / البريد: ${facts.email}` : null,
  ].filter(Boolean);
  if (lang === 'fr') {
    return [
      'Tu es l’assistant numérique d’AUDIOLEF, réseau de services auditifs en Algérie.',
      'Réponds en 3 à 5 lignes maximum, en français, sur un ton professionnel et chaleureux.',
      'Faits réels sur le réseau :',
      ...shared,
      `- Horaires : ${facts.hoursFr || facts.hoursAr || 'non communiqués'}`,
      'Règles strictes : aucun diagnostic médical, aucune recommandation de médicament, aucun prix inventé ; pour un rendez-vous, oriente vers la page de réservation du site ; en cas de douleur soudaine ou d’urgence ORL, invite à appeler ou à se rendre au centre le plus proche ; hors du domaine de l’audition, excuse-toi poliment et propose la page contact.',
    ].join('\n');
  }
  return [
    'أنت المساعد الرقمي لمنصة AUDIOLEF لخدمات السمع في الجزائر.',
    'أجب في ثلاثة إلى خمسة أسطر كحد أقصى بالعربية الفصحى المبسطة وبأسلوب مهني ودود.',
    'معلومات حقيقية عن المنصة:',
    ...shared,
    `- أوقات العمل: ${facts.hoursAr || facts.hoursFr || 'غير مدرجة'}`,
    'قواعد صارمة: لا تقدّم تشخيصًا طبيًا ولا توصيات دوائية ولا أسعارًا من عندك؛ لطلب موعد وجّه الزائر إلى صفحة الحجز في الموقع؛ في حال ألم مفاجئ أو حالة عاجلة اطلب منه الاتصال بنا أو التوجه لأقرب مركز؛ إن كان السؤال خارج نطاق السمع والمنصة اعتذر بلطف واقترح صفحة الاتصال.',
  ].join('\n');
}

router.post('/api/assistant', assistantThrottle, async (req, res) => {
  if (!ai.isConfigured()) return res.status(503).json({ error: 'not_configured' });
  const message = String((req.body && req.body.message) || '').trim().slice(0, 1000);
  if (!message) return res.status(400).json({ error: 'invalid_message' });
  const history = Array.isArray(req.body.history)
    ? req.body.history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }))
    : [];
  try {
    const facts = await assistantFacts();
    const reply = await ai.chat([
      { role: 'system', content: assistantSystemPrompt(res.locals.lang === 'fr' ? 'fr' : 'ar', facts) },
      ...history,
      { role: 'user', content: message },
    ], { maxTokens: 450, temperature: 0.3 });
    if (!reply) return res.status(502).json({ error: 'empty_reply' });
    return res.json({ reply });
  } catch (err) {
    console.error('[audiolef] assistant error:', err.code || err.message);
    const notConfigured = err.code === 'AI_NOT_CONFIGURED';
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'not_configured' : 'provider_error' });
  }
});

module.exports = router;
