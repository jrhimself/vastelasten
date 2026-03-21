const express = require('express');
const router = express.Router();
const db = require('../db');
const { autoMatch } = require('./automatch');

function heeftOverlap(startDatum, eindDatum, excludeId = null) {
  const params = [eindDatum, startDatum];
  let sql = 'SELECT * FROM periodes WHERE start_datum <= ? AND eind_datum >= ?';
  if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
  return db.prepare(sql).all(...params);
}

// GET alle periodes
router.get('/', (req, res) => {
  const periodes = db.prepare('SELECT * FROM periodes ORDER BY start_datum ASC').all();
  res.json(periodes);
});

// GET overzicht van een periode: vaste lasten + status
router.get('/:id/overzicht', (req, res) => {
  const periode = db.prepare('SELECT * FROM periodes WHERE id=?').get(req.params.id);
  if (!periode) return res.status(404).json({ error: 'Periode niet gevonden' });

  const lasten = db.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all();
  const transacties = db.prepare('SELECT * FROM bank_transacties WHERE periode_id=? ORDER BY datum').all(req.params.id);

  // Sorteer op salaris-dag: items vanaf de salarisdatum komen eerst, daarna de rest (wrap-around)
  const salarisdag = new Date(periode.start_datum).getDate();
  lasten.sort((a, b) => {
    const dagA = a.verwachte_dag || 99;
    const dagB = b.verwachte_dag || 99;
    const relA = dagA >= salarisdag ? dagA - salarisdag : dagA + (31 - salarisdag);
    const relB = dagB >= salarisdag ? dagB - salarisdag : dagB + (31 - salarisdag);
    return relA - relB || a.naam.localeCompare(b.naam);
  });

  const vandaag = new Date().toISOString().slice(0, 10);

  const overgeslagenIds = new Set(
    db.prepare('SELECT last_id FROM periode_overgeslagen WHERE periode_id=?').all(req.params.id).map(r => r.last_id)
  );

  // Per-periode actief: zoek de meest recente override per last met start_datum <= huidige periode
  const periodeActiefStmt = db.prepare(`
    SELECT vpa.actief FROM vaste_last_periode_actief vpa
    JOIN periodes p ON p.id = vpa.periode_id
    WHERE vpa.last_id = ? AND p.start_datum <= ?
    ORDER BY p.start_datum DESC LIMIT 1
  `);

  const overzicht = lasten.map(last => {
    // Bepaal per-periode actief status
    const override = periodeActiefStmt.get(last.id, periode.start_datum);
    if (override && override.actief === 0) {
      return { ...last, status: 'inactief', betaling: null, handmatig_betaald: false, periode_inactief: true };
    }

    const betaling = transacties.find(t => t.gekoppeld_last_id === last.id);

    let status = 'open';
    if (betaling) {
      status = 'betaald';
    } else if (overgeslagenIds.has(last.id)) {
      status = 'overgeslagen';
    } else if (last.verwachte_dag) {
      const start = new Date(periode.start_datum);
      let verwacht = new Date(start);
      verwacht.setDate(last.verwachte_dag);
      if (verwacht < start) verwacht.setMonth(verwacht.getMonth() + 1);
      const verwachtStr = verwacht.toISOString().slice(0, 10);
      if (verwachtStr > vandaag) status = 'verwacht';
    }

    const handmatig = betaling ? betaling.handmatig_gekoppeld === 1 && !betaling.tegenrekening : false;
    return { ...last, status, betaling: betaling || null, handmatig_betaald: handmatig, periode_inactief: false };
  });

  // Periode-inactieve lasten niet meerekenen in totalen
  const actieveItems = overzicht.filter(o => !o.periode_inactief);
  const totaalVerwacht = actieveItems.reduce((s, l) => s + l.bedrag, 0);
  const totaalBetaald = actieveItems.filter(o => o.status === 'betaald').reduce((s, o) => s + o.bedrag, 0);

  // Alleen niet-genegeerde ongekoppelde transacties tonen
  const ongekoppeld = transacties.filter(t => !t.gekoppeld_last_id && !t.genegeerd);

  res.json({ periode, overzicht, totaalVerwacht, totaalBetaald, transacties: ongekoppeld });
});

