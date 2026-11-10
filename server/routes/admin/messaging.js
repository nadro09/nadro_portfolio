'use strict';
const express = require('express');
const path = require('path');
const multer = require('multer');
const { pool } = require('../../db');
const { requirePerm, verifyCsrfAfterUpload } = require('../../auth');
const H = require('../../helpers');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'data', 'uploads');

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(UPLOAD_DIR, 'attachments'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    return cb(new Error('file_type_not_allowed'));
  },
});

router.use(requirePerm('internal.use'));

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [req.user.id];
    let search = '';
    if (q) {
      params.push(`%${q}%`);
      search = ` AND (c.subject ILIKE $2 OR EXISTS (
        SELECT 1 FROM conversation_participants p2 JOIN employees e2 ON e2.id = p2.employee_id
        WHERE p2.conversation_id = c.id AND e2.full_name ILIKE $2))`;
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.subject, c.created_at,
              (SELECT max(m.created_at) FROM internal_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS last_at,
              (SELECT m.body FROM internal_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                ORDER BY m.created_at DESC LIMIT 1) AS last_body,
              (SELECT count(*)::int FROM internal_messages m
                WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.deleted_at IS NULL
                  AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS unread,
              (SELECT string_agg(e2.full_name, '، ' ORDER BY e2.full_name)
                 FROM conversation_participants p2 JOIN employees e2 ON e2.id = p2.employee_id
                 WHERE p2.conversation_id = c.id) AS participants
       FROM internal_conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.employee_id = $1
       WHERE true ${search}
       ORDER BY coalesce((SELECT max(m.created_at) FROM internal_messages m WHERE m.conversation_id = c.id), c.created_at) DESC`,
      params
    );
    res.render('admin/messages', {
      title: res.locals.t('inbox'), active: 'messages', conversations: rows, filters: { q },
    });
  } catch (err) { next(err); }
});

router.get('/new', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, job_title_ar, job_title_fr, center_id FROM employees
       WHERE is_active = true AND deleted_at IS NULL AND id <> $1 ORDER BY full_name`, [req.user.id]
    );
    res.render('admin/message-new', { title: res.locals.t('new_conversation'), active: 'messages', employees: rows, errors: [] });
  } catch (err) { next(err); }
});

router.post('/new', upload.single('attachment'), verifyCsrfAfterUpload, async (req, res, next) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '').trim();
    const participants = [].concat(req.body.participants || []).map(Number).filter((n) => n && n !== req.user.id);
    const errors = [];
    if (subject.length < 3) errors.push({ field: 'subject', message: res.locals.t('subject_required') });
    if (body.length < 1 && !req.file) errors.push({ field: 'body', message: res.locals.t('message_required') });
    if (!participants.length) errors.push({ field: 'participants', message: res.locals.t('field_required') });
    if (errors.length) {
      const { rows } = await pool.query(
        `SELECT id, full_name, job_title_ar, job_title_fr, center_id FROM employees
         WHERE is_active = true AND deleted_at IS NULL AND id <> $1 ORDER BY full_name`, [req.user.id]
      );
      return res.status(422).render('admin/message-new', {
        title: res.locals.t('new_conversation'), active: 'messages', employees: rows, errors,
      });
    }
    const conv = await pool.query(
      'INSERT INTO internal_conversations (subject, created_by) VALUES ($1,$2) RETURNING id', [subject, req.user.id]
    );
    const convId = conv.rows[0].id;
    await pool.query(
      'INSERT INTO conversation_participants (conversation_id, employee_id, last_read_at) VALUES ($1,$2,now()) ON CONFLICT DO NOTHING',
      [convId, req.user.id]
    );
    for (const p of participants) {
      await pool.query(
        'INSERT INTO conversation_participants (conversation_id, employee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [convId, p]
      );
    }
    const msg = await pool.query(
      'INSERT INTO internal_messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id',
      [convId, req.user.id, body || '📎']
    );
    if (req.file) await saveAttachment(req, msg.rows[0].id);
    await H.notifyEmployees(participants, {
      type: 'message_new', titleAr: 'رسالة داخلية جديدة', titleFr: 'Nouveau message interne',
      bodyAr: `${subject} — ${req.user.full_name}`, bodyFr: `${subject} — ${req.user.full_name}`,
      link: `/admin/messages/${convId}`, entityType: 'conversation', entityId: convId,
    });
    await H.audit(req, { action: 'conversation_created', entityType: 'conversation', entityId: convId, newValues: { subject, participants } });
    res.redirect(`/admin/messages/${convId}`);
  } catch (err) { next(err); }
});

