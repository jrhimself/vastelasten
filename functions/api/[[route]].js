// ===== Auth helpers =====

async function hmacSign(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSessionToken(secret) {
  const expires = Date.now() + 90 * 24 * 60 * 60 * 1000; // 90 dagen
  const payload = `session:${expires}`;
  const signature = await hmacSign(payload, secret);
  return `${payload}:${signature}`;
}

async function verifySessionToken(token, secret) {
  if (!token) return false;
  const parts = token.split(':');
  if (parts.length !== 3) return false;
  const [prefix, expires, signature] = parts;
  const payload = `${prefix}:${expires}`;
  const expected = await hmacSign(payload, secret);
  if (signature !== expected) return false;
  if (Date.now() > parseInt(expires)) return false;
  return true;
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

// ===== autoMatch + CSV parsing (extracted to lib for testability) =====

import { autoMatch } from '../../lib/automatch.js';
import { parseEuropeanAmount, parseDate, parseCSV } from '../../lib/csv.js';

function mapBankRow(row) {
  const keys = Object.keys(row);

  if (keys.includes('datum') && keys.includes('bedrag (eur)')) {
    const sign = (row['af bij'] || '').toLowerCase() === 'af' ? -1 : 1;
    return {
      datum: parseDate(row['datum']),
      bedrag: sign * (parseEuropeanAmount(row['bedrag (eur)']) || 0),
      omschrijving: row['naam / omschrijving'] || row['mededelingen'] || '',
      tegenrekening: row['tegenrekening'] || ''
    };
  }

  if (keys.includes('transactiedatum') || keys.includes('rekeningnummer')) {
    return {
      datum: parseDate(row['transactiedatum'] || row['datum']),
      bedrag: parseEuropeanAmount(row['bedrag'] || row['amount']),
      omschrijving: row['omschrijving'] || row['description'] || '',
      tegenrekening: row['tegenrekening'] || row['counterparty account'] || ''
    };
  }

  if (keys.includes('volgnr') && keys.includes('datum') && keys.includes('bedrag')) {
    const bedrag = parseEuropeanAmount(row['bedrag']) || 0;
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

// ===== URL router =====

function matchPath(pattern, path) {
  const regex = new RegExp('^' + pattern.replace(/:([^/]+)/g, '(?<$1>[^/]+)') + '$');
  const m = regex.exec(path);
  return m ? (m.groups || {}) : null;
}

// ===== Route handlers =====

async function handleLasten(path, method, request, env) {
  let m;

  // GET /lasten
  if (path === '/lasten' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM vaste_lasten ORDER BY verwachte_dag, naam'
    ).all();
    return Response.json(results);
  }

  // POST /lasten
  if (path === '/lasten' && method === 'POST') {
    const { naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon } = await request.json();
    if (!naam || bedrag == null) return Response.json({ error: 'naam en bedrag zijn verplicht' }, { status: 400 });
    const result = await env.DB.prepare(`
      INSERT INTO vaste_lasten (naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).bind(naam, bedrag, categorie || '', verwachte_dag || null, iban_tegenrekening || '', omschrijving_patroon || '').run();
    return Response.json({ id: result.meta.last_row_id });
  }

  // PUT /lasten/:id/jaar/:jaar  (must be before /lasten/:id)
  if ((m = matchPath('/lasten/:id/jaar/:jaar', path)) && method === 'PUT') {
    const { naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief, afwijking_drempel } = await request.json();
    // Preserve existing field values when only updating one field
    const bestaand = await env.DB.prepare('SELECT * FROM vaste_last_jaar_overrides WHERE last_id=? AND jaar=?').bind(m.id, m.jaar).first();
    const globaal = await env.DB.prepare('SELECT * FROM vaste_lasten WHERE id=?').bind(m.id).first();
    const base = bestaand || globaal || {};
    await env.DB.prepare(`
      INSERT OR REPLACE INTO vaste_last_jaar_overrides
        (last_id, jaar, naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief, afwijking_drempel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      m.id, m.jaar,
      naam ?? base.naam ?? null,
      bedrag ?? base.bedrag ?? null,
      categorie ?? base.categorie ?? '',
      verwachte_dag ?? base.verwachte_dag ?? null,
      iban_tegenrekening ?? base.iban_tegenrekening ?? '',
      omschrijving_patroon ?? base.omschrijving_patroon ?? '',
      actief ?? base.actief ?? null,
      afwijking_drempel !== undefined ? afwijking_drempel : (base.afwijking_drempel ?? null)
    ).run();
    return Response.json({ ok: true });
  }

  // PUT /lasten/:id
  if ((m = matchPath('/lasten/:id', path)) && method === 'PUT') {
    const { naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief, afwijking_drempel } = await request.json();
    await env.DB.prepare(`
      UPDATE vaste_lasten SET naam=?, bedrag=?, categorie=?, verwachte_dag=?, iban_tegenrekening=?, omschrijving_patroon=?, actief=?, afwijking_drempel=?
      WHERE id=?
    `).bind(naam, bedrag, categorie || '', verwachte_dag || null, iban_tegenrekening || '', omschrijving_patroon || '', actief ?? 1, afwijking_drempel ?? null, m.id).run();
    return Response.json({ ok: true });
  }

  // DELETE /lasten/:id
  if ((m = matchPath('/lasten/:id', path)) && method === 'DELETE') {
    const id = m.id;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM vaste_last_periode_actief WHERE last_id=?').bind(id),
      env.DB.prepare('DELETE FROM periode_overgeslagen WHERE last_id=?').bind(id),
      env.DB.prepare('DELETE FROM vaste_last_jaar_overrides WHERE last_id=?').bind(id),
      env.DB.prepare('UPDATE bank_transacties SET gekoppeld_last_id=NULL, handmatig_gekoppeld=0 WHERE gekoppeld_last_id=?').bind(id),
      env.DB.prepare('DELETE FROM vaste_lasten WHERE id=?').bind(id),
    ]);
    return Response.json({ ok: true });
  }

  return null;
}

function applyJaarOverridesOpLasten(lasten, jaarOverrides) {
  if (!jaarOverrides.length) return lasten;
  return lasten
    .filter(l => !jaarOverrides.find(o => o.last_id === l.id && o.actief === 0))
    .map(l => {
      const o = jaarOverrides.find(o => o.last_id === l.id);
      if (!o) return l;
      const merged = { ...l };
      if (o.naam != null) merged.naam = o.naam;
      if (o.bedrag != null) merged.bedrag = o.bedrag;
      if (o.categorie != null) merged.categorie = o.categorie;
      if (o.verwachte_dag != null) merged.verwachte_dag = o.verwachte_dag;
      if (o.iban_tegenrekening != null) merged.iban_tegenrekening = o.iban_tegenrekening;
      if (o.omschrijving_patroon != null) merged.omschrijving_patroon = o.omschrijving_patroon;
      if (o.afwijking_drempel != null) merged.afwijking_drempel = o.afwijking_drempel;
      return merged;
    });
}

async function kopieerJaarOverridesIndienNieuw(nieuwJaar, env) {
  const bestaatAl = await env.DB.prepare(
    'SELECT 1 FROM vaste_last_jaar_overrides WHERE jaar=? LIMIT 1'
  ).bind(nieuwJaar).first();
  if (bestaatAl) return;

  // Zoek dichtstbijzijnde jaar met overrides (verleden of toekomst)
  const [vorigeRow, volgendeRow] = await Promise.all([
    env.DB.prepare('SELECT MAX(jaar) AS jaar FROM vaste_last_jaar_overrides WHERE jaar<?').bind(nieuwJaar).first(),
    env.DB.prepare('SELECT MIN(jaar) AS jaar FROM vaste_last_jaar_overrides WHERE jaar>?').bind(nieuwJaar).first(),
  ]);

  let bronJaar = null;
  if (vorigeRow?.jaar && volgendeRow?.jaar) {
    bronJaar = (nieuwJaar - vorigeRow.jaar <= volgendeRow.jaar - nieuwJaar) ? vorigeRow.jaar : volgendeRow.jaar;
  } else if (vorigeRow?.jaar) {
    bronJaar = vorigeRow.jaar;
  } else if (volgendeRow?.jaar) {
    bronJaar = volgendeRow.jaar;
  }
  if (!bronJaar) return;

  const { results: kopie } = await env.DB.prepare(
    'SELECT * FROM vaste_last_jaar_overrides WHERE jaar=?'
  ).bind(bronJaar).all();
  if (!kopie.length) return;

  await env.DB.batch(kopie.map(r =>
    env.DB.prepare(`
      INSERT OR IGNORE INTO vaste_last_jaar_overrides
        (last_id, jaar, naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief, afwijking_drempel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(r.last_id, nieuwJaar, r.naam, r.bedrag, r.categorie, r.verwachte_dag, r.iban_tegenrekening, r.omschrijving_patroon, r.actief, r.afwijking_drempel)
  ));
}

async function handlePeriodes(path, method, request, env) {
  let m;

  // POST /periodes/markeer-verleden-betaald  (must be before /:id patterns)
  if (path === '/periodes/markeer-verleden-betaald' && method === 'POST') {
    const vandaag = new Date().toISOString().slice(0, 10);
    const { results: verledenPeriodes } = await env.DB.prepare(
      'SELECT * FROM periodes WHERE eind_datum < ?'
    ).bind(vandaag).all();
    const { results: lasten } = await env.DB.prepare(
      'SELECT * FROM vaste_lasten WHERE actief=1'
    ).all();

    let aantalGemarkt = 0;
    const statements = [];

    for (const periode of verledenPeriodes) {
      const { results: overgeslagenRijen } = await env.DB.prepare(
        'SELECT last_id FROM periode_overgeslagen WHERE periode_id=?'
      ).bind(periode.id).all();
      const overgeslagenIds = new Set(overgeslagenRijen.map(r => r.last_id));

      const { results: koppelingRijen } = await env.DB.prepare(
        'SELECT gekoppeld_last_id FROM bank_transacties WHERE periode_id=? AND gekoppeld_last_id IS NOT NULL AND genegeerd=0'
      ).bind(periode.id).all();
      const bestaandeKoppelingen = new Set(koppelingRijen.map(r => r.gekoppeld_last_id));

      for (const last of lasten) {
        if (overgeslagenIds.has(last.id)) continue;
        if (bestaandeKoppelingen.has(last.id)) continue;
        statements.push(
          env.DB.prepare(`
            DELETE FROM bank_transacties
            WHERE periode_id=? AND gekoppeld_last_id=? AND handmatig_gekoppeld=1 AND (tegenrekening IS NULL OR tegenrekening='')
          `).bind(periode.id, last.id)
        );
        statements.push(
          env.DB.prepare(`
            INSERT INTO bank_transacties (datum, bedrag, omschrijving, tegenrekening, periode_id, gekoppeld_last_id, handmatig_gekoppeld)
            VALUES (?, ?, ?, '', ?, ?, 1)
          `).bind(periode.start_datum, -last.bedrag, 'Handmatig gemarkeerd: ' + last.naam, periode.id, last.id)
        );
        aantalGemarkt++;
      }
    }

    if (statements.length) await env.DB.batch(statements);
    return Response.json({ gemarkt: aantalGemarkt, periodes: verledenPeriodes.length });
  }

  // POST /periodes/genereer/:jaar  (must be before /:id patterns)
  if ((m = matchPath('/periodes/genereer/:jaar', path)) && method === 'POST') {
    const jaar = parseInt(m.jaar);
    if (!jaar || jaar < 2000 || jaar > 2100) return Response.json({ error: 'Ongeldig jaar' }, { status: 400 });

    const dagRow = await env.DB.prepare("SELECT waarde FROM instellingen WHERE sleutel='salaris_dag'").first();
    const dag = Math.max(1, Math.min(31, parseInt(dagRow?.waarde) || 25));

    function daysInMonth(y, mo) { return new Date(y, mo + 1, 0).getDate(); }

    let aangemaakt = 0, overgeslagen = 0;
    const inserts = [];

    for (let mo = 0; mo < 12; mo++) {
      const startDag = Math.min(dag, daysInMonth(jaar, mo));
      const startDatum = `${jaar}-${String(mo + 1).padStart(2, '0')}-${String(startDag).padStart(2, '0')}`;

      const volgendM = (mo + 1) % 12;
      const volgendJaar = mo < 11 ? jaar : jaar + 1;
      const volgendStartDag = Math.min(dag, daysInMonth(volgendJaar, volgendM));
      const volgendeStart = new Date(volgendJaar, volgendM, volgendStartDag);
      volgendeStart.setDate(volgendeStart.getDate() - 1);
      const eindDatum = volgendeStart.toISOString().slice(0, 10);

      const bestaatAl = await env.DB.prepare('SELECT id FROM periodes WHERE start_datum=? LIMIT 1').bind(startDatum).first();
      if (bestaatAl) { overgeslagen++; continue; }

      const heeftOverlap = await env.DB.prepare(
        'SELECT id FROM periodes WHERE start_datum <= ? AND eind_datum >= ? LIMIT 1'
      ).bind(eindDatum, startDatum).first();
      if (heeftOverlap) { overgeslagen++; continue; }

      inserts.push(env.DB.prepare('INSERT INTO periodes (start_datum, eind_datum) VALUES (?, ?)').bind(startDatum, eindDatum));
      aangemaakt++;
    }

    if (inserts.length) await env.DB.batch(inserts);

    // Kopieer jaar-overrides van vorig jaar als dit jaar nog geen overrides heeft
    await kopieerJaarOverridesIndienNieuw(jaar, env);

    return Response.json({ aangemaakt, overgeslagen });
  }

  // GET /periodes
  if (path === '/periodes' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM periodes ORDER BY start_datum ASC').all();
    return Response.json(results);
  }

  // POST /periodes
  if (path === '/periodes' && method === 'POST') {
    const { start_datum, eind_datum, salaris_bedrag, notities } = await request.json();
    if (!start_datum || !eind_datum) return Response.json({ error: 'start_datum en eind_datum zijn verplicht' }, { status: 400 });

    const params = [eind_datum, start_datum];
    const overlap = await env.DB.prepare('SELECT * FROM periodes WHERE start_datum <= ? AND eind_datum >= ?').bind(...params).first();
    if (overlap) return Response.json({ error: `Overlap met bestaande periode (${overlap.start_datum} t/m ${overlap.eind_datum})` }, { status: 400 });

    const result = await env.DB.prepare(`
      INSERT INTO periodes (start_datum, eind_datum, salaris_bedrag, notities) VALUES (?, ?, ?, ?)
    `).bind(start_datum, eind_datum, salaris_bedrag || null, notities || '').run();

    // Kopieer jaar-overrides van vorig jaar als dit jaar nog geen overrides heeft
    const nieuwJaar = new Date(start_datum).getFullYear();
    await kopieerJaarOverridesIndienNieuw(nieuwJaar, env);

    return Response.json({ id: result.meta.last_row_id });
  }

  // GET /periodes/:id/overzicht
  if ((m = matchPath('/periodes/:id/overzicht', path)) && method === 'GET') {
    const periode = await env.DB.prepare('SELECT * FROM periodes WHERE id=?').bind(m.id).first();
    if (!periode) return Response.json({ error: 'Periode niet gevonden' }, { status: 404 });

    const jaar = new Date(periode.start_datum).getFullYear();

    const [
      { results: lasten },
      { results: transacties },
      { results: overgeslagenRijen },
      { results: alleOverrides },
      { results: jaarOverrides },
    ] = await Promise.all([
      env.DB.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all(),
      env.DB.prepare('SELECT * FROM bank_transacties WHERE periode_id=? ORDER BY datum').bind(m.id).all(),
      env.DB.prepare('SELECT last_id FROM periode_overgeslagen WHERE periode_id=?').bind(m.id).all(),
      env.DB.prepare(
        'SELECT last_id, actief FROM vaste_last_periode_actief WHERE periode_id=?'
      ).bind(m.id).all(),
      env.DB.prepare('SELECT * FROM vaste_last_jaar_overrides WHERE jaar=?').bind(jaar).all(),
    ]);

    const salarisdag = new Date(periode.start_datum).getDate();

    // Apply year overrides first, then sort by effective verwachte_dag
    const effectieveLasten = applyJaarOverridesOpLasten(lasten, jaarOverrides);
    effectieveLasten.sort((a, b) => {
      const dagA = a.verwachte_dag || 99;
      const dagB = b.verwachte_dag || 99;
      const relA = dagA >= salarisdag ? dagA - salarisdag : dagA + (31 - salarisdag);
      const relB = dagB >= salarisdag ? dagB - salarisdag : dagB + (31 - salarisdag);
      return relA - relB || a.naam.localeCompare(b.naam);
    });

    // Jaar-verwijderd: lasten that were excluded by actief=0 override
    const jaarVerwijderd = lasten
      .filter(last => jaarOverrides.find(o => o.last_id === last.id && o.actief === 0))
      .map(last => ({ ...last, jaar_verwijderd: true }));

    const vandaag = new Date().toISOString().slice(0, 10);
    const overgeslagenIds = new Set(overgeslagenRijen.map(r => r.last_id));

    function getOverride(lastId) {
      return alleOverrides.find(o => o.last_id === lastId) || null;
    }

    const overzicht = effectieveLasten.map(effectief => {
      const override = getOverride(effectief.id);
      if (override && override.actief === 0) {
        return { ...effectief, status: 'inactief', betaling: null, handmatig_betaald: false, periode_inactief: true };
      }

      const betaling = transacties.find(t => t.gekoppeld_last_id === effectief.id);
      let status = 'open';
      if (betaling) {
        status = 'betaald';
      } else if (overgeslagenIds.has(effectief.id)) {
        status = 'overgeslagen';
      } else if (effectief.verwachte_dag) {
        const start = new Date(periode.start_datum);
        let verwacht = new Date(start);
        verwacht.setDate(effectief.verwachte_dag);
        if (verwacht < start) verwacht.setMonth(verwacht.getMonth() + 1);
        const verwachtStr = verwacht.toISOString().slice(0, 10);
        if (verwachtStr > vandaag) status = 'verwacht';
      }

      const handmatig = betaling ? betaling.handmatig_gekoppeld === 1 && !betaling.tegenrekening : false;
      return { ...effectief, status, betaling: betaling || null, handmatig_betaald: handmatig, periode_inactief: false };
    });

    const actieveItems = overzicht.filter(o => !o.periode_inactief);
    const totaalVerwacht = actieveItems.reduce((s, l) => s + l.bedrag, 0);
    const totaalBetaald = actieveItems.filter(o => o.status === 'betaald').reduce((s, o) => s + o.bedrag, 0);
    const ongekoppeld = transacties.filter(t => !t.gekoppeld_last_id && !t.genegeerd);

    return Response.json({ periode, overzicht, jaarVerwijderd, totaalVerwacht, totaalBetaald, transacties: ongekoppeld });
  }

  // GET /periodes/:id/alle-ongekoppeld
  if ((m = matchPath('/periodes/:id/alle-ongekoppeld', path)) && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM bank_transacties WHERE periode_id=? AND gekoppeld_last_id IS NULL ORDER BY datum'
    ).bind(m.id).all();
    return Response.json(results);
  }

  // GET /periodes/:id/genegeerd
  if ((m = matchPath('/periodes/:id/genegeerd', path)) && method === 'GET') {
    const { results: rijen } = await env.DB.prepare(
      'SELECT * FROM bank_transacties WHERE periode_id=? AND genegeerd=1 ORDER BY datum'
    ).bind(m.id).all();

    const gezien = new Map();
    for (const t of rijen) {
      const sleutel = t.tegenrekening ? `iban:${t.tegenrekening}` : `omschrijving:${t.omschrijving}`;
      if (!gezien.has(sleutel)) {
        gezien.set(sleutel, { ...t, aantal: 1 });
      } else {
        gezien.get(sleutel).aantal++;
      }
    }
    return Response.json([...gezien.values()]);
  }

  // POST /periodes/:id/deactiveer-last/:last_id
  if ((m = matchPath('/periodes/:id/deactiveer-last/:last_id', path)) && method === 'POST') {
    const huidigePeriode = await env.DB.prepare('SELECT start_datum FROM periodes WHERE id=?').bind(m.id).first();
    if (!huidigePeriode) return Response.json({ error: 'Periode niet gevonden' }, { status: 404 });
    const jaar = huidigePeriode.start_datum.slice(0, 4);
    const { results: volgendePeriodes } = await env.DB.prepare(
      "SELECT id FROM periodes WHERE start_datum LIKE ? AND start_datum >= ?"
    ).bind(`${jaar}-%`, huidigePeriode.start_datum).all();
    await env.DB.batch(volgendePeriodes.map(p =>
      env.DB.prepare('INSERT OR REPLACE INTO vaste_last_periode_actief (last_id, periode_id, actief) VALUES (?,?,0)')
        .bind(m.last_id, p.id)
    ));
    return Response.json({ ok: true });
  }

  // POST /periodes/:id/activeer-last/:last_id
  if ((m = matchPath('/periodes/:id/activeer-last/:last_id', path)) && method === 'POST') {
    const huidigePeriode = await env.DB.prepare('SELECT start_datum FROM periodes WHERE id=?').bind(m.id).first();
    if (!huidigePeriode) return Response.json({ error: 'Periode niet gevonden' }, { status: 404 });
    const jaar = huidigePeriode.start_datum.slice(0, 4);
    const { results: volgendePeriodes } = await env.DB.prepare(
      "SELECT id FROM periodes WHERE start_datum LIKE ? AND start_datum >= ?"
    ).bind(`${jaar}-%`, huidigePeriode.start_datum).all();
    await env.DB.batch(volgendePeriodes.map(p =>
      env.DB.prepare('INSERT OR REPLACE INTO vaste_last_periode_actief (last_id, periode_id, actief) VALUES (?,?,1)')
        .bind(m.last_id, p.id)
    ));
    return Response.json({ ok: true });
  }

  // POST /periodes/:id/negeer-alles
  if ((m = matchPath('/periodes/:id/negeer-alles', path)) && method === 'POST') {
    const result = await env.DB.prepare(`
      UPDATE bank_transacties SET genegeerd=1 WHERE periode_id=? AND gekoppeld_last_id IS NULL AND genegeerd=0
    `).bind(m.id).run();
    return Response.json({ genegeerd: result.meta.changes });
  }

  // POST /periodes/:id/negeer/:transactie_id
  if ((m = matchPath('/periodes/:id/negeer/:transactie_id', path)) && method === 'POST') {
    await env.DB.prepare('UPDATE bank_transacties SET genegeerd=1 WHERE id=? AND periode_id=?')
      .bind(m.transactie_id, m.id).run();
    return Response.json({ ok: true });
  }

  // DELETE /periodes/:id/negeer/:transactie_id
  if ((m = matchPath('/periodes/:id/negeer/:transactie_id', path)) && method === 'DELETE') {
    const t = await env.DB.prepare('SELECT * FROM bank_transacties WHERE id=? AND periode_id=?')
      .bind(m.transactie_id, m.id).first();
    if (!t) return Response.json({ error: 'Niet gevonden' }, { status: 404 });

    if (t.tegenrekening) {
      await env.DB.prepare('UPDATE bank_transacties SET genegeerd=0 WHERE periode_id=? AND tegenrekening=?')
        .bind(m.id, t.tegenrekening).run();
    } else {
      await env.DB.prepare('UPDATE bank_transacties SET genegeerd=0 WHERE periode_id=? AND omschrijving=?')
        .bind(m.id, t.omschrijving).run();
    }
    return Response.json({ ok: true });
  }

  // POST /periodes/:id/last-van-transactie
  if ((m = matchPath('/periodes/:id/last-van-transactie', path)) && method === 'POST') {
    const { transactie_id, naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon } = await request.json();
    if (!naam || bedrag == null) return Response.json({ error: 'naam en bedrag zijn verplicht' }, { status: 400 });

    const lastResult = await env.DB.prepare(`
      INSERT INTO vaste_lasten (naam, bedrag, categorie, verwachte_dag, iban_tegenrekening, omschrijving_patroon, actief)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).bind(naam, bedrag, categorie || '', verwachte_dag || null, iban_tegenrekening || '', omschrijving_patroon || '').run();

    const lastId = lastResult.meta.last_row_id;
    await env.DB.prepare(`
      UPDATE bank_transacties SET gekoppeld_last_id=?, handmatig_gekoppeld=1 WHERE id=? AND periode_id=?
    `).bind(lastId, transactie_id, m.id).run();

    return Response.json({ last_id: lastId });
  }

  // POST /periodes/:id/hermatchen/:last_id
  if ((m = matchPath('/periodes/:id/hermatchen/:last_id', path)) && method === 'POST') {
    const periode = await env.DB.prepare('SELECT * FROM periodes WHERE id=?').bind(m.id).first();
    if (!periode) return Response.json({ error: 'Periode niet gevonden' }, { status: 404 });

    const lastId = parseInt(m.last_id);
    const jaar = new Date(periode.start_datum).getFullYear();
    const [{ results: lasten }, { results: transacties }, { results: overgeslagenRijen }, { results: inactiefRijen }, { results: jaarOverrides }] = await Promise.all([
      env.DB.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all(),
      env.DB.prepare(`
        SELECT * FROM bank_transacties
        WHERE periode_id=? AND handmatig_gekoppeld=0 AND genegeerd=0
        AND (gekoppeld_last_id=? OR gekoppeld_last_id IS NULL)
      `).bind(m.id, lastId).all(),
      env.DB.prepare('SELECT last_id FROM periode_overgeslagen WHERE periode_id=?').bind(m.id).all(),
      env.DB.prepare('SELECT last_id FROM vaste_last_periode_actief WHERE periode_id=? AND actief=0').bind(m.id).all(),
      env.DB.prepare('SELECT * FROM vaste_last_jaar_overrides WHERE jaar=?').bind(jaar).all(),
    ]);

    const effectieveLasten = applyJaarOverridesOpLasten(lasten, jaarOverrides);
    const uitgesloten = new Set([...overgeslagenRijen, ...inactiefRijen].map(r => r.last_id));
    const matchbareLasten = effectieveLasten.filter(l => !uitgesloten.has(l.id));

    let gematcht = 0;
    const updates = [];
    for (const t of transacties) {
      const matchId = autoMatch(t, matchbareLasten, periode);
      if (t.gekoppeld_last_id === lastId || matchId === lastId) {
        updates.push(env.DB.prepare('UPDATE bank_transacties SET gekoppeld_last_id=? WHERE id=?').bind(matchId ?? null, t.id));
        if (matchId === lastId) gematcht++;
      }
    }
    if (updates.length) await env.DB.batch(updates);
    return Response.json({ ok: true, gematcht });
  }

  // POST /periodes/:id/hermatchen
  if ((m = matchPath('/periodes/:id/hermatchen', path)) && method === 'POST') {
    const periode = await env.DB.prepare('SELECT * FROM periodes WHERE id=?').bind(m.id).first();
    if (!periode) return Response.json({ error: 'Periode niet gevonden' }, { status: 404 });

    const jaar = new Date(periode.start_datum).getFullYear();
    const [{ results: lasten }, { results: transacties }, { results: overgeslagenRijen }, { results: inactiefRijen }, { results: jaarOverrides }] = await Promise.all([
      env.DB.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all(),
      env.DB.prepare('SELECT * FROM bank_transacties WHERE periode_id=? AND handmatig_gekoppeld=0 AND genegeerd=0').bind(m.id).all(),
      env.DB.prepare('SELECT last_id FROM periode_overgeslagen WHERE periode_id=?').bind(m.id).all(),
      env.DB.prepare('SELECT last_id FROM vaste_last_periode_actief WHERE periode_id=? AND actief=0').bind(m.id).all(),
      env.DB.prepare('SELECT * FROM vaste_last_jaar_overrides WHERE jaar=?').bind(jaar).all(),
    ]);

    const effectieveLasten = applyJaarOverridesOpLasten(lasten, jaarOverrides);
    const uitgesloten = new Set([...overgeslagenRijen, ...inactiefRijen].map(r => r.last_id));
    const matchbareLasten = effectieveLasten.filter(l => !uitgesloten.has(l.id));

    let gematcht = 0;
    const updates = transacties.map(t => {
      const lastId = autoMatch(t, matchbareLasten, periode);
      if (lastId) gematcht++;
      return env.DB.prepare('UPDATE bank_transacties SET gekoppeld_last_id=? WHERE id=?').bind(lastId ?? null, t.id);
    });
    if (updates.length) await env.DB.batch(updates);
    return Response.json({ hermatcht: transacties.length, gematcht });
  }

  // POST /periodes/:id/markeer/:last_id
  if ((m = matchPath('/periodes/:id/markeer/:last_id', path)) && method === 'POST') {
    const [periode, last] = await Promise.all([
      env.DB.prepare('SELECT * FROM periodes WHERE id=?').bind(m.id).first(),
      env.DB.prepare('SELECT * FROM vaste_lasten WHERE id=?').bind(m.last_id).first(),
    ]);
    if (!periode) return Response.json({ error: 'Periode niet gevonden' }, { status: 404 });
    if (!last) return Response.json({ error: 'Vaste last niet gevonden' }, { status: 404 });

    const datum = new Date().toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare(`
        DELETE FROM bank_transacties
        WHERE periode_id=? AND gekoppeld_last_id=? AND handmatig_gekoppeld=1 AND (tegenrekening IS NULL OR tegenrekening='')
      `).bind(m.id, m.last_id),
      env.DB.prepare(`
        INSERT INTO bank_transacties (datum, bedrag, omschrijving, tegenrekening, periode_id, gekoppeld_last_id, handmatig_gekoppeld)
        VALUES (?, ?, ?, '', ?, ?, 1)
      `).bind(datum, -last.bedrag, 'Handmatig gemarkeerd: ' + last.naam, m.id, m.last_id),
    ]);
    return Response.json({ ok: true });
  }

  // DELETE /periodes/:id/markeer/:last_id
  if ((m = matchPath('/periodes/:id/markeer/:last_id', path)) && method === 'DELETE') {
    const huidigePeriode = await env.DB.prepare('SELECT start_datum FROM periodes WHERE id=?').bind(m.id).first();
    if (!huidigePeriode) return Response.json({ error: 'Periode niet gevonden' }, { status: 404 });
    const jaar = huidigePeriode.start_datum.slice(0, 4);
    const { results: volgendePeriodes } = await env.DB.prepare(
      "SELECT id FROM periodes WHERE start_datum LIKE ? AND start_datum >= ?"
    ).bind(`${jaar}-%`, huidigePeriode.start_datum).all();
    await env.DB.batch(volgendePeriodes.map(p =>
      env.DB.prepare(`
        DELETE FROM bank_transacties
        WHERE periode_id=? AND gekoppeld_last_id=? AND handmatig_gekoppeld=1 AND (tegenrekening IS NULL OR tegenrekening='')
      `).bind(p.id, m.last_id)
    ));
    return Response.json({ ok: true });
  }

  // POST /periodes/:id/overslaan/:last_id
  if ((m = matchPath('/periodes/:id/overslaan/:last_id', path)) && method === 'POST') {
    await env.DB.prepare('INSERT OR IGNORE INTO periode_overgeslagen (periode_id, last_id) VALUES (?, ?)')
      .bind(m.id, m.last_id).run();
    return Response.json({ ok: true });
  }

  // DELETE /periodes/:id/overslaan/:last_id
  if ((m = matchPath('/periodes/:id/overslaan/:last_id', path)) && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM periode_overgeslagen WHERE periode_id=? AND last_id=?')
      .bind(m.id, m.last_id).run();
    return Response.json({ ok: true });
  }

  // POST /periodes/:id/koppel
  if ((m = matchPath('/periodes/:id/koppel', path)) && method === 'POST') {
    const { transactie_id, last_id } = await request.json();
    if (last_id === null || last_id === undefined) {
      await env.DB.prepare(`
        UPDATE bank_transacties SET gekoppeld_last_id=NULL, handmatig_gekoppeld=0 WHERE id=? AND periode_id=?
      `).bind(transactie_id, m.id).run();
    } else {
      await env.DB.prepare(`
        UPDATE bank_transacties SET gekoppeld_last_id=?, handmatig_gekoppeld=1 WHERE id=? AND periode_id=?
      `).bind(last_id, transactie_id, m.id).run();
    }
    return Response.json({ ok: true });
  }

  // DELETE /periodes/:id/ongekoppeld
  if ((m = matchPath('/periodes/:id/ongekoppeld', path)) && method === 'DELETE') {
    const result = await env.DB.prepare(`
      DELETE FROM bank_transacties WHERE periode_id=? AND gekoppeld_last_id IS NULL AND genegeerd=0
    `).bind(m.id).run();
    return Response.json({ verwijderd: result.meta.changes });
  }

  // PUT /periodes/:id
  if ((m = matchPath('/periodes/:id', path)) && method === 'PUT') {
    const { start_datum, eind_datum, salaris_bedrag, notities } = await request.json();
    if (!start_datum || !eind_datum) return Response.json({ error: 'start_datum en eind_datum zijn verplicht' }, { status: 400 });

    const overlap = await env.DB.prepare(
      'SELECT * FROM periodes WHERE start_datum <= ? AND eind_datum >= ? AND id != ?'
    ).bind(eind_datum, start_datum, m.id).first();
    if (overlap) return Response.json({ error: `Overlap met bestaande periode (${overlap.start_datum} t/m ${overlap.eind_datum})` }, { status: 400 });

    await env.DB.prepare(`
      UPDATE periodes SET start_datum=?, eind_datum=?, salaris_bedrag=?, notities=? WHERE id=?
    `).bind(start_datum, eind_datum, salaris_bedrag || null, notities || '', m.id).run();
    return Response.json({ ok: true });
  }

  // DELETE /periodes/:id
  if ((m = matchPath('/periodes/:id', path)) && method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM bank_transacties WHERE periode_id=?').bind(m.id),
      env.DB.prepare('DELETE FROM periodes WHERE id=?').bind(m.id),
    ]);
    return Response.json({ ok: true });
  }

  return null;
}

