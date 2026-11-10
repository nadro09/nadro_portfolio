'use strict';
// Builds the Algeria coverage map data used by the public site and the admin
// dashboard. Shapes come from algeria-map.json; centers come from the database.
const { pool } = require('./db');
const ALGERIA_MAP = require('./algeria-map.json');

// The 10 wilayas created in 2019 are drawn inside the shape of their former
// wilaya, so a centre there still highlights the right area of the map.
const MAP_PARENT = { 49: 1, 50: 1, 51: 7, 52: 8, 53: 11, 54: 11, 55: 30, 56: 33, 57: 39, 58: 47 };

async function coverageMap() {
  const { rows } = await pool.query(
    `SELECT w.id, w.name_ar, w.name_fr, count(c.id)::int AS centers
     FROM wilayas w
     LEFT JOIN centers c ON c.wilaya_id = w.id AND c.is_active = true AND c.deleted_at IS NULL
     GROUP BY w.id, w.name_ar, w.name_fr ORDER BY w.id`
  );
  const shapes = {};
  const registered = [];
  for (const w of rows) {
    const shapeId = ALGERIA_MAP.shapes[w.id] ? w.id : MAP_PARENT[w.id];
    if (!shapeId) continue;
    const shape = (shapes[shapeId] ||= { id: shapeId, d: ALGERIA_MAP.shapes[shapeId], centers: 0, wilayas: [] });
    shape.centers += w.centers;
    if (w.centers > 0) {
      const entry = { id: w.id, name_ar: w.name_ar, name_fr: w.name_fr, centers: w.centers };
      shape.wilayas.push(entry);
      registered.push(entry);
    }
  }
  registered.sort((a, b) => b.centers - a.centers || a.id - b.id);
  return { viewBox: ALGERIA_MAP.viewBox, shapes: Object.values(shapes), registered };
}

module.exports = { coverageMap };
