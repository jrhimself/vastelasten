const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db');
const { autoMatch } = require('./automatch');

const upload = multer({ storage: multer.memoryStorage() });

function parseEuropeanAmount(str) {
  if (!str) return null;
  str = str.trim().replace(/['"]/g, '');
  // 1.234,56 -> 1234.56
  if (str.includes(',') && str.includes('.')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  // DD-MM-YYYY
  let m = str.match(/^(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // YYYY-MM-DD
  m = str.match(/^(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // YYYYMMDD
  m = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Splits één CSV-rij op delimiter met respect voor geciteerde velden
// Bijv. `"foo","bar,baz","qux"` → ['foo', 'bar,baz', 'qux']
function splitCSVRow(line, delim) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } // escaped quote
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function detectDelimiter(text) {
  // Tel alleen buiten aanhalingstekens om komma's in bedragen te negeren
  const line = text.split('\n')[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts[ch] !== undefined) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCSV(text) {
  const delim = detectDelimiter(text);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // zoek header rij
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (splitCSVRow(lines[i], delim).length >= 3) { headerIdx = i; break; }
  }

  const headers = splitCSVRow(lines[headerIdx], delim).map(h => h.replace(/['"]/g, '').toLowerCase());
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCSVRow(lines[i], delim);
    if (cols.length < 2) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

// Probeer bekende bankformaten te mappen op {datum, bedrag, omschrijving, tegenrekening}
function mapBankRow(row) {
  const keys = Object.keys(row);

  // ING
  if (keys.includes('datum') && keys.includes('bedrag (eur)')) {
    const sign = (row['af bij'] || '').toLowerCase() === 'af' ? -1 : 1;
    return {
      datum: parseDate(row['datum']),
      bedrag: sign * (parseEuropeanAmount(row['bedrag (eur)']) || 0),
      omschrijving: row['naam / omschrijving'] || row['mededelingen'] || '',
      tegenrekening: row['tegenrekening'] || ''
    };
  }

  // ABN AMRO
  if (keys.includes('transactiedatum') || keys.includes('rekeningnummer')) {
    return {
      datum: parseDate(row['transactiedatum'] || row['datum']),
      bedrag: parseEuropeanAmount(row['bedrag'] || row['amount']),
      omschrijving: row['omschrijving'] || row['description'] || '',
      tegenrekening: row['tegenrekening'] || row['counterparty account'] || ''
    };
  }

  // Rabobank (herkend aan 'volgnr' kolom)
  if (keys.includes('volgnr') && keys.includes('datum') && keys.includes('bedrag')) {
    // Bedrag heeft +/- teken ingebakken (bijv. "+4295,91" of "-2,40")
    const bedrag = parseEuropeanAmount(row['bedrag']) || 0;
    // Combineer beschikbare omschrijvingsvelden voor beste matching
    const omschrijving = [
      row['naam tegenpartij'],
      row['naam uiteindelijke partij'],
      row['omschrijving-1']
    ].filter(s => s && s.trim() && s.trim() !== ' ').join(' | ').trim();
    return {
      datum: parseDate(row['datum']),
      bedrag,
      omschrijving,
      tegenrekening: row['tegenrekening iban/bban'] || ''
    };
  }

  // Generiek fallback
  const datumKey = keys.find(k => k.includes('datum') || k.includes('date'));
  const bedragKey = keys.find(k => k.includes('bedrag') || k.includes('amount'));
  const omschrijvingKey = keys.find(k => k.includes('omschrijving') || k.includes('description') || k.includes('naam'));
  const tegenKey = keys.find(k => k.includes('tegenrekening') || k.includes('iban') || k.includes('counterpart'));

  return {
    datum: datumKey ? parseDate(row[datumKey]) : null,
    bedrag: bedragKey ? parseEuropeanAmount(row[bedragKey]) : null,
    omschrijving: omschrijvingKey ? row[omschrijvingKey] : '',
    tegenrekening: tegenKey ? row[tegenKey] : ''
  };
}


// POST /api/import/preview — parse CSV, geef preview terug zonder op te slaan
router.post('/preview', upload.single('bestand'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand' });
  const text = req.file.buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  try {
    const rows = parseCSV(text);
    const transacties = rows.map(mapBankRow).filter(t => t.datum && t.bedrag != null);
    res.json({ transacties, totaal: transacties.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/import/opslaan — sla transacties op, verdeel over periodes op datum
router.post('/opslaan', (req, res) => {
  const { transacties } = req.body;
  if (!Array.isArray(transacties)) return res.status(400).json({ error: 'transacties zijn verplicht' });

  // Haal alle periodes op, gesorteerd op startdatum
  const allePeriodes = db.prepare('SELECT * FROM periodes ORDER BY start_datum ASC').all();
  if (!allePeriodes.length) return res.status(400).json({ error: 'Geen periodes gevonden' });

  const lasten = db.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all();

  // Bouw genegeerd-sets per periode (enige reden om een transactie over te slaan)
  const genegeerdIbansPerPeriode = new Map();
  const genegeerdOmschrijvingenPerPeriode = new Map();
  for (const p of allePeriodes) {
    const rijen = db.prepare('SELECT tegenrekening, omschrijving FROM bank_transacties WHERE periode_id=? AND genegeerd=1').all(p.id);
    genegeerdIbansPerPeriode.set(p.id, new Set(rijen.filter(t => t.tegenrekening).map(t => t.tegenrekening)));
    genegeerdOmschrijvingenPerPeriode.set(p.id, new Set(rijen.filter(t => !t.tegenrekening).map(t => t.omschrijving)));
  }

  const insert = db.prepare(`
    INSERT INTO bank_transacties (datum, bedrag, omschrijving, tegenrekening, periode_id, gekoppeld_last_id, handmatig_gekoppeld)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `);
  const bestaatAl = db.prepare(`
    SELECT id FROM bank_transacties
    WHERE datum=? AND bedrag=? AND omschrijving=? AND tegenrekening=? AND periode_id=?
    LIMIT 1
  `);

  let aantalGematcht = 0, aantalOvergeslagen = 0, aantalGeenPeriode = 0, aantalDubbel = 0;
  for (const t of transacties) {
    // Zoek de periode waarvan de transactiedatum binnen het bereik valt
    const periode = allePeriodes.find(p =>
      t.datum >= p.start_datum && (!p.eind_datum || t.datum <= p.eind_datum)
    );
    if (!periode) { aantalGeenPeriode++; continue; }

    if (t.tegenrekening && genegeerdIbansPerPeriode.get(periode.id).has(t.tegenrekening)) { aantalOvergeslagen++; continue; }
    if (!t.tegenrekening && t.omschrijving && genegeerdOmschrijvingenPerPeriode.get(periode.id).has(t.omschrijving)) { aantalOvergeslagen++; continue; }

    // Sla over als deze transactie al exact in de database staat
    const bestaat = bestaatAl.get(t.datum, t.bedrag, t.omschrijving || '', t.tegenrekening || '', periode.id);
    if (bestaat) { aantalDubbel++; continue; }

    const lastId = autoMatch(t, lasten, periode);
    if (lastId) aantalGematcht++;
    insert.run(t.datum, t.bedrag, t.omschrijving || '', t.tegenrekening || '', periode.id, lastId || null);
  }

  res.json({
    opgeslagen: transacties.length - aantalOvergeslagen - aantalGeenPeriode - aantalDubbel,
    gematcht: aantalGematcht,
    genegeerd: aantalOvergeslagen,
    geenPeriode: aantalGeenPeriode,
    dubbel: aantalDubbel
  });
});

module.exports = router;
