// State
let allLasten = [];
let allPeriodes = [];
let huidigePeriodeId = null;
let importPreviewData = [];
let allLastenSelectOptions = '';
let ongekoppeldeTransacties = [];
let dashboardOverzicht = [];
let appInstellingen = {};

const MAANDEN = ['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'];
const MAANDEN_KORT = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

function periodeNaam(p) {
  if (!p || !p.start_datum) return '—';
  const startMaand = parseInt(p.start_datum.split('-')[1]) - 1;
  const eindMaand = p.eind_datum ? parseInt(p.eind_datum.split('-')[1]) - 1 : (startMaand + 1) % 12;
  return MAANDEN_KORT[startMaand] + '-' + MAANDEN_KORT[eindMaand];
}

// Hulp
function euro(n) {
  return '€\u00a0' + (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function vulEinddatumIn(startWaarde) {
  if (!startWaarde) return;
  const eind = document.getElementById('periode-eind');
  if (eind.value) return; // niet overschrijven als al ingevuld
  const d = new Date(startWaarde);
  d.setMonth(d.getMonth() + 1);
  d.setDate(d.getDate() - 1);
  eind.value = d.toISOString().slice(0, 10);
}

function suggereerVolgendePeriode() {
  let startDatum;
  if (allPeriodes.length) {
    // allPeriodes is gesorteerd DESC, [0] is de meest recente
    const laatste = allPeriodes[0];
    if (laatste.eind_datum) {
      const d = new Date(laatste.eind_datum);
      d.setDate(d.getDate() + 1);
      startDatum = d.toISOString().slice(0, 10);
    }
  }
  if (!startDatum) {
    // Geen periodes: neem de 25e van huidige of volgende maand
    const nu = new Date();
    const d = new Date(nu.getFullYear(), nu.getMonth(), 25);
    if (d <= nu) d.setMonth(d.getMonth() + 1);
    startDatum = d.toISOString().slice(0, 10);
  }
  document.getElementById('periode-start').value = startDatum;
  vulEinddatumIn(startDatum);
}

function datumNL(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}-${m}-${y}`;
}

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  return r.json();
}

// Navigatie
function toonPagina(naam, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + naam).classList.add('active');
  btn.classList.add('active');

  if (naam === 'lasten') laadLasten();
  if (naam === 'periodes') laadPeriodes();
  if (naam === 'transacties') openTransacties();
}

// Modals
function openModal(id) { document.getElementById(id).classList.add('open'); }
function sluitModal(id) { document.getElementById(id).classList.remove('open'); }

// Modals only close via buttons — no click-outside to prevent accidental dismissal on swipe

// ============================================================
// VASTE LASTEN
// ============================================================
async function laadLasten() {
  allLasten = await api('/api/lasten');
  renderLasten();
  updateLastenSelect();
}

function renderLasten() {
  const tbody = document.getElementById('lasten-body');
  if (!allLasten.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Nog geen vaste lasten. Voeg er een toe.</td></tr>';
    return;
  }
  tbody.innerHTML = allLasten.map(l => `
    <tr>
      <td><strong>${esc(l.naam)}</strong></td>
      <td>${euro(l.bedrag)}</td>
      <td>${esc(l.categorie || '—')}</td>
      <td>${l.verwachte_dag ? l.verwachte_dag + 'e' : '—'}</td>
      <td>
        <button class="toggle ${l.actief ? 'on' : ''}" onclick="toggleActief(${l.id}, ${l.actief})" title="${l.actief ? 'Actief' : 'Inactief'}"></button>
      </td>
      <td style="text-align:right">
        <button class="btn btn-sm btn-secondary" onclick="openModalLast(${l.id})">Bewerken</button>
        <button class="btn btn-sm btn-danger" onclick="verwijderLast(${l.id})">Verwijderen</button>
      </td>
    </tr>
  `).join('');
}

function updateLastenSelect() {
  allLastenSelectOptions = '<option value="">— ontkoppelen —</option>' +
    allLasten.map(l => `<option value="${l.id}">${esc(l.naam)} (${euro(l.bedrag)})</option>`).join('');
}

function openModalLast(id) {
  document.getElementById('last-id').value = '';
  document.getElementById('form-last').reset();
  document.getElementById('modal-last-titel').textContent = 'Vaste last toevoegen';

  if (id) {
    const l = allLasten.find(x => x.id === id);
    if (!l) return;
    document.getElementById('modal-last-titel').textContent = 'Vaste last bewerken';
    document.getElementById('last-id').value = l.id;
    document.getElementById('last-naam').value = l.naam;
    document.getElementById('last-bedrag').value = (l.bedrag || 0).toFixed(2);
    document.getElementById('last-dag').value = l.verwachte_dag || '';
    document.getElementById('last-categorie').value = l.categorie || '';
    document.getElementById('last-iban').value = l.iban_tegenrekening || '';
    document.getElementById('last-patroon').value = l.omschrijving_patroon || '';
  }
  openModal('modal-last');
}

async function submitLast(e) {
  e.preventDefault();
  const id = document.getElementById('last-id').value;
  const body = {
    naam: document.getElementById('last-naam').value,
    bedrag: parseFloat(document.getElementById('last-bedrag').value),
    verwachte_dag: parseInt(document.getElementById('last-dag').value) || null,
    categorie: document.getElementById('last-categorie').value,
    iban_tegenrekening: document.getElementById('last-iban').value,
    omschrijving_patroon: document.getElementById('last-patroon').value,
    actief: 1
  };
  if (id) {
    await api(`/api/lasten/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } else {
    await api('/api/lasten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  sluitModal('modal-last');
  await laadLasten();
  if (huidigePeriodeId) laadDashboard(); else { renderInactieveLasten(); }
}

async function toggleActief(id, huidig) {
  if (huidig) await deactiveerLast(id); else await activeerLast(id);
}

// Globale deactivering (vanuit lasten-tab toggle)
async function deactiveerLast(id) {
  const l = allLasten.find(x => x.id === id);
  if (!l) return;
  await api(`/api/lasten/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...l, actief: 0 }) });
  await laadLasten();
  if (huidigePeriodeId) laadDashboard(); else renderInactieveLasten();
}

// Globale activering (vanuit inactieve lasten sectie of lasten-tab)
async function activeerLast(id) {
  const l = allLasten.find(x => x.id === id);
  if (!l) return;
  await api(`/api/lasten/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...l, actief: 1 }) });
  await laadLasten();
  if (huidigePeriodeId) laadDashboard(); else renderInactieveLasten();
}

