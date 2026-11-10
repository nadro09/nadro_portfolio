'use strict';
// At-rest encryption for sensitive free-text fields (booking notes, internal
// notes, message bodies). Values are stored as `enc:v1:<iv>:<tag>:<data>`
// (AES-256-GCM). Anything without that prefix is legacy plain text and is
// returned unchanged, so existing rows keep working.
//
// The key is derived from SESSION_SECRET with HKDF, so no extra credential is
// needed. Rotating SESSION_SECRET makes previously encrypted values
// unreadable — export the backup before rotating it.
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const SECRET = String(process.env.SESSION_SECRET || '');

const KEY = SECRET
  ? Buffer.from(crypto.hkdfSync('sha256', SECRET, 'audiolef-at-rest', 'pii-v1', 32))
  : null;

if (!KEY) {
  console.warn('[audiolef] SESSION_SECRET is not set — sensitive free-text fields are stored as plain text.');
}

// Columns whose content is encrypted at rest. Every read goes through the
// pool wrapper in db.js, which decrypts them before the row reaches a view.
const ENCRYPTED_COLUMNS = new Set(['notes', 'internal_notes', 'body', 'note']);

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(value) {
  if (value === null || value === undefined || value === '') return value;
  const text = String(value);
  if (!KEY || isEncrypted(text)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return PREFIX + [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(value) {
  if (!isEncrypted(value)) return value;
  if (!KEY) return '';
  try {
    const [iv, tag, data] = value.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('[audiolef] could not decrypt a stored value:', err.message);
    return '';
  }
}

function decryptRow(row) {
  if (!row || typeof row !== 'object') return row;
  for (const column of ENCRYPTED_COLUMNS) {
    if (isEncrypted(row[column])) row[column] = decrypt(row[column]);
  }
  return row;
}

module.exports = { encrypt, decrypt, decryptRow, isEncrypted, ENCRYPTED_COLUMNS };