// POST deactiveer vaste last voor deze en toekomstige periodes
router.post('/:id/deactiveer-last/:last_id', (req, res) => {
  db.prepare('INSERT OR REPLACE INTO vaste_last_periode_actief (last_id, periode_id, actief) VALUES (?,?,0)')
    .run(req.params.last_id, req.params.id);
  res.json({ ok: true });
});

// POST activeer vaste last vanaf deze periode
router.post('/:id/activeer-last/:last_id', (req, res) => {
  db.prepare('INSERT OR REPLACE INTO vaste_last_periode_actief (last_id, periode_id, actief) VALUES (?,?,1)')
    .run(req.params.last_id, req.params.id);
  res.json({ ok: true });
});

// POST genereer 12 periodes voor een jaar op basis van salaris_dag instelling
router.post('/genereer/:jaar', (req, res) => {
  const jaar = parseInt(req.params.jaar);
  if (!jaar || jaar < 2000 || jaar > 2100) return res.status(400).json({ error: 'Ongeldig jaar' });

  const dagRow = db.prepare("SELECT waarde FROM instellingen WHERE sleutel='salaris_dag'").get();
  const dag = Math.max(1, Math.min(31, parseInt(dagRow?.waarde) || 25));

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  const insert = db.prepare('INSERT INTO periodes (start_datum, eind_datum) VALUES (?, ?)');
  const bestaatAl = db.prepare('SELECT id FROM periodes WHERE start_datum=? LIMIT 1');
  const heeftOverlapStmt = db.prepare('SELECT id FROM periodes WHERE start_datum <= ? AND eind_datum >= ? LIMIT 1');

  let aangemaakt = 0, overgeslagen = 0;

  for (let m = 0; m < 12; m++) {
    const startDag = Math.min(dag, daysInMonth(jaar, m));
    const startDatum = `${jaar}-${String(m + 1).padStart(2, '0')}-${String(startDag).padStart(2, '0')}`;

    const volgendM = (m + 1) % 12;
    const volgendJaar = m < 11 ? jaar : jaar + 1;
    const volgendStartDag = Math.min(dag, daysInMonth(volgendJaar, volgendM));
    const volgendeStart = new Date(volgendJaar, volgendM, volgendStartDag);
    volgendeStart.setDate(volgendeStart.getDate() - 1);
    const eindDatum = volgendeStart.toISOString().slice(0, 10);

    if (bestaatAl.get(startDatum)) { overgeslagen++; continue; }
    if (heeftOverlapStmt.get(eindDatum, startDatum)) { overgeslagen++; continue; }

    insert.run(startDatum, eindDatum);
    aangemaakt++;
  }

  res.json({ aangemaakt, overgeslagen });
});

// POST nieuwe periode
router.post('/', (req, res) => {
  const { start_datum, eind_datum, salaris_bedrag, notities } = req.body;
  if (!start_datum || !eind_datum) return res.status(400).json({ error: 'start_datum en eind_datum zijn verplicht' });
  const overlap = heeftOverlap(start_datum, eind_datum);
  if (overlap.length) return res.status(400).json({ error: `Overlap met bestaande periode (${overlap[0].start_datum} t/m ${overlap[0].eind_datum})` });
  const result = db.prepare(`
    INSERT INTO periodes (start_datum, eind_datum, salaris_bedrag, notities)
    VALUES (?, ?, ?, ?)
  `).run(start_datum, eind_datum, salaris_bedrag || null, notities || '');
  res.json({ id: result.lastInsertRowid });
});