// Per-periode deactivering (vanuit dashboard kebab)
async function deactiveerLastInPeriode(id) {
  if (!huidigePeriodeId) return;
  await api(`/api/periodes/${huidigePeriodeId}/deactiveer-last/${id}`, { method: 'POST' });
  laadDashboard();
}

// Per-periode activering (vanuit dashboard kebab, voor periode-inactieve last)
async function activeerLastInPeriode(id) {
  if (!huidigePeriodeId) return;
  await api(`/api/periodes/${huidigePeriodeId}/activeer-last/${id}`, { method: 'POST' });
  laadDashboard();
}

async function verwijderLast(id) {
  if (!confirm('Vaste last verwijderen?')) return;
  await api(`/api/lasten/${id}`, { method: 'DELETE' });
  await laadLasten();
  if (huidigePeriodeId) laadDashboard(); else renderInactieveLasten();
}

// ============================================================
// PERIODES
// ============================================================
async function laadPeriodes() {
  allPeriodes = await api('/api/periodes');
  renderPeriodes();
  vulPeriodeSelect();
}

function renderPeriodes() {
  const tbody = document.getElementById('periodes-body');
  if (!allPeriodes.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Nog geen periodes.</td></tr>';
    return;
  }
  tbody.innerHTML = allPeriodes.map(p => `
    <tr>
      <td>${datumNL(p.start_datum)}</td>
      <td>${datumNL(p.eind_datum)}</td>
      <td>${p.salaris_bedrag ? euro(p.salaris_bedrag) : '—'}</td>
      <td>${esc(p.notities || '')}</td>
      <td style="text-align:right">
        <button class="btn btn-sm btn-secondary" onclick="openModalPeriode(${p.id})">Bewerken</button>
        <button class="btn btn-sm btn-danger" onclick="verwijderPeriode(${p.id})">Verwijderen</button>
      </td>
    </tr>
  `).join('');
}

function vulPeriodeSelect() {
  const jaarSel = document.getElementById('jaar-select');
  const periSel = document.getElementById('periode-select');

  // Unieke jaren op basis van startdatum (gesorteerd DESC)
  const jaren = [...new Set(allPeriodes.map(p => p.start_datum.slice(0, 4)))].sort((a, b) => b - a);
  const huidigJaar = jaarSel.value || jaren[0] || '';
  jaarSel.innerHTML = jaren.map(j => `<option value="${j}">${j}</option>`).join('');
  jaarSel.value = huidigJaar;

  // Filter periodes op geselecteerd jaar
  const gefilterd = allPeriodes.filter(p => p.start_datum.startsWith(huidigJaar));
  const huidigPeriode = periSel.value;
  periSel.innerHTML = (gefilterd.length ? '' : '<option value="">— geen periodes —</option>') +
    gefilterd.map(p => `<option value="${p.id}">${periodeNaam(p)}</option>`).join('');
  // Behoud huidige selectie als die nog in de gefilterde lijst zit
  if (huidigPeriode && gefilterd.find(p => p.id == huidigPeriode)) {
    periSel.value = huidigPeriode;
  }
}

function filterPeriodesByJaar(skipDashboard = false) {
  const jaarSel = document.getElementById('jaar-select');
  const periSel = document.getElementById('periode-select');
  const gefilterd = allPeriodes.filter(p => p.start_datum.startsWith(jaarSel.value));
  periSel.innerHTML = (gefilterd.length ? '' : '<option value="">— geen periodes —</option>') +
    gefilterd.map(p => `<option value="${p.id}">${periodeNaam(p)}</option>`).join('');
  if (!skipDashboard) laadDashboard();
}

