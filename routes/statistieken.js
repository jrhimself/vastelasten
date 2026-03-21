const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/statistieken
router.get('/', (req, res) => {
  const lasten = db.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all();
  const periodes = db.prepare('SELECT * FROM periodes ORDER BY start_datum ASC').all();

  // Verdeling per categorie (op basis van actieve vaste lasten)
  const categorieMap = {};
  for (const l of lasten) {
    const cat = l.categorie && l.categorie.trim() ? l.categorie.trim() : 'Overig';
    categorieMap[cat] = (categorieMap[cat] || 0) + l.bedrag;
  }
  const categorieën = Object.entries(categorieMap)
    .sort((a, b) => b[1] - a[1])
    .map(([naam, bedrag]) => ({ naam, bedrag: Math.round(bedrag * 100) / 100 }));

  // Per-periode actief override: meest recente entry met start_datum <= periode start
  const periodeActiefStmt = db.prepare(`
    SELECT vpa.actief FROM vaste_last_periode_actief vpa
    JOIN periodes p ON p.id = vpa.periode_id
    WHERE vpa.last_id = ? AND p.start_datum <= ?
    ORDER BY p.start_datum DESC LIMIT 1
  `);

  // Per periode: verwacht vs betaald (rekening houdend met per-periode deactivaties)
  const periodeData = periodes.map(p => {
    const verwacht = lasten.reduce((s, l) => {
      const override = periodeActiefStmt.get(l.id, p.start_datum);
      if (override && override.actief === 0) return s;
      return s + l.bedrag;
    }, 0);

    const betaald = db.prepare(`
      SELECT COALESCE(SUM(vl.bedrag), 0) as totaal
      FROM bank_transacties bt
      JOIN vaste_lasten vl ON bt.gekoppeld_last_id = vl.id
      WHERE bt.periode_id = ? AND bt.genegeerd = 0
    `).get(p.id);
    const overgeslagenCount = db.prepare(
      'SELECT COUNT(*) as n FROM periode_overgeslagen WHERE periode_id=?'
    ).get(p.id).n;
    return {
      label: p.start_datum.slice(0, 7),
      verwacht: Math.round(verwacht * 100) / 100,
      betaald: Math.round((betaald.totaal || 0) * 100) / 100,
      overgeslagen: overgeslagenCount
    };
  });

  res.json({ categorieën, periodeData });
});

module.exports = router;