// PUT periode bijwerken
router.put('/:id', (req, res) => {
  const { start_datum, eind_datum, salaris_bedrag, notities } = req.body;
  if (!start_datum || !eind_datum) return res.status(400).json({ error: 'start_datum en eind_datum zijn verplicht' });
  const overlap = heeftOverlap(start_datum, eind_datum, req.params.id);
  if (overlap.length) return res.status(400).json({ error: `Overlap met bestaande periode (${overlap[0].start_datum} t/m ${overlap[0].eind_datum})` });
  db.prepare(`
    UPDATE periodes SET start_datum=?, eind_datum=?, salaris_bedrag=?, notities=? WHERE id=?
  `).run(start_datum, eind_datum, salaris_bedrag || null, notities || '', req.params.id);
  res.json({ ok: true });
});

// DELETE alle ongekoppelde (en niet-genegeerde) transacties van een periode
router.delete('/:id/ongekoppeld', (req, res) => {
  const info = db.prepare(`
    DELETE FROM bank_transacties WHERE periode_id=? AND gekoppeld_last_id IS NULL AND genegeerd=0
  `).run(req.params.id);
  res.json({ verwijderd: info.changes });
});

// GET alle ongekoppelde transacties (inclusief genegeerde) — voor zoekmodal
router.get('/:id/alle-ongekoppeld', (req, res) => {
  const rijen = db.prepare(
    'SELECT * FROM bank_transacties WHERE periode_id=? AND gekoppeld_last_id IS NULL ORDER BY datum'
  ).all(req.params.id);
  res.json(rijen);
});

// GET genegeerde transacties — ontdubbeld op tegenrekening (of omschrijving als geen IBAN)
router.get('/:id/genegeerd', (req, res) => {
  const rijen = db.prepare(
    'SELECT * FROM bank_transacties WHERE periode_id=? AND genegeerd=1 ORDER BY datum'
  ).all(req.params.id);

  // Groepeer op tegenrekening (of op omschrijving als geen tegenrekening)
  const gezien = new Map();
  for (const t of rijen) {
    const sleutel = t.tegenrekening ? `iban:${t.tegenrekening}` : `omschrijving:${t.omschrijving}`;
    if (!gezien.has(sleutel)) {
      gezien.set(sleutel, { ...t, aantal: 1 });
    } else {
      gezien.get(sleutel).aantal++;
    }
  }
  res.json([...gezien.values()]);
});

// POST negeer alle ongekoppelde transacties van een periode
router.post('/:id/negeer-alles', (req, res) => {
  const info = db.prepare(`
    UPDATE bank_transacties SET genegeerd=1 WHERE periode_id=? AND gekoppeld_last_id IS NULL AND genegeerd=0
  `).run(req.params.id);
  res.json({ genegeerd: info.changes });
});

// POST negeer transactie (bij volgende import overgeslagen)
router.post('/:id/negeer/:transactie_id', (req, res) => {
  db.prepare('UPDATE bank_transacties SET genegeerd=1 WHERE id=? AND periode_id=?')
    .run(req.params.transactie_id, req.params.id);
  res.json({ ok: true });
});

// DELETE herstel genegeerde transacties op basis van tegenrekening of omschrijving
router.delete('/:id/negeer/:transactie_id', (req, res) => {
  const t = db.prepare('SELECT * FROM bank_transacties WHERE id=? AND periode_id=?')
    .get(req.params.transactie_id, req.params.id);
  if (!t) return res.status(404).json({ error: 'Niet gevonden' });

  if (t.tegenrekening) {
    db.prepare('UPDATE bank_transacties SET genegeerd=0 WHERE periode_id=? AND tegenrekening=?')
      .run(req.params.id, t.tegenrekening);
  } else {
    db.prepare('UPDATE bank_transacties SET genegeerd=0 WHERE periode_id=? AND omschrijving=?')
      .run(req.params.id, t.omschrijving);
  }
  res.json({ ok: true });
});