function openModalPeriode(id) {
  document.getElementById('periode-id').value = '';
  document.getElementById('form-periode').reset();
  document.getElementById('periode-eind').value = '';
  document.getElementById('modal-periode-titel').textContent = 'Nieuwe periode';

  if (!id) {
    suggereerVolgendePeriode();
  }

  if (id) {
    const p = allPeriodes.find(x => x.id === id);
    if (!p) return;
    document.getElementById('modal-periode-titel').textContent = 'Periode bewerken';
    document.getElementById('periode-id').value = p.id;
    document.getElementById('periode-start').value = p.start_datum;
    document.getElementById('periode-eind').value = p.eind_datum || '';
    document.getElementById('periode-salaris').value = p.salaris_bedrag || '';
    document.getElementById('periode-notities').value = p.notities || '';
  }
  openModal('modal-periode');
}

async function submitPeriode(e) {
  e.preventDefault();
  const id = document.getElementById('periode-id').value;
  const body = {
    start_datum: document.getElementById('periode-start').value,
    eind_datum: document.getElementById('periode-eind').value || null,
    salaris_bedrag: parseFloat(document.getElementById('periode-salaris').value) || null,
    notities: document.getElementById('periode-notities').value
  };
  try {
    if (id) {
      await api(`/api/periodes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      const res = await api('/api/periodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      huidigePeriodeId = res.id;
    }
  } catch (err) {
    alert('Fout: ' + err.message);
    return;
  }
  sluitModal('modal-periode');
  await laadPeriodes();
  if (huidigePeriodeId) {
    document.getElementById('periode-select').value = huidigePeriodeId;
    laadDashboard();
  }
}

async function verwijderPeriode(id) {
  if (!confirm('Periode en alle bijbehorende transacties verwijderen?')) return;
  await api(`/api/periodes/${id}`, { method: 'DELETE' });
  if (huidigePeriodeId === id) {
    huidigePeriodeId = null;
    document.getElementById('dashboard-card').innerHTML = '<div class="empty">Selecteer of maak een periode aan om te beginnen.</div>';
    document.getElementById('totalen').style.display = 'none';
    document.getElementById('transacties-sectie').style.display = 'none';
  }
  laadPeriodes();
}

// ============================================================
// DASHBOARD
// ============================================================
let dashboardFilter = { categorie: '', zoekterm: '' };

function filterDashboard() {
  dashboardFilter.categorie = document.getElementById('categorie-filter').value;
  dashboardFilter.zoekterm = document.getElementById('dashboard-zoek').value.toLowerCase().trim();
  renderDashboardTabel();
}

function vulCategorieFilter() {
  const sel = document.getElementById('categorie-filter');
  const huidigCat = sel.value;
  const cats = [...new Set(dashboardOverzicht.map(o => o.categorie || '').filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Alle categorieën</option>' +
    cats.map(c => `<option value="${c}">${esc(c)}</option>`).join('');
  if (cats.includes(huidigCat)) sel.value = huidigCat;
}

function renderDashboardTabel() {
  if (!dashboardOverzicht.length) {
    document.getElementById('dashboard-card').innerHTML = '<div class="empty">Geen actieve vaste lasten. Gebruik + Toevoegen om ze toe te voegen.</div>';
    renderInactieveLasten();
    return;
  }

  const { categorie, zoekterm } = dashboardFilter;
  let gefilterd = dashboardOverzicht;
  if (categorie) gefilterd = gefilterd.filter(o => (o.categorie || '') === categorie);
  if (zoekterm) gefilterd = gefilterd.filter(o =>
    o.naam.toLowerCase().includes(zoekterm) ||
    (o.categorie || '').toLowerCase().includes(zoekterm) ||
    String(o.bedrag).includes(zoekterm) ||
    euro(o.bedrag).replace(/[\s€]/g, '').includes(zoekterm.replace(',', '.'))
  );

  const rijen = gefilterd.map(o => {
    const kanMarkeren = o.status !== 'betaald' && o.status !== 'inactief';
    const menuItems = [];

    if (o.status === 'inactief') {
      menuItems.push(`<button onclick="activeerLastInPeriode(${o.id});sluitActiesMenu()">Activeren in deze periode</button>`);
      menuItems.push(`<div class="menu-divider"></div>`);
      menuItems.push(`<button onclick="openModalLast(${o.id});sluitActiesMenu()">Bewerken</button>`);
    } else {
      if (kanMarkeren) {
        menuItems.push(`<button onclick="markeerBetaald(${o.id});sluitActiesMenu()">✓ Markeer als betaald</button>`);
        menuItems.push(`<div class="menu-divider"></div>`);
        menuItems.push(`<button onclick="openZoekTransactie(${o.id}, '${esc(o.naam)}');sluitActiesMenu()">Zoek transactie</button>`);
        menuItems.push(`<button onclick="hermatchenLast(${o.id});sluitActiesMenu()">↺ Hermatchen</button>`);
      }
      if (o.status === 'betaald' && o.handmatig_betaald) {
        menuItems.push(`<button class="danger" onclick="ongedaanMarkering(${o.id});sluitActiesMenu()">Ongedaan maken</button>`);
      }
      if (o.status === 'betaald' && !o.handmatig_betaald && o.betaling) {
        menuItems.push(`<button onclick="toonMatchDetail(${o.id});sluitActiesMenu()">Bekijk match</button>`);
      }
      menuItems.push(`<div class="menu-divider"></div>`);
      menuItems.push(`<button onclick="openModalLast(${o.id});sluitActiesMenu()">Bewerken</button>`);
      menuItems.push(`<button onclick="deactiveerLastInPeriode(${o.id});sluitActiesMenu()">Deactiveren</button>`);
    }

    menuItems.push(`<button class="danger" onclick="verwijderLast(${o.id});sluitActiesMenu()">Verwijderen</button>`);

    const dimStijl = o.status === 'inactief' ? ' style="opacity:.45"' : '';
    const bedragAfwijking = o.status === 'betaald' && !o.handmatig_betaald && o.betaling &&
      Math.abs(Math.abs(o.betaling.bedrag) - o.bedrag) > 0.01;
    const acties = `
      <div class="acties-menu">
        <button class="acties-btn" onclick="toggleActiesMenu(this, event)">•••</button>
        <div class="acties-dropdown">${menuItems.join('')}</div>
      </div>`;
    return `<tr${bedragAfwijking ? ' class="bedrag-afwijking"' : ''}>
      <td${dimStijl}><strong>${esc(o.naam)}</strong></td>
      <td${dimStijl}>${euro(o.bedrag)}</td>
      <td${dimStijl}>${esc(o.categorie || '—')}</td>
      <td${dimStijl}>${o.verwachte_dag ? o.verwachte_dag + 'e' : '—'}</td>
      <td${dimStijl}><span class="badge ${o.status}">${statusLabel(o.status)}</span></td>
      <td${dimStijl} style="font-size:12px;color:#6b7280">${o.betaling && !o.handmatig_betaald ? `${datumNL(o.betaling.datum)} &nbsp; ${euro(o.betaling.bedrag)}` : o.handmatig_betaald ? '<em>handmatig</em>' : '—'}</td>
      <td style="white-space:nowrap">${acties}</td>
    </tr>`;
  }).join('');

  const geenResultaat = gefilterd.length === 0
    ? '<tr><td colspan="8" class="empty">Geen resultaten voor deze filter.</td></tr>' : '';

  document.getElementById('dashboard-card').innerHTML = `
    <table>
      <thead><tr><th>Naam</th><th>Bedrag</th><th>Categorie</th><th>Dag v/d maand</th><th>Status</th><th>Afschrijving</th><th>Acties</th></tr></thead>
      <tbody>${rijen || geenResultaat}</tbody>
    </table>`;

  renderInactieveLasten();
}

function renderInactieveLasten() {
  const sectie = document.getElementById('inactieve-lasten-sectie');
  const inactief = allLasten.filter(l => !l.actief);
  if (!inactief.length) { sectie.style.display = 'none'; return; }
  sectie.style.display = 'block';
  document.getElementById('inactieve-lasten-body').innerHTML = inactief.map(l => `
    <tr style="opacity:.55">
      <td><strong>${esc(l.naam)}</strong></td>
      <td>${euro(l.bedrag)}</td>
      <td>${esc(l.categorie || '—')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm btn-secondary" onclick="activeerLast(${l.id})">Activeren</button>
        <button class="btn btn-sm btn-secondary" onclick="openModalLast(${l.id})">Bewerken</button>
        <button class="btn btn-sm btn-danger" onclick="verwijderLast(${l.id})">Verwijderen</button>
      </td>
    </tr>
  `).join('');
}

async function laadDashboard() {
  const sel = document.getElementById('periode-select');
  huidigePeriodeId = parseInt(sel.value) || null;

  if (!huidigePeriodeId) {
    document.getElementById('dashboard-card').innerHTML = '<div class="empty">Selecteer of maak een periode aan om te beginnen.</div>';
    document.getElementById('totalen').style.display = 'none';
    document.getElementById('dashboard-acties').style.display = 'none';
    document.getElementById('dashboard-grafieken').style.display = 'none';
    document.getElementById('inactieve-lasten-sectie').style.display = 'none';
    return;
  }

  const data = await api(`/api/periodes/${huidigePeriodeId}/overzicht`);

  document.getElementById('tot-verwacht').textContent = euro(data.totaalVerwacht);
  document.getElementById('tot-betaald').textContent = euro(data.totaalBetaald);
  document.getElementById('tot-open').textContent = euro(data.totaalVerwacht - data.totaalBetaald);
  document.getElementById('totalen').style.display = 'grid';
  document.getElementById('dashboard-acties').style.display = 'flex';
  document.getElementById('dashboard-grafieken').style.display = 'grid';

  dashboardOverzicht = data.overzicht;
  vulCategorieFilter();
  renderDashboardTabel();

  ongekoppeldeTransacties = data.transacties;

  laadGrafieken();
}

async function hermatchenLast(lastId) {
  try {
    const res = await api(`/api/periodes/${huidigePeriodeId}/hermatchen/${lastId}`, { method: 'POST' });
    laadDashboard();
    toonToast(res.gematcht ? `Match gevonden en gekoppeld.` : `Geen passende transactie gevonden.`, res.gematcht ? 'ok' : 'info');
  } catch (e) {
    alert('Fout: ' + e.message);
  }
}

function geselecteerdeItems() {
  // Returns checked rows from the dashboard table; empty array = match all
  return [...document.querySelectorAll('.last-checkbox:checked')].map(cb => ({ id: parseInt(cb.dataset.id) }));
}

async function bulkHermatchen() {
  try {
    const geselecteerd = geselecteerdeItems();
    let gematcht = 0;
    if (geselecteerd.length) {
      for (const i of geselecteerd) {
        const res = await api(`/api/periodes/${huidigePeriodeId}/hermatchen/${i.id}`, { method: 'POST' });
        gematcht += res.gematcht || 0;
      }
      toonToast(`${gematcht} van ${geselecteerd.length} geselecteerde lasten gematcht.`, gematcht ? 'ok' : 'info');
    } else {
      const res = await api(`/api/periodes/${huidigePeriodeId}/hermatchen`, { method: 'POST' });
      gematcht = res.gematcht || 0;
      toonToast(`${gematcht} van ${res.hermatcht} transacties opnieuw gematcht.`, gematcht ? 'ok' : 'info');
    }
    laadDashboard();
  } catch (e) {
    alert('Fout: ' + e.message);
  }
}

function toonMatchDetail(lastId) {
  const o = dashboardOverzicht.find(x => x.id === lastId);
  if (!o || !o.betaling) return;
  const t = o.betaling;

  // Bepaal via welke regel gematcht
  let regel = 'Bedrag + verwachte dag';
  if (o.iban_tegenrekening && t.tegenrekening &&
      o.iban_tegenrekening.replace(/\s/g,'') === t.tegenrekening.replace(/\s/g,'')) {
    regel = 'IBAN tegenrekening';
  } else if (o.omschrijving_patroon && t.omschrijving) {
    try {
      if (new RegExp(o.omschrijving_patroon, 'i').test(t.omschrijving)) regel = 'Omschrijving patroon';
    } catch {
      if (t.omschrijving.toLowerCase().includes(o.omschrijving_patroon.toLowerCase())) regel = 'Omschrijving patroon';
    }
  }

  const regelbadge = {
    'IBAN tegenrekening': 'background:#dbeafe;color:#1d4ed8',
    'Omschrijving patroon': 'background:#ede9fe;color:#6d28d9',
    'Bedrag + verwachte dag': 'background:#fef3c7;color:#92400e'
  }[regel] || '';

  document.getElementById('match-detail-inhoud').innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;width:140px">Datum</td><td style="font-size:13px">${datumNL(t.datum)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Bedrag</td><td style="font-size:13px;font-weight:600">${euro(t.bedrag)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;vertical-align:top">Omschrijving</td><td style="font-size:12px;word-break:break-word">${esc(t.omschrijving)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Tegenrekening</td><td style="font-size:12px;font-family:monospace">${esc(t.tegenrekening || '—')}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Transactie-id</td><td style="font-size:12px;color:#9ca3af">#${t.id}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Gematcht via</td><td><span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;${regelbadge}">${regel}</span></td></tr>
    </table>`;
  document.getElementById('match-detail-naam').textContent = o.naam;
  document.getElementById('btn-match-ongedaan').dataset.transactieId = t.id;
  openModal('modal-match-detail');
}

async function matchOngedaanVanuitDetail() {
  const transactieId = parseInt(document.getElementById('btn-match-ongedaan').dataset.transactieId);
  sluitModal('modal-match-detail');
  await ontkoppelTransactie(transactieId);
}

function toonToast(tekst, type = 'ok') {
  const bestaand = document.getElementById('toast');
  if (bestaand) bestaand.remove();
  const el = document.createElement('div');
  el.id = 'toast';
  el.textContent = tekst;
  const kleuren = { ok: '#16a34a', info: '#0369a1', warn: '#d97706' };
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${kleuren[type]||kleuren.ok};color:white;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:999;transition:opacity .3s`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}

async function markeerVerledenBetaald() {
  if (!confirm('Alle open vaste lasten in verleden periodes markeren als betaald?')) return;
  try {
    const res = await api('/api/periodes/markeer-verleden-betaald', { method: 'POST' });
    alert(`${res.gemarkt} lasten gemarkeerd in ${res.periodes} verleden periode(s).`);
    laadDashboard();
  } catch (e) {
    alert('Fout: ' + e.message);
  }
}

async function markeerBetaald(lastId) {
  await api(`/api/periodes/${huidigePeriodeId}/markeer/${lastId}`, { method: 'POST' });
  laadDashboard();
}

async function ongedaanMarkering(lastId) {
  await api(`/api/periodes/${huidigePeriodeId}/markeer/${lastId}`, { method: 'DELETE' });
  laadDashboard();
}

function statusLabel(s) {
  return { betaald: 'Betaald', open: 'Open', verwacht: 'Verwacht', overgeslagen: 'Overgeslagen', inactief: 'Inactief' }[s] || s;
}

function toggleActiesMenu(btn, event) {
  event.stopPropagation();
  const dropdown = btn.nextElementSibling;
  const isOpen = dropdown.classList.contains('open');
  sluitActiesMenu();
  if (!isOpen) dropdown.classList.add('open');
}

function sluitActiesMenu() {
  document.querySelectorAll('.acties-dropdown.open').forEach(d => d.classList.remove('open'));
}


async function openZoekTransactie(lastId, lastNaam) {
  document.getElementById('zoek-last-id').value = lastId;
  document.getElementById('zoek-last-naam').textContent = lastNaam;
  document.getElementById('zoek-filter').value = '';
  document.getElementById('zoek-transacties-body').innerHTML = '<tr><td colspan="5" class="empty">Laden...</td></tr>';
  openModal('modal-zoek-transactie');

  // Haal alle ongekoppelde transacties op (inclusief genegeerde)
  const alle = await api(`/api/periodes/${huidigePeriodeId}/alle-ongekoppeld`);
  window._zoekTransacties = alle;
  renderZoekTransacties(document.getElementById('zoek-filter').value.toLowerCase());
}

function filterZoekTransacties() {
  renderZoekTransacties(document.getElementById('zoek-filter').value.toLowerCase());
}

function renderZoekTransacties(filter) {
  const lastId = parseInt(document.getElementById('zoek-last-id').value);
  const tbody = document.getElementById('zoek-transacties-body');
  const bron = window._zoekTransacties || ongekoppeldeTransacties;
  const gefilterd = bron.filter(t =>
    !filter ||
    t.omschrijving.toLowerCase().includes(filter) ||
    (t.tegenrekening || '').toLowerCase().includes(filter)
  );
  if (!gefilterd.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Geen ongekoppelde transacties gevonden.</td></tr>';
    return;
  }
  tbody.innerHTML = gefilterd.map(t => `
    <tr>
      <td>${datumNL(t.datum)}</td>
      <td style="font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.omschrijving)}</td>
      <td>${euro(t.bedrag)}</td>
      <td style="font-size:11px;color:#6b7280">${esc(t.tegenrekening)}</td>
      <td><button class="btn btn-sm btn-primary" onclick="koppelVanuitLast(${t.id}, ${lastId})">Koppelen</button></td>
    </tr>
  `).join('');
}

async function ontkoppelTransactie(transactieId) {
  try {
    await api(`/api/periodes/${huidigePeriodeId}/koppel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactie_id: transactieId, last_id: null })
    });
    laadDashboard();
  } catch (e) {
    alert('Fout: ' + e.message);
  }
}

