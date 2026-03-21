const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/transacties?q=zoekterm&periode_id=123
router.get('/', (req, res) => {
  const { q, periode_id } = req.query;

  let sql = `
    SELECT bt.*, p.start_datum as periode_start, vl.naam as last_naam
    FROM bank_transacties bt
    LEFT JOIN periodes p ON p.id = bt.periode_id
    LEFT JOIN vaste_lasten vl ON vl.id = bt.gekoppeld_last_id
    WHERE 1=1
  `;
  const params = [];

  if (periode_id) {
    sql += ' AND bt.periode_id = ?';
    params.push(periode_id);
  }

  if (q && q.trim()) {
    const term = '%' + q.trim() + '%';
    sql += ' AND (bt.omschrijving LIKE ? OR bt.tegenrekening LIKE ? OR CAST(bt.bedrag AS TEXT) LIKE ?)';
    params.push(term, term, term);
  }

  sql += ' ORDER BY bt.datum DESC LIMIT 500';

  const rijen = db.prepare(sql).all(...params);
  res.json(rijen);
});

module.exports = router;
