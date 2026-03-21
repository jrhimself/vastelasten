const express = require('express');
const router = express.Router();
const db = require('../db');

// GET alle vaste lasten
router.get('/', (req, res) => {
  const lasten = db.prepare('SELECT * FROM vaste_lasten ORDER BY verwachte_dag, naam').all();
  res.json(lasten);
});

// POST nieuwe vaste last
router.post('/', (req, res) => {
  const { naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon } = req.body;
  if (!naam || bedrag == null) return res.status(400).json({ error: 'naam en bedrag zijn verplicht' });
  const stmt = db.prepare(`
    INSERT INTO vaste_lasten (naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const result = stmt.run(naam, bedrag, categorie || '', verwachte_dag || null, iban_tegenrekening || '', omschrijving_patroon || '');
  res.json({ id: result.lastInsertRowid });
});

// PUT vaste last bijwerken
router.put('/:id', (req, res) => {
  const { naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief } = req.body;
  db.prepare(`
    UPDATE vaste_lasten SET naam=?, bedrag=?, categorie=?, verwachte_dag=?, iban_tegenrekening=?, omschrijving_patroon=?, actief=?
    WHERE id=?
  `).run(naam, bedrag, categorie || '', verwachte_dag || null, iban_tegenrekening || '', omschrijving_patroon || '', actief ?? 1, req.params.id);
  res.json({ ok: true });
});

// DELETE vaste last
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM vaste_last_periode_actief WHERE last_id=?').run(id);
  db.prepare('DELETE FROM periode_overgeslagen WHERE last_id=?').run(id);
  db.prepare('UPDATE bank_transacties SET gekoppeld_last_id=NULL, handmatig_gekoppeld=0 WHERE gekoppeld_last_id=?').run(id);
  db.prepare('DELETE FROM vaste_lasten WHERE id=?').run(id);
  res.json({ ok: true });
});

module.exports = router;