async function koppelVanuitLast(transactieId, lastId) {
  await api(`/api/periodes/${huidigePeriodeId}/koppel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactie_id: transactieId, last_id: lastId })
  });
  sluitModal('modal-zoek-transactie');
  await biedLeerAan(transactieId, lastId, window._zoekTransacties);
  laadDashboard();
}


// ============================================================
// TRANSACTIES ZOEKEN
// ============================================================
function openTransacties() {
  // Vul periode-filter met alle periodes
  const sel = document.getElementById('transacties-periode-filter');
  const huidig = sel.value;
  sel.innerHTML = '<option value="">Alle periodes</option>' +
    allPeriodes.map(p => `<option value="${p.id}">${periodeNaam(p)} ${p.start_datum.slice(0,4)}</option>`).join('');
  if (huidig) sel.value = huidig;
  zoekTransacties();
}

async function zoekTransacties() {
  const q = document.getElementById('transacties-zoek').value.trim();
  const periodeId = document.getElementById('transacties-periode-filter').value;
  const tbody = document.getElementById('transacties-zoek-body');

  if (!q && !periodeId) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Voer een zoekterm in of selecteer een periode.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="6" class="empty">Laden...</td></tr>';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (periodeId) params.set('periode_id', periodeId);

  const rijen = await api('/api/transacties?' + params);

  if (!rijen.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Geen transacties gevonden.</td></tr>';
    return;
  }

  tbody.innerHTML = rijen.map(t => {
    const periode = allPeriodes.find(p => p.id === t.periode_id);
    return `<tr>
      <td style="white-space:nowrap">${datumNL(t.datum)}</td>
      <td style="font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.omschrijving)}</td>
      <td style="white-space:nowrap">${euro(t.bedrag)}</td>
      <td style="font-size:11px;color:#6b7280">${esc(t.tegenrekening || '—')}</td>
      <td style="font-size:12px;white-space:nowrap">${periode ? periodeNaam(periode) + ' ' + periode.start_datum.slice(0,4) : '—'}</td>
      <td style="font-size:12px;color:#6b7280">${t.last_naam ? esc(t.last_naam) : '<span style="color:#d1d5db">—</span>'}</td>
    </tr>`;
  }).join('');
}

function openModalNieuweLastVanTransactie(transactieId) {
  const t = ongekoppeldeTransacties.find(x => x.id === transactieId);
  if (!t) return;
  document.getElementById('nltv-transactie-id').value = transactieId;
  document.getElementById('nltv-naam').value = t.omschrijving;
  document.getElementById('nltv-bedrag').value = Math.abs(t.bedrag).toFixed(2);
  document.getElementById('nltv-iban').value = t.tegenrekening || '';
  document.getElementById('nltv-dag').value = '';
  document.getElementById('nltv-categorie').value = '';
  document.getElementById('nltv-patroon').value = '';
  openModal('modal-nieuwe-last-transactie');
}

async function submitNieuweLastVanTransactie(e) {
  e.preventDefault();
  const body = {
    transactie_id: parseInt(document.getElementById('nltv-transactie-id').value),
    naam: document.getElementById('nltv-naam').value,
    bedrag: parseFloat(document.getElementById('nltv-bedrag').value),
    verwachte_dag: parseInt(document.getElementById('nltv-dag').value) || null,
    categorie: document.getElementById('nltv-categorie').value,
    iban_tegenrekening: document.getElementById('nltv-iban').value,
    omschrijving_patroon: document.getElementById('nltv-patroon').value,
  };
  await api(`/api/periodes/${huidigePeriodeId}/last-van-transactie`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  sluitModal('modal-nieuwe-last-transactie');
  await laadLasten();
  laadDashboard();
}

async function koppelTransactie(transactieId, lastId) {
  const parsedLastId = lastId ? parseInt(lastId) : null;
  await api(`/api/periodes/${huidigePeriodeId}/koppel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactie_id: transactieId, last_id: parsedLastId })
  });
  if (parsedLastId) await biedLeerAan(transactieId, parsedLastId, ongekoppeldeTransacties);
  laadDashboard();
}

