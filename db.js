const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('vaste-lasten.db', { open: true });

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS vaste_lasten (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naam TEXT NOT NULL,
    bedrag REAL NOT NULL,
    categorie TEXT DEFAULT '',
    verwachte_dag INTEGER,
    iban_tegenrekening TEXT DEFAULT '',
    omschrijving_patroon TEXT DEFAULT '',
    actief INTEGER DEFAULT 1
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS periodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_datum TEXT NOT NULL,
    eind_datum TEXT,
    salaris_bedrag REAL,
    notities TEXT DEFAULT ''
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bank_transacties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    datum TEXT NOT NULL,
    bedrag REAL NOT NULL,
    omschrijving TEXT DEFAULT '',
    tegenrekening TEXT DEFAULT '',
    periode_id INTEGER REFERENCES periodes(id),
    gekoppeld_last_id INTEGER REFERENCES vaste_lasten(id),
    handmatig_gekoppeld INTEGER DEFAULT 0,
    genegeerd INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS periode_overgeslagen (
    periode_id INTEGER REFERENCES periodes(id),
    last_id INTEGER REFERENCES vaste_lasten(id),
    PRIMARY KEY (periode_id, last_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS vaste_last_periode_actief (
    last_id INTEGER REFERENCES vaste_lasten(id),
    periode_id INTEGER REFERENCES periodes(id),
    actief INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (last_id, periode_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS instellingen (
    sleutel TEXT PRIMARY KEY,
    waarde TEXT NOT NULL DEFAULT ''
  )
`);

// Migratie: kolom toevoegen als die nog niet bestaat
try { db.exec('ALTER TABLE bank_transacties ADD COLUMN genegeerd INTEGER DEFAULT 0'); } catch {}


module.exports = db;