async function handleImport(path, method, request, env) {
  // POST /import/preview
  if (path === '/import/preview' && method === 'POST') {
    const formData = await request.formData();
    const file = formData.get('bestand');
    if (!file) return Response.json({ error: 'Geen bestand' }, { status: 400 });
    const text = (await file.text()).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    try {
      const rows = parseCSV(text);
      const transacties = rows.map(mapBankRow).filter(t => t.datum && t.bedrag != null);
      return Response.json({ transacties, totaal: transacties.length });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }
  }

  // POST /import/opslaan
  if (path === '/import/opslaan' && method === 'POST') {
    const { transacties } = await request.json();
    if (!Array.isArray(transacties)) return Response.json({ error: 'transacties zijn verplicht' }, { status: 400 });

    const { results: allePeriodes } = await env.DB.prepare('SELECT * FROM periodes ORDER BY start_datum ASC').all();
    if (!allePeriodes.length) return Response.json({ error: 'Geen periodes gevonden' }, { status: 400 });

    const { results: lasten } = await env.DB.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all();
    const { results: alleJaarOverrides } = await env.DB.prepare('SELECT * FROM vaste_last_jaar_overrides').all();
    const jaarOverridesPerJaar = new Map();
    for (const o of alleJaarOverrides) {
      if (!jaarOverridesPerJaar.has(o.jaar)) jaarOverridesPerJaar.set(o.jaar, []);
      jaarOverridesPerJaar.get(o.jaar).push(o);
    }
    const effectieveLastenCache = new Map();
    function getEffectieveLastenVoorJaar(jaar) {
      if (!effectieveLastenCache.has(jaar)) {
        effectieveLastenCache.set(jaar, applyJaarOverridesOpLasten(lasten, jaarOverridesPerJaar.get(jaar) || []));
      }
      return effectieveLastenCache.get(jaar);
    }

    // Haal genegeerde transacties op per periode voor filtering
    const { results: genegeerdRijen } = await env.DB.prepare(
      'SELECT tegenrekening, omschrijving, periode_id FROM bank_transacties WHERE genegeerd=1'
    ).all();

    const genegeerdIbansPerPeriode = new Map();
    const genegeerdOmschrijvingenPerPeriode = new Map();
    for (const p of allePeriodes) {
      genegeerdIbansPerPeriode.set(p.id, new Set());
      genegeerdOmschrijvingenPerPeriode.set(p.id, new Set());
    }
    for (const r of genegeerdRijen) {
      if (r.tegenrekening) genegeerdIbansPerPeriode.get(r.periode_id)?.add(r.tegenrekening);
      else if (r.omschrijving) genegeerdOmschrijvingenPerPeriode.get(r.periode_id)?.add(r.omschrijving);
    }

    // Haal bestaande transacties op voor dubbelcheck
    const { results: bestaandeRijen } = await env.DB.prepare(
      'SELECT datum, bedrag, omschrijving, tegenrekening, periode_id FROM bank_transacties'
    ).all();
    const bestaandeSet = new Set(
      bestaandeRijen.map(r => `${r.datum}|${r.bedrag}|${r.omschrijving}|${r.tegenrekening}|${r.periode_id}`)
    );

    let aantalGematcht = 0, aantalOvergeslagen = 0, aantalGeenPeriode = 0, aantalDubbel = 0;
    const inserts = [];

    for (const t of transacties) {
      const periode = allePeriodes.find(p =>
        t.datum >= p.start_datum && (!p.eind_datum || t.datum <= p.eind_datum)
      );
      if (!periode) { aantalGeenPeriode++; continue; }

      if (t.tegenrekening && genegeerdIbansPerPeriode.get(periode.id).has(t.tegenrekening)) { aantalOvergeslagen++; continue; }
      if (!t.tegenrekening && t.omschrijving && genegeerdOmschrijvingenPerPeriode.get(periode.id).has(t.omschrijving)) { aantalOvergeslagen++; continue; }

      const key = `${t.datum}|${t.bedrag}|${t.omschrijving || ''}|${t.tegenrekening || ''}|${periode.id}`;
      if (bestaandeSet.has(key)) { aantalDubbel++; continue; }

      const periodeJaar = new Date(periode.start_datum).getFullYear();
      const lastId = autoMatch(t, getEffectieveLastenVoorJaar(periodeJaar), periode);
      if (lastId) aantalGematcht++;
      inserts.push(
        env.DB.prepare(`
          INSERT INTO bank_transacties (datum, bedrag, omschrijving, tegenrekening, periode_id, gekoppeld_last_id, handmatig_gekoppeld)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).bind(t.datum, t.bedrag, t.omschrijving || '', t.tegenrekening || '', periode.id, lastId ?? null)
      );
      bestaandeSet.add(key);
    }

    // D1 batch max 100 statements, chunk als nodig
    for (let i = 0; i < inserts.length; i += 100) {
      await env.DB.batch(inserts.slice(i, i + 100));
    }

    return Response.json({
      opgeslagen: inserts.length,
      gematcht: aantalGematcht,
      genegeerd: aantalOvergeslagen,
      geenPeriode: aantalGeenPeriode,
      dubbel: aantalDubbel,
    });
  }

  return null;
}

async function handleStatistieken(path, method, env) {
  if (path === '/statistieken' && method === 'GET') {
    const [
      { results: lasten },
      { results: periodes },
      { results: alleOverrides },
      { results: betaaldPerPeriode },
      { results: overgeslagenPerPeriode },
    ] = await Promise.all([
      env.DB.prepare('SELECT * FROM vaste_lasten WHERE actief=1').all(),
      env.DB.prepare('SELECT * FROM periodes ORDER BY start_datum ASC').all(),
      env.DB.prepare(`
        SELECT vpa.last_id, vpa.actief, p.start_datum FROM vaste_last_periode_actief vpa
        JOIN periodes p ON p.id = vpa.periode_id
        ORDER BY p.start_datum DESC
      `).all(),
      env.DB.prepare(`
        SELECT bt.periode_id, COALESCE(SUM(vl.bedrag), 0) as totaal
        FROM bank_transacties bt
        JOIN vaste_lasten vl ON bt.gekoppeld_last_id = vl.id
        WHERE bt.genegeerd = 0
        GROUP BY bt.periode_id
      `).all(),
      env.DB.prepare('SELECT periode_id, COUNT(*) as n FROM periode_overgeslagen GROUP BY periode_id').all(),
    ]);

    const betaaldMap = {};
    for (const r of betaaldPerPeriode) betaaldMap[r.periode_id] = r.totaal;
    const overgeslagenMap = {};
    for (const r of overgeslagenPerPeriode) overgeslagenMap[r.periode_id] = r.n;

    function getActiefOverride(lastId, periodeStart) {
      return alleOverrides.find(o => o.last_id === lastId && o.start_datum <= periodeStart) || null;
    }

    const categorieMap = {};
    for (const l of lasten) {
      const cat = l.categorie && l.categorie.trim() ? l.categorie.trim() : 'Overig';
      categorieMap[cat] = (categorieMap[cat] || 0) + l.bedrag;
    }
    const categorieën = Object.entries(categorieMap)
      .sort((a, b) => b[1] - a[1])
      .map(([naam, bedrag]) => ({ naam, bedrag: Math.round(bedrag * 100) / 100 }));

    const periodeData = periodes.map(p => {
      const verwacht = lasten.reduce((s, l) => {
        const override = getActiefOverride(l.id, p.start_datum);
        if (override && override.actief === 0) return s;
        return s + l.bedrag;
      }, 0);
      return {
        label: p.start_datum.slice(0, 7),
        verwacht: Math.round(verwacht * 100) / 100,
        betaald: Math.round((betaaldMap[p.id] || 0) * 100) / 100,
        overgeslagen: overgeslagenMap[p.id] || 0,
      };
    });

    return Response.json({ categorieën, periodeData });
  }
  return null;
}

async function handleInstellingen(path, method, request, env) {
  if (path === '/instellingen' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT sleutel, waarde FROM instellingen').all();
    const result = {};
    for (const r of results) result[r.sleutel] = r.waarde;
    return Response.json(result);
  }

  let m;
  if ((m = matchPath('/instellingen/:sleutel', path)) && method === 'PUT') {
    const { waarde } = await request.json();
    await env.DB.prepare('INSERT OR REPLACE INTO instellingen (sleutel, waarde) VALUES (?,?)')
      .bind(m.sleutel, String(waarde ?? '')).run();
    return Response.json({ ok: true });
  }

  return null;
}

async function handleTransacties(path, method, request, env, url) {
  if (path === '/transacties' && method === 'GET') {
    const q = url.searchParams.get('q');
    const periode_id = url.searchParams.get('periode_id');

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

    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return Response.json(results);
  }
  return null;
}

// ===== Main entry point =====

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const authSecret = env.AUTH_SECRET;
  const authPassword = env.AUTH_PASSWORD;

  // Login endpoint — geen auth nodig
  if (path === '/auth/login' && method === 'POST') {
    if (!authPassword || !authSecret) {
      return Response.json({ error: 'Auth niet geconfigureerd' }, { status: 500 });
    }
    const body = await request.json();
    if (body.password !== authPassword) {
      return Response.json({ error: 'Onjuist wachtwoord' }, { status: 401 });
    }
    const token = await createSessionToken(authSecret);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${90 * 24 * 60 * 60}`,
      },
    });
  }

  // Auth check endpoint
  if (path === '/auth/check' && method === 'GET') {
    if (!authSecret) return Response.json({ authenticated: true });
    const token = getCookie(request, 'session');
    const valid = await verifySessionToken(token, authSecret);
    return Response.json({ authenticated: valid });
  }

  // Logout endpoint
  if (path === '/auth/logout' && method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      },
    });
  }

  // Auth middleware — alle andere endpoints
  if (authSecret && authPassword) {
    const token = getCookie(request, 'session');
    const valid = await verifySessionToken(token, authSecret);
    if (!valid) {
      return Response.json({ error: 'Niet ingelogd' }, { status: 401 });
    }
  }

  try {
    let response = null;

    if (path.startsWith('/lasten')) {
      response = await handleLasten(path, method, request, env);
    } else if (path.startsWith('/periodes')) {
      response = await handlePeriodes(path, method, request, env);
    } else if (path.startsWith('/import')) {
      response = await handleImport(path, method, request, env);
    } else if (path.startsWith('/statistieken')) {
      response = await handleStatistieken(path, method, env);
    } else if (path.startsWith('/instellingen')) {
      response = await handleInstellingen(path, method, request, env);
    } else if (path.startsWith('/transacties')) {
      response = await handleTransacties(path, method, request, env, url);
    }

    if (response) return response;
    return Response.json({ error: 'Niet gevonden' }, { status: 404 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