async function biedLeerAan(transactieId, lastId, bronTransacties) {
  const transactie = (bronTransacties || []).find(t => t.id === transactieId);
  const last = allLasten.find(l => l.id === lastId);
  if (!transactie || !last) return;

  if (transactie.tegenrekening && !last.iban_tegenrekening) {
    const bevestig = confirm(
      `"${last.naam}" heeft nog geen IBAN opgeslagen.\n\nWil je "${transactie.tegenrekening}" opslaan zodat toekomstige imports automatisch matchen?`
    );
    if (bevestig) {
      await api(`/api/lasten/${lastId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...last, iban_tegenrekening: transactie.tegenrekening })
      });
      await laadLasten();
    }
  }
}

// ============================================================
// IMPORT
// ============================================================
function openModalImport() {
  document.getElementById('import-stap1').style.display = 'block';
  document.getElementById('import-stap2').style.display = 'none';
  document.getElementById('import-file').value = '';
  importPreviewData = [];
  openModal('modal-import');
}

async function previewImport() {
  const file = document.getElementById('import-file').files[0];
  if (!file) { alert('Selecteer een bestand.'); return; }

  const form = new FormData();
  form.append('bestand', file);

  const data = await api('/api/import/preview', { method: 'POST', body: form });
  importPreviewData = data.transacties;

  document.getElementById('import-samenvatting').textContent =
    `${data.totaal} transacties gevonden in "${file.name}"`;

  document.getElementById('import-preview-body').innerHTML = importPreviewData.map(t => `
    <tr>
      <td>${datumNL(t.datum)}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.omschrijving)}</td>
      <td>${euro(t.bedrag)}</td>
      <td style="font-size:11px">${esc(t.tegenrekening)}</td>
    </tr>
  `).join('');

  document.getElementById('import-stap1').style.display = 'none';
  document.getElementById('import-stap2').style.display = 'block';
}

async function slaImportOp() {
  try {
    const res = await api('/api/import/opslaan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transacties: importPreviewData })
    });
    sluitModal('modal-import');
    let msg = `${res.opgeslagen} transacties geïmporteerd, ${res.gematcht} automatisch gekoppeld.`;
    if (res.dubbel > 0) msg += `\n${res.dubbel} al bestaande transacties overgeslagen (geen dubbelen).`;
    if (res.geenPeriode > 0) msg += `\n${res.geenPeriode} transacties vallen buiten alle periodes en zijn overgeslagen.`;
    alert(msg);
    laadDashboard();
  } catch (e) {
    alert('Fout bij importeren: ' + e.message);
  }
}

// Escape HTML
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// GRAFIEKEN
// ============================================================
let chartCategorie = null;
let chartPeriodes = null;

const CHART_KLEUREN = [
  '#1d4ed8','#16a34a','#dc2626','#d97706','#7c3aed',
  '#0891b2','#be185d','#65a30d','#ea580c','#6b7280'
];

async function laadGrafieken() {
  const data = await api('/api/statistieken');

  // Donut: verdeling per categorie
  if (chartCategorie) chartCategorie.destroy();
  chartCategorie = new Chart(document.getElementById('chart-categorie'), {
    type: 'doughnut',
    data: {
      labels: data.categorieën.map(c => c.naam),
      datasets: [{
        data: data.categorieën.map(c => c.bedrag),
        backgroundColor: CHART_KLEUREN,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 12 }, padding: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: € ${ctx.parsed.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`
          }
        }
      }
    }
  });

  // Bar: verwacht vs betaald per periode
  if (chartPeriodes) chartPeriodes.destroy();
  chartPeriodes = new Chart(document.getElementById('chart-periodes'), {
    type: 'bar',
    data: {
      labels: data.periodeData.map(p => p.label),
      datasets: [
        {
          label: 'Verwacht',
          data: data.periodeData.map(p => p.verwacht),
          backgroundColor: '#dbeafe',
          borderColor: '#1d4ed8',
          borderWidth: 1
        },
        {
          label: 'Betaald',
          data: data.periodeData.map(p => p.betaald),
          backgroundColor: '#bbf7d0',
          borderColor: '#16a34a',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { size: 12 } } } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => '€ ' + v.toLocaleString('nl-NL')
          }
        }
      }
    }
  });
}