// POST markeer alle open lasten als betaald voor alle verleden periodes
router.post('/markeer-verleden-betaald', (req, res) => {
  const vandaag = new Date().toISOString().slice(0, 10);
  const verledenPeriodes = db.prepare('SELECT * FROM periodes WHERE eind_datum < ?').all(vandaag);
  const lasten = db.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all();

  const insert = db.prepare(`
    INSERT INTO bank_transacties (datum, bedrag, omschrijving, tegenrekening, periode_id, gekoppeld_last_id, handmatig_gekoppeld)
    VALUES (?, ?, ?, '', ?, ?, 1)
  `);
  const verwijder = db.prepare(`
    DELETE FROM bank_transacties
    WHERE periode_id=? AND gekoppeld_last_id=? AND handmatig_gekoppeld=1 AND (tegenrekening IS NULL OR tegenrekening='')
  `);

  let aantalGemarkt = 0;
  for (const periode of verledenPeriodes) {
    const overgeslagenIds = new Set(
      db.prepare('SELECT last_id FROM periode_overgeslagen WHERE periode_id=?').all(periode.id).map(r => r.last_id)
    );
    const bestaandeKoppelingen = new Set(
      db.prepare('SELECT gekoppeld_last_id FROM bank_transacties WHERE periode_id=? AND gekoppeld_last_id IS NOT NULL AND genegeerd=0')
        .all(periode.id).map(r => r.gekoppeld_last_id)
    );
    for (const last of lasten) {
      if (overgeslagenIds.has(last.id)) continue;
      if (bestaandeKoppelingen.has(last.id)) continue;
      verwijder.run(periode.id, last.id);
      insert.run(periode.start_datum, -last.bedrag, 'Handmatig gemarkeerd: ' + last.naam, periode.id, last.id);
      aantalGemarkt++;
    }
  }
  res.json({ gemarkt: aantalGemarkt, periodes: verledenPeriodes.length });
});

// POST maak nieuwe vaste last aan vanuit een transactie en koppel direct
router.post('/:id/last-van-transactie', (req, res) => {
  const { transactie_id, naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon } = req.body;
  if (!naam || bedrag == null) return res.status(400).json({ error: 'naam en bedrag zijn verplicht' });

  const lastResult = db.prepare(`
    INSERT INTO vaste_lasten (naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(naam, bedrag, categorie || '', verwachte_dag || null, iban_tegenrekening || '', omschrijving_patroon || '');

  db.prepare(`
    UPDATE bank_transacties SET gekoppeld_last_id=?, handmatig_gekoppeld=1 WHERE id=? AND periode_id=?
  `).run(lastResult.lastInsertRowid, transactie_id, req.params.id);

  res.json({ last_id: lastResult.lastInsertRowid });
});

// POST hermatch één vaste last opnieuw
router.post('/:id/hermatchen/:last_id', (req, res) => {
  const periode = db.prepare('SELECT * FROM periodes WHERE id=?').get(req.params.id);
  if (!periode) return res.status(404).json({ error: 'Periode niet gevonden' });

  const lastId = parseInt(req.params.last_id);
  const lasten = db.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all();

  // Transacties die nu aan deze last hangen (auto) of nog vrij zijn
  const transacties = db.prepare(`
    SELECT * FROM bank_transacties
    WHERE periode_id=? AND handmatig_gekoppeld=0 AND genegeerd=0
    AND (gekoppeld_last_id=? OR gekoppeld_last_id IS NULL)
  `).all(req.params.id, lastId);

  const update = db.prepare('UPDATE bank_transacties SET gekoppeld_last_id=? WHERE id=?');
  let gematcht = 0;

  for (const t of transacties) {
    const matchId = autoMatch(t, lasten, periode);
    if (t.gekoppeld_last_id === lastId || matchId === lastId) {
      update.run(matchId || null, t.id);
      if (matchId === lastId) gematcht++;
    }
  }

  res.json({ ok: true, gematcht });
});

// POST hermatch alle niet-handmatig gekoppelde transacties opnieuw
router.post('/:id/hermatchen', (req, res) => {
  const periode = db.prepare('SELECT * FROM periodes WHERE id=?').get(req.params.id);
  if (!periode) return res.status(404).json({ error: 'Periode niet gevonden' });

  const lasten = db.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all();
  const transacties = db.prepare(
    'SELECT * FROM bank_transacties WHERE periode_id=? AND handmatig_gekoppeld=0 AND genegeerd=0'
  ).all(req.params.id);

  const update = db.prepare('UPDATE bank_transacties SET gekoppeld_last_id=? WHERE id=?');
  let gematcht = 0;

  for (const t of transacties) {
    const lastId = autoMatch(t, lasten, periode);
    update.run(lastId || null, t.id);
    if (lastId) gematcht++;
  }

  res.json({ hermatcht: transacties.length, gematcht });
});

// DELETE periode
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM bank_transacties WHERE periode_id=?').run(req.params.id);
  db.prepare('DELETE FROM periodes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST markeer vaste last handmatig als betaald
router.post('/:id/markeer/:last_id', (req, res) => {
  const periode = db.prepare('SELECT * FROM periodes WHERE id=?').get(req.params.id);
  if (!periode) return res.status(404).json({ error: 'Periode niet gevonden' });
  const last = db.prepare('SELECT * FROM vaste_lasten WHERE id=?').get(req.params.last_id);
  if (!last) return res.status(404).json({ error: 'Vaste last niet gevonden' });

  // Verwijder eventuele bestaande handmatige markering voor deze last in deze periode
  db.prepare(`
    DELETE FROM bank_transacties
    WHERE periode_id=? AND gekoppeld_last_id=? AND handmatig_gekoppeld=1 AND (tegenrekening IS NULL OR tegenrekening='')
  `).run(req.params.id, req.params.last_id);

  // Maak nieuwe handmatige betaling aan
  const datum = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO bank_transacties (datum, bedrag, omschrijving, tegenrekening, periode_id, gekoppeld_last_id, handmatig_gekoppeld)
    VALUES (?, ?, ?, '', ?, ?, 1)
  `).run(datum, -last.bedrag, 'Handmatig gemarkeerd: ' + last.naam, req.params.id, req.params.last_id);

  res.json({ ok: true });
});

