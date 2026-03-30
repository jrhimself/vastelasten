PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vaste_lasten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naam TEXT NOT NULL,
  bedrag REAL NOT NULL,
  categorie TEXT DEFAULT '',
  verwachte_dag INTEGER,
  iban_tegenrekening TEXT DEFAULT '',
  omschrijving_patroon TEXT DEFAULT '',
  actief INTEGER DEFAULT 1,
  afwijking_drempel REAL
);

CREATE TABLE IF NOT EXISTS periodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_datum TEXT NOT NULL,
  eind_datum TEXT,
  salaris_bedrag REAL,
  notities TEXT DEFAULT ''
);

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
);

CREATE TABLE IF NOT EXISTS periode_overgeslagen (
  periode_id INTEGER REFERENCES periodes(id),
  last_id INTEGER REFERENCES vaste_lasten(id),
  PRIMARY KEY (periode_id, last_id)
);

CREATE TABLE IF NOT EXISTS vaste_last_periode_actief (
  last_id INTEGER REFERENCES vaste_lasten(id),
  periode_id INTEGER REFERENCES periodes(id),
  actief INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (last_id, periode_id)
);

CREATE TABLE IF NOT EXISTS instellingen (
  sleutel TEXT PRIMARY KEY,
  waarde TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS vaste_last_jaar_overrides (
  last_id INTEGER REFERENCES vaste_lasten(id) ON DELETE CASCADE,
  jaar INTEGER NOT NULL,
  bedrag REAL,
  naam TEXT,
  categorie TEXT,
  verwachte_dag INTEGER,
  iban_tegenrekening TEXT,
  omschrijving_patroon TEXT,
  actief INTEGER,
  afwijking_drempel REAL,
  PRIMARY KEY (last_id, jaar)
);