// ============================================================
// INSTELLINGEN
// ============================================================
async function laadInstellingen() {
  appInstellingen = await api('/api/instellingen');
}

async function openModalInstellingen() {
  await laadInstellingen();
  document.getElementById('inst-salaris-dag').value = appInstellingen.salaris_dag || 25;
  const nu = new Date();
  document.getElementById('inst-genereer-jaar').value = nu.getFullYear();
  renderInstPeriodes();
  openModal('modal-instellingen');
}

function renderInstPeriodes() {
  const tbody = document.getElementById('inst-periodes-body');
  if (!allPeriodes.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty" style="font-size:12px">Geen periodes.</td></tr>';
    return;
  }
  tbody.innerHTML = allPeriodes.map(p => `
    <tr>
      <td>${datumNL(p.start_datum)}</td>
      <td>${datumNL(p.eind_datum)}</td>
      <td style="text-align:right">
        <button class="btn btn-sm btn-danger" onclick="verwijderPeriodeVanuitInstellingen(${p.id})">×</button>
      </td>
    </tr>
  `).join('');
}

async function verwijderPeriodeVanuitInstellingen(id) {
  if (!confirm('Periode en alle bijbehorende transacties verwijderen?')) return;
  await api(`/api/periodes/${id}`, { method: 'DELETE' });
  if (huidigePeriodeId === id) huidigePeriodeId = null;
  await laadPeriodes();
  renderInstPeriodes();
  laadDashboard();
}

