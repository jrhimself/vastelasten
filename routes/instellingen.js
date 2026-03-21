const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT sleutel, waarde FROM instellingen').all();
  const result = {};
  for (const r of rows) result[r.sleutel] = r.waarde;
  res.json(result);
});

router.put('/:sleutel', (req, res) => {
  const { waarde } = req.body;
  db.prepare('INSERT OR REPLACE INTO instellingen (sleutel, waarde) VALUES (?,?)')
    .run(req.params.sleutel, String(waarde ?? ''));
  res.json({ ok: true });
});

module.exports = router;
