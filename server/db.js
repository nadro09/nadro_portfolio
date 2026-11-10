'use strict';
const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

// Keep DATE columns as plain YYYY-MM-DD strings (avoids timezone shifts).
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

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
