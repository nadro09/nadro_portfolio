'use strict';
// Serverless entry point (Vercel). The Express app is exported as the request
// handler; the database schema and seed data are prepared once per function
// instance, before the first request is served.
const app = require('../server/index');
const { initDb } = require('../server/db');

let ready = null;

function ensureDatabase() {
  if (!ready) {
    ready = initDb().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

module.exports = async (req, res) => {
  try {
    await ensureDatabase();
  } catch (err) {
    console.error('[audiolef] database initialization failed:', err.message);
    res.status(500).send('Service temporarily unavailable');
    return;
  }
  return app(req, res);
};