// DELETE verwijder handmatige betaalmarkering
router.delete('/:id/markeer/:last_id', (req, res) => {
  db.prepare(`
    DELETE FROM bank_transacties
    WHERE periode_id=? AND gekoppeld_last_id=? AND handmatig_gekoppeld=1 AND (tegenrekening IS NULL OR tegenrekening='')
  `).run(req.params.id, req.params.last_id);
  res.json({ ok: true });
});

// POST sla vaste last over voor deze periode
router.post('/:id/overslaan/:last_id', (req, res) => {
  db.prepare('INSERT OR IGNORE INTO periode_overgeslagen (periode_id, last_id) VALUES (?, ?)')
    .run(req.params.id, req.params.last_id);
  res.json({ ok: true });
});

// DELETE herstel overgeslagen vaste last
router.delete('/:id/overslaan/:last_id', (req, res) => {
  db.prepare('DELETE FROM periode_overgeslagen WHERE periode_id=? AND last_id=?')
    .run(req.params.id, req.params.last_id);
  res.json({ ok: true });
});

// POST koppel transactie aan vaste last (handmatig), of ontkoppel als last_id null is
router.post('/:id/koppel', (req, res) => {
  const { transactie_id, last_id } = req.body;
  if (last_id === null || last_id === undefined) {
    db.prepare(`
      UPDATE bank_transacties SET gekoppeld_last_id=NULL, handmatig_gekoppeld=0 WHERE id=? AND periode_id=?
    `).run(transactie_id, req.params.id);
  } else {
    db.prepare(`
      UPDATE bank_transacties SET gekoppeld_last_id=?, handmatig_gekoppeld=1 WHERE id=? AND periode_id=?
    `).run(last_id, transactie_id, req.params.id);
  }
  res.json({ ok: true });
});

module.exports = router;
