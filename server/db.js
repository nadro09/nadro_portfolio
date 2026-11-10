'use strict';
const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

// Keep DATE columns as plain YYYY-MM-DD strings (avoids timezone shifts).
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  // AUDIOLEF_DATABASE_URL lets a deployment use its own database when the host
  // injects a shared DATABASE_URL (e.g. a Neon integration shared with another
  // app); DATABASE_URL stays the default everywhere else.
  connectionString: process.env.AUDIOLEF_DATABASE_URL || process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

// Rows are decrypted transparently so views and exports only ever see plain
// text; writes encrypt the sensitive columns themselves (see server/crypto.js).
const { decryptRow } = require('./crypto');
const rawQuery = pool.query.bind(pool);
pool.query = function query(...args) {
  const result = rawQuery(...args);
  if (result && typeof result.then === 'function') {
    return result.then((res) => {
      if (res && Array.isArray(res.rows)) res.rows.forEach(decryptRow);
      return res;
    });
  }
  return result;
};

async function waitForDb(attempts = 40) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function initDb() {
  await waitForDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  const { seed } = require('./seed');
  await seed(pool);
}

module.exports = { pool, initDb, waitForDb };