async function slaInstellingenOp() {
  const dag = parseInt(document.getElementById('inst-salaris-dag').value);
  if (!dag || dag < 1 || dag > 31) { alert('Voer een geldige dag in (1-31).'); return; }
  await api('/api/instellingen/salaris_dag', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waarde: dag }) });
  appInstellingen.salaris_dag = String(dag);
  sluitModal('modal-instellingen');
  toonToast('Instellingen opgeslagen.', 'ok');
}

async function genereerPeriodes() {
  const jaar = parseInt(document.getElementById('inst-genereer-jaar').value);
  if (!jaar) { alert('Voer een geldig jaar in.'); return; }
  try {
    const res = await api(`/api/periodes/genereer/${jaar}`, { method: 'POST' });
    await laadPeriodes();
    renderInstPeriodes();
    const msg = res.aangemaakt
      ? `${res.aangemaakt} periode(s) aangemaakt voor ${jaar}.${res.overgeslagen ? ` ${res.overgeslagen} overgeslagen (bestaan al).` : ''}`
      : `Alle periodes voor ${jaar} bestaan al.`;
    toonToast(msg, res.aangemaakt ? 'ok' : 'info');
  } catch (e) {
    alert('Fout: ' + e.message);
  }
}

// December-reminder
function toonDecemberPopup(volgendJaar) {
  document.getElementById('december-jaar-tekst').textContent = volgendJaar;
  openModal('modal-december');
}