async function saveAttachment(req, messageId) {
  const stored = `/uploads/attachments/${req.file.filename}`;
  await pool.query(
    `INSERT INTO attachments (uploader_id, entity_type, entity_id, original_name, stored_name, mime_type, size_bytes)
     VALUES ($1,'internal_message',$2,$3,$4,$5,$6)`,
    [req.user.id, messageId, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size]
  );
  return stored;
}

async function assertParticipant(req, conversationId) {
  const member = await pool.query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND employee_id = $2',
    [conversationId, req.user.id]
  );
  return member.rowCount > 0;
}

router.get('/attachments/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `SELECT a.*, m.conversation_id FROM attachments a
       JOIN internal_messages m ON m.id = a.entity_id AND a.entity_type = 'internal_message'
       WHERE a.id = $1`, [id]
    );
    if (!rows.length) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    if (!(await assertParticipant(req, rows[0].conversation_id))) {
      return res.status(403).render('errors/403', { title: res.locals.t('forbidden_title') });
    }
    const filePath = path.join(UPLOAD_DIR, 'attachments', path.basename(rows[0].stored_name));
    await H.audit(req, { action: 'attachment_downloaded', entityType: 'attachment', entityId: id });
    res.download(filePath, rows[0].original_name);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await assertParticipant(req, id))) {
      return res.status(403).render('errors/403', { title: res.locals.t('forbidden_title') });
    }
    const conv = await pool.query('SELECT * FROM internal_conversations WHERE id = $1', [id]);
    if (!conv.rowCount) return res.status(404).render('errors/404', { title: res.locals.t('not_found_title') });
    const messages = await pool.query(
      `SELECT m.*, e.full_name, e.avatar_path,
              (SELECT json_agg(json_build_object('id', a.id, 'name', a.original_name, 'size', a.size_bytes))
                 FROM attachments a WHERE a.entity_type = 'internal_message' AND a.entity_id = m.id) AS attachments
       FROM internal_messages m LEFT JOIN employees e ON e.id = m.sender_id
       WHERE m.conversation_id = $1 AND m.deleted_at IS NULL ORDER BY m.created_at ASC`, [id]
    );
    const participants = await pool.query(
      `SELECT e.id, e.full_name, e.job_title_ar, e.job_title_fr, c.name_ar AS center_ar, c.name_fr AS center_fr
       FROM conversation_participants p JOIN employees e ON e.id = p.employee_id
       LEFT JOIN centers c ON c.id = e.center_id
       WHERE p.conversation_id = $1 ORDER BY e.full_name`, [id]
    );
    await pool.query(
      'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND employee_id = $2',
      [id, req.user.id]
    );
    res.render('admin/message-thread', {
      title: conv.rows[0].subject, active: 'messages', conversation: conv.rows[0],
      messages: messages.rows, participants: participants.rows, errors: [],
    });
  } catch (err) { next(err); }
});

router.post('/:id/reply', upload.single('attachment'), verifyCsrfAfterUpload, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await assertParticipant(req, id))) {
      return res.status(403).render('errors/403', { title: res.locals.t('forbidden_title') });
    }
    const body = String(req.body.body || '').trim();
    if (!body && !req.file) return res.redirect(`/admin/messages/${id}`);
    const msg = await pool.query(
      'INSERT INTO internal_messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id',
      [id, req.user.id, body || '📎']
    );
    if (req.file) await saveAttachment(req, msg.rows[0].id);
    await pool.query('UPDATE internal_conversations SET updated_at = now() WHERE id = $1', [id]);
    await pool.query(
      'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND employee_id = $2',
      [id, req.user.id]
    );
    const others = await pool.query(
      'SELECT employee_id FROM conversation_participants WHERE conversation_id = $1 AND employee_id <> $2',
      [id, req.user.id]
    );
    await H.notifyEmployees(others.rows.map((r) => r.employee_id), {
      type: 'message_new', titleAr: 'رسالة داخلية جديدة', titleFr: 'Nouveau message interne',
      bodyAr: `${req.user.full_name}`, bodyFr: `${req.user.full_name}`,
      link: `/admin/messages/${id}`, entityType: 'conversation', entityId: id,
    });
    await H.audit(req, { action: 'message_sent', entityType: 'conversation', entityId: id });
    res.redirect(`/admin/messages/${id}`);
  } catch (err) { next(err); }
});

module.exports = router;