async function decemberGenereer() {
  const nu = new Date();
  const volgendJaar = nu.getFullYear() + 1;
  sluitModal('modal-december');
  await laadInstellingen();
  try {
    const res = await api(`/api/periodes/genereer/${volgendJaar}`, { method: 'POST' });
    await laadPeriodes();
    toonToast(`${res.aangemaakt} periodes aangemaakt voor ${volgendJaar}.`, 'ok');
  } catch (e) {
    alert('Fout: ' + e.message);
  }
}

// ============================================================
// INIT
// ============================================================
// ===== Auth =====

async function checkAuth() {
  try {
    const r = await fetch('/api/auth/check');
    const data = await r.json();
    return data.authenticated;
  } catch {
    return false;
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) {
      const data = await r.json();
      errorEl.textContent = data.error || 'Inloggen mislukt';
      errorEl.style.display = 'block';
      return;
    }
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-layout').style.display = '';
    await startApp();
  } catch {
    errorEl.textContent = 'Verbindingsfout';
    errorEl.style.display = 'block';
  }
}

async function startApp() {
  await Promise.all([laadLasten(), laadPeriodes(), laadInstellingen()]);

  if (allPeriodes.length) {
    const vandaag = new Date().toISOString().slice(0, 10);
    const huidig = allPeriodes.find(p => p.start_datum <= vandaag && (!p.eind_datum || p.eind_datum >= vandaag))
      || allPeriodes[allPeriodes.length - 1];
    document.getElementById('jaar-select').value = huidig.start_datum.slice(0, 4);
    filterPeriodesByJaar(true); // populate only, avoid racing laadDashboard call below
    document.getElementById('periode-select').value = huidig.id;
    laadDashboard();
  }

  // December-reminder: toon popup als er nog geen periodes voor volgend jaar zijn
  const nu = new Date();
  if (nu.getMonth() === 11) {
    const volgendJaar = nu.getFullYear() + 1;
    const heeftVolgendJaar = allPeriodes.some(p => p.start_datum.startsWith(String(volgendJaar)));
    if (!heeftVolgendJaar) setTimeout(() => toonDecemberPopup(volgendJaar), 800);
  }
}

async function init() {
  const authenticated = await checkAuth();
  if (authenticated) {
    document.getElementById('app-layout').style.display = '';
    await startApp();
  } else {
    document.getElementById('login-screen').style.display = '';
    document.getElementById('app-layout').style.display = 'none';
  }
}

init();

document.addEventListener('click', () => sluitActiesMenu());
