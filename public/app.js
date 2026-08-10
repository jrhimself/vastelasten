// Versie
(function() {
  const base = 'v1.5.8';
  const versie = window.location.hostname.endsWith('.pages.dev') ? base + '-preview' : base;
  document.getElementById('app-versie').textContent = versie;
})();

// State
let allLasten = [];
let allPeriodes = [];
let huidigePeriodeId = null;
let bewerkJaar = null;
let importPreviewData = [];
let ongekoppeldeTransacties = [];
let dashboardOverzicht = [];
let appInstellingen = {};

function periodeNaam(p) {
  if (!p || !p.start_datum) return '—';
  const startMaand = parseInt(p.start_datum.split('-')[1]) - 1;
  const eindMaand = p.eind_datum ? parseInt(p.eind_datum.split('-')[1]) - 1 : (startMaand + 1) % 12;
  return window.MAANDEN_KORT[startMaand] + '-' + window.MAANDEN_KORT[eindMaand];
}

function periodeNaamUniek(p, lijst) {
  const naam = periodeNaam(p);
  const dubbel = lijst.filter(x => periodeNaam(x) === naam);
  if (dubbel.length <= 1) return naam;
  return naam + ' (' + p.start_datum.slice(8, 10) + '-' + p.start_datum.slice(5, 7) + ')';
}

// Hulp
function euro(n) {
  const locale = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE' }[getLang()] || 'nl-NL';
  return '€ ' + (n || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
}

function renderLasten() {
  const tbody = document.getElementById('lasten-body');
  if (!allLasten.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${t('fixed.empty')}</td></tr>`;
    return;
  }
  tbody.innerHTML = allLasten.map(l => `
    <tr>
      <td><strong>${esc(l.naam)}</strong></td>
      <td>${euro(l.bedrag)}</td>
      <td>${esc(l.categorie || '—')}</td>
      <td>${l.verwachte_dag ? l.verwachte_dag + 'e' : '—'}</td>
      <td style="text-align:right">
        <button class="btn btn-sm btn-secondary" onclick="openModalLast(${l.id})">${t('action.edit')}</button>
        <button class="btn btn-sm btn-danger" onclick="verwijderLast(${l.id})">${t('action.delete')}</button>
      </td>
    </tr>
  `).join('');
}

function openModalLast(id, vanuitDashboard = false) {
  bewerkJaar = null;
  document.getElementById('last-id').value = '';
  document.getElementById('form-last').reset();
  document.getElementById('modal-last-titel').textContent = t('modal.fixed.titleAdd');

  if (id) {
    // Bepaal databron: dashboard (jaar-overrides al gemergd) of globale lijst
    const vanDashboard = vanuitDashboard && huidigePeriodeId;
    const l = vanDashboard
      ? (dashboardOverzicht.find(x => x.id === id && x.periode_id === huidigePeriodeId)
         || dashboardOverzicht.find(x => x.id === id))
      : allLasten.find(x => x.id === id);
    if (!l) return;

    if (vanDashboard) {
      const periode = allPeriodes.find(p => p.id === huidigePeriodeId);
      bewerkJaar = periode ? new Date(periode.start_datum).getFullYear() : null;
    }

    const titelSuffix = bewerkJaar ? ` (${bewerkJaar})` : '';
    document.getElementById('modal-last-titel').textContent = t('modal.fixed.titleEdit') + titelSuffix;
    document.getElementById('last-id').value = l.id;
    document.getElementById('last-naam').value = l.naam;
    document.getElementById('last-bedrag').value = (l.bedrag || 0).toFixed(2);
    document.getElementById('last-dag').value = l.verwachte_dag || '';
    document.getElementById('last-categorie').value = l.categorie || '';
    document.getElementById('last-iban').value = l.iban_tegenrekening || '';
    document.getElementById('last-patroon').value = l.omschrijving_patroon || '';
    document.getElementById('last-afwijking').value = l.afwijking_drempel != null ? l.afwijking_drempel : '';
    document.getElementById('last-variabel').checked = !!l.variabel;
  }
  openModal('modal-last');
}

async function submitLast(e) {
  e.preventDefault();
  const id = document.getElementById('last-id').value;
  const variabel = document.getElementById('last-variabel').checked ? 1 : 0;
  const bedragVal = parseFloat(document.getElementById('last-bedrag').value);
  if (!variabel && (!bedragVal || bedragVal <= 0)) {
    alert(t('alert.amountRequired'));
    return;
  }
  const body = {
    naam: document.getElementById('last-naam').value,
    bedrag: bedragVal || 0,
    verwachte_dag: parseInt(document.getElementById('last-dag').value) || null,
    categorie: document.getElementById('last-categorie').value,
    iban_tegenrekening: document.getElementById('last-iban').value,
    omschrijving_patroon: document.getElementById('last-patroon').value,
    afwijking_drempel: parseFloat(document.getElementById('last-afwijking').value) || null,
    variabel,
    actief: 1
  };
  if (id && bewerkJaar) {
    const huidigePeriode = allPeriodes.find(p => p.id === huidigePeriodeId);
    body.vanaf_datum = huidigePeriode ? huidigePeriode.start_datum : '0000-00-00';
    await api(`/api/lasten/${id}/jaar/${bewerkJaar}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (huidigePeriodeId) await api(`/api/periodes/${huidigePeriodeId}/hermatchen`, { method: 'POST' });
  } else if (id) {
    await api(`/api/lasten/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } else {
    const res = await api('/api/lasten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // Hide in all previous periods of this year so it only propagates forward
    if (huidigePeriodeId && res.id) {
      await api(`/api/lasten/${res.id}/activeer-vanaf-periode/${huidigePeriodeId}`, { method: 'POST' });
      // Prevent automatic propagation to next year
      const huidigePeriode = allPeriodes.find(p => p.id === huidigePeriodeId);
      if (huidigePeriode) {
        const volgendJaar = new Date(huidigePeriode.start_datum).getFullYear() + 1;
        await api(`/api/lasten/${res.id}/jaar/${volgendJaar}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actief: 0, vanaf_datum: '0000-00-00' })
        });
      }
    }
  }
  sluitModal('modal-last');
  await laadLasten();
  if (huidigePeriodeId) laadDashboard();
}

async function verwijderLast(id) {
  if (!confirm(t('alert.deleteFixed'))) return;
  await api(`/api/lasten/${id}`, { method: 'DELETE' });
  await laadLasten();
  if (huidigePeriodeId) laadDashboard();
}

// ============================================================
// PERIODES
// ============================================================
async function laadPeriodes() {
  allPeriodes = await api('/api/periodes');
  if (!window._duplicaatCheckDone) {
    await verwijderDuplicaatPeriodes();
    window._duplicaatCheckDone = true;
  }
  renderPeriodes();
  vulPeriodeSelect();
}

async function verwijderDuplicaatPeriodes() {
  try {
    const namen = allPeriodes.map(p => p.start_datum + '|' + p.eind_datum);
    const heeftDubbel = namen.some((n, i) => namen.indexOf(n) !== i);
    if (!heeftDubbel) return;
    const res = await api('/api/periodes/verwijder-duplicaten', { method: 'POST' });
    if (res.verwijderd > 0) {
      allPeriodes = await api('/api/periodes');
    }
  } catch (e) {
    console.warn('Duplicaat-cleanup overgeslagen:', e.message);
  }
}

function renderPeriodes() {
  const tbody = document.getElementById('periodes-body');
  if (!allPeriodes.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${t('periods.empty')}</td></tr>`;
    return;
  }
  tbody.innerHTML = allPeriodes.map(p => `
    <tr>
      <td>${datumNL(p.start_datum)}</td>
      <td>${datumNL(p.eind_datum)}</td>
      <td>${p.salaris_bedrag ? euro(p.salaris_bedrag) : '—'}</td>
      <td>${esc(p.notities || '')}</td>
      <td style="text-align:right">
        <button class="btn btn-sm btn-secondary" onclick="openModalPeriode(${p.id})">${t('action.edit')}</button>
        <button class="btn btn-sm btn-danger" onclick="verwijderPeriode(${p.id})">${t('action.delete')}</button>
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
  periSel.innerHTML = (gefilterd.length ? '' : `<option value="">${t('filter.noPeriods')}</option>`) +
    (gefilterd.length ? `<option value="alle">${t('filter.allPeriods')}</option>` : '') +
    gefilterd.map(p => `<option value="${p.id}">${periodeNaamUniek(p, gefilterd)}</option>`).join('');
  // Behoud huidige selectie als die nog in de gefilterde lijst zit
  if (huidigPeriode && (huidigPeriode === 'alle' || gefilterd.find(p => String(p.id) === huidigPeriode))) {
    periSel.value = huidigPeriode;
  }
}

function filterPeriodesByJaar(skipDashboard = false) {
  const jaarSel = document.getElementById('jaar-select');
  const periSel = document.getElementById('periode-select');
  const gefilterd = allPeriodes.filter(p => p.start_datum.startsWith(jaarSel.value));
  periSel.innerHTML = (gefilterd.length ? '' : `<option value="">${t('filter.noPeriods')}</option>`) +
    (gefilterd.length ? `<option value="alle">${t('filter.allPeriods')}</option>` : '') +
    gefilterd.map(p => `<option value="${p.id}">${periodeNaamUniek(p, gefilterd)}</option>`).join('');
  if (!skipDashboard) laadDashboard();
}

function openModalPeriode(id) {
  document.getElementById('periode-id').value = '';
  document.getElementById('form-periode').reset();
  document.getElementById('periode-eind').value = '';
  document.getElementById('modal-periode-titel').textContent = t('modal.period.titleNew');

  if (!id) {
    suggereerVolgendePeriode();
  }

  if (id) {
    const p = allPeriodes.find(x => x.id === id);
    if (!p) return;
    document.getElementById('modal-periode-titel').textContent = t('modal.period.titleEdit');
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
    alert(t('alert.error', { error: err.message }));
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
  if (!confirm(t('alert.deletePeriod'))) return;
  await api(`/api/periodes/${id}`, { method: 'DELETE' });
  if (huidigePeriodeId === id) {
    huidigePeriodeId = null;
    document.getElementById('dashboard-card').innerHTML = `<div class="empty">${t('dashboard.empty')}</div>`;
    document.getElementById('totalen').style.display = 'none';
    document.getElementById('transacties-sectie') && (document.getElementById('transacties-sectie').style.display = 'none');
  }
  laadPeriodes();
}

// ============================================================
// DASHBOARD
// ============================================================
let dashboardFilter = { categorie: '', status: '', zoekterm: '' };

function filterDashboard() {
  dashboardFilter.categorie = document.getElementById('categorie-filter').value;
  dashboardFilter.status = document.getElementById('status-filter').value;
  dashboardFilter.zoekterm = document.getElementById('dashboard-zoek').value.toLowerCase().trim();
  renderDashboardTabel();
}

function vulCategorieFilter() {
  const sel = document.getElementById('categorie-filter');
  const huidigCat = sel.value;
  const cats = [...new Set(dashboardOverzicht.map(o => o.categorie || '').filter(Boolean))].sort();
  sel.innerHTML = `<option value="">${t('filter.allCategories')}</option>` +
    cats.map(c => `<option value="${c}">${esc(c)}</option>`).join('');
  if (cats.includes(huidigCat)) sel.value = huidigCat;
}

// Tijdelijk periode instellen vanuit "alle periodes" modus voor periode-specifieke acties
function setAlleModePeriode(periodeId) {
  huidigePeriodeId = periodeId;
}

function toggleGrafieken(btn) {
  const inhoud = document.getElementById('grafieken-inhoud');
  const pijl = document.getElementById('grafieken-pijl');
  const ingeklapt = inhoud.style.display === 'none';
  inhoud.style.display = ingeklapt ? '' : 'none';
  pijl.textContent = ingeklapt ? '▼' : '▶';
}

function renderRij(o, isAlleMode) {
  const afwijkingDrempel = o.afwijking_drempel ?? 0.01;
  const heeftAfwijking = !!o.betaling && Math.abs(Math.abs(o.betaling.bedrag) - o.bedrag) > afwijkingDrempel;
  const eenmaligGeaccepteerd = o.betaling?.bedrag_afwijking_geaccepteerd === 1 && heeftAfwijking;
  const bedragAfwijking = !o.variabel && !eenmaligGeaccepteerd && o.status === 'betaald' && !o.handmatig_betaald && heeftAfwijking;

  const ctx = isAlleMode ? `setAlleModePeriode(${o.periode_id});` : '';
  const periodeLabel = isAlleMode && o.periode_start ? periodeNaam({ start_datum: o.periode_start }) : null;

  const kanMarkeren = o.status !== 'betaald' && o.status !== 'inactief';
  const menuItems = [];

  if (o.periode_inactief) {
    menuItems.push(`<button onclick="${ctx}activeerLastVoorPeriode(${o.id});sluitActiesMenu()">${t('action.activateFromHere')}</button>`);
    menuItems.push(`<div class="menu-divider"></div>`);
  }

  if (kanMarkeren) {
    menuItems.push(`<button onclick="${ctx}markeerBetaald(${o.id});sluitActiesMenu()">${t('action.markPaid')}</button>`);
    menuItems.push(`<div class="menu-divider"></div>`);
    menuItems.push(`<button onclick="${ctx}openZoekTransactie(${o.id}, '${esc(o.naam)}');sluitActiesMenu()">${t('action.findTransaction')}</button>`);
    menuItems.push(`<button onclick="${ctx}hermatchenLast(${o.id});sluitActiesMenu()">${t('action.rematch')}</button>`);
  }
  if (o.status === 'betaald' && o.handmatig_betaald) {
    menuItems.push(`<button class="danger" onclick="${ctx}ongedaanMarkering(${o.id});sluitActiesMenu()">${t('action.undoMark')}</button>`);
  }
  if (o.status === 'betaald' && !o.handmatig_betaald && o.betaling) {
    const periodeArg = isAlleMode ? `,${o.periode_id}` : '';
    menuItems.push(`<button onclick="${ctx}toonMatchDetail(${o.id}${periodeArg});sluitActiesMenu()">${t('action.viewMatch')}</button>`);
  }
  menuItems.push(`<div class="menu-divider"></div>`);
  menuItems.push(`<button onclick="${ctx}openModalLast(${o.id},true);sluitActiesMenu()">${t('action.edit')}</button>`);
  menuItems.push(`<button class="danger" onclick="${ctx}verwijderLast(${o.id});sluitActiesMenu()">${t('action.delete')}</button>`);

  const dimStijl = o.status === 'inactief' ? ' style="opacity:.45"' : '';
  const acties = `
      <div class="acties-menu">
        <button class="acties-btn" onclick="toggleActiesMenu(this, event)">•••</button>
        <div class="acties-dropdown">${menuItems.join('')}</div>
      </div>`;
  const vierdeKolom = isAlleMode
    ? `<td${dimStijl}>${periodeLabel || '—'}</td><td${dimStijl}>${o.verwachte_dag ? o.verwachte_dag + 'e' : '—'}</td>`
    : `<td${dimStijl}>${o.verwachte_dag ? o.verwachte_dag + 'e' : '—'}</td>`;
  return `<tr data-last-id="${o.id}"${bedragAfwijking ? ' class="bedrag-afwijking"' : ''}>
      <td${dimStijl}><strong>${esc(o.naam)}</strong></td>
      <td${dimStijl}>${euro(o.bedrag)}</td>
      <td${dimStijl}>${esc(o.categorie || '—')}</td>
      ${vierdeKolom}
      <td${dimStijl}><span class="badge ${o.status}">${statusLabel(o.status)}</span></td>
      <td${dimStijl} style="font-size:12px;color:#6b7280">${o.betaling && !o.handmatig_betaald ? `${datumNL(o.betaling.datum)} &nbsp; ${euro(o.betaling.bedrag)}${eenmaligGeaccepteerd ? ' <span title="Bedrag eenmalig geaccepteerd" style="color:#d97706;font-weight:600">~</span>' : ''}` : o.handmatig_betaald ? `<em>${t('manual')}</em>` : '—'}</td>
      <td style="white-space:nowrap">${acties}</td>
    </tr>`;
}

function renderDashboardTabel() {
  const isAlleMode = document.getElementById('periode-select').value === 'alle';

  if (!dashboardOverzicht.length) {
    document.getElementById('dashboard-card').innerHTML = `<div class="empty">${t('dashboard.noActive')}</div>`;
    return;
  }

  const { categorie, status, zoekterm } = dashboardFilter;
  let gefilterd = dashboardOverzicht;
  if (categorie) gefilterd = gefilterd.filter(o => (o.categorie || '') === categorie);
  if (status) gefilterd = gefilterd.filter(o => o.status === status);
  if (zoekterm) gefilterd = gefilterd.filter(o =>
    o.naam.toLowerCase().includes(zoekterm) ||
    (o.categorie || '').toLowerCase().includes(zoekterm) ||
    String(o.bedrag).includes(zoekterm) ||
    euro(o.bedrag).replace(/[\s€]/g, '').includes(zoekterm.replace(',', '.'))
  );

  const rijen = gefilterd.map(o => renderRij(o, isAlleMode)).join('');

  const colspan = isAlleMode ? 8 : 7;
  const geenResultaat = gefilterd.length === 0
    ? `<tr><td colspan="${colspan}" class="empty">${t('dashboard.noResults')}</td></tr>` : '';

  const headers = isAlleMode
    ? `<th>${t('table.name')}</th><th>${t('table.amount')}</th><th>${t('table.category')}</th><th>${t('table.period')}</th><th>${t('table.day')}</th><th>${t('table.status')}</th><th>${t('table.debit')}</th><th>${t('table.actions')}</th>`
    : `<th>${t('table.name')}</th><th>${t('table.amount')}</th><th>${t('table.category')}</th><th>${t('table.dayOfMonth')}</th><th>${t('table.status')}</th><th>${t('table.debit')}</th><th>${t('table.actions')}</th>`;

  document.getElementById('dashboard-card').innerHTML = `
    <table>
      <thead><tr>${headers}</tr></thead>
      <tbody>${rijen || geenResultaat}</tbody>
    </table>`;
}

async function laadDashboard() {
  const sel = document.getElementById('periode-select');
  const selValue = sel.value;
  const isAlleMode = selValue === 'alle';
  huidigePeriodeId = isAlleMode ? null : (parseInt(selValue) || null);

  if (!huidigePeriodeId && !isAlleMode) {
    document.getElementById('dashboard-card').innerHTML = `<div class="empty">${t('dashboard.empty')}</div>`;
    document.getElementById('totalen').style.display = 'none';
    document.getElementById('dashboard-acties').style.display = 'none';
    document.getElementById('dashboard-grafieken').style.display = 'none';
    return;
  }

  let data;
  if (isAlleMode) {
    const jaar = document.getElementById('jaar-select').value;
    data = await api(`/api/periodes/jaar/${jaar}/overzicht`);
  } else {
    data = await api(`/api/periodes/${huidigePeriodeId}/overzicht`);
  }

  document.getElementById('tot-verwacht').textContent = euro(data.totaalVerwacht);
  document.getElementById('tot-betaald').textContent = euro(data.totaalBetaald);
  document.getElementById('tot-open').textContent = euro(data.totaalVerwacht - data.totaalBetaald);
  document.getElementById('totalen').style.display = 'grid';
  document.getElementById('dashboard-acties').style.display = isAlleMode ? 'none' : 'flex';
  document.getElementById('dashboard-grafieken').style.display = 'block';

  dashboardOverzicht = data.overzicht;
  vulCategorieFilter();
  renderDashboardTabel();

  ongekoppeldeTransacties = data.transacties || [];

  laadGrafieken();
}

async function hermatchenLast(lastId) {
  try {
    const res = await api(`/api/periodes/${huidigePeriodeId}/hermatchen/${lastId}`, { method: 'POST' });
    if (res.gematcht) {
      const data = await api(`/api/periodes/${huidigePeriodeId}/overzicht`);
      const item = data.overzicht.find(i => i.id === lastId);
      if (item) {
        const rij = document.querySelector(`tr[data-last-id="${lastId}"]`);
        if (rij) {
          const isAlleMode = document.getElementById('periode-select').value === 'alle';
          rij.outerHTML = renderRij(item, isAlleMode);
        }
        const idx = dashboardOverzicht.findIndex(i => i.id === lastId);
        if (idx !== -1) dashboardOverzicht[idx] = item;
      }
    }
    toonToast(res.gematcht ? t('toast.matchFound') : t('toast.noMatch'), res.gematcht ? 'ok' : 'info');
  } catch (e) {
    alert(t('alert.error', { error: e.message }));
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
      toonToast(t('toast.matchedOf', { matched: gematcht, total: geselecteerd.length }), gematcht ? 'ok' : 'info');
    } else {
      const res = await api(`/api/periodes/${huidigePeriodeId}/hermatchen`, { method: 'POST' });
      gematcht = res.gematcht || 0;
      toonToast(t('toast.rematchedOf', { matched: gematcht, total: res.hermatcht }), gematcht ? 'ok' : 'info');
    }
    laadDashboard();
  } catch (e) {
    alert(t('alert.error', { error: e.message }));
  }
}

function toonMatchDetail(lastId, periodeId = null) {
  const o = periodeId
    ? dashboardOverzicht.find(x => x.id === lastId && x.periode_id === periodeId)
    : dashboardOverzicht.find(x => x.id === lastId);
  if (!o || !o.betaling) return;
  const tx = o.betaling;

  // Bepaal via welke regel gematcht
  let regelKey = 'amount';
  if (o.iban_tegenrekening && tx.tegenrekening &&
      o.iban_tegenrekening.replace(/\s/g,'') === tx.tegenrekening.replace(/\s/g,'')) {
    regelKey = 'iban';
  } else if (o.omschrijving_patroon && tx.omschrijving) {
    try {
      if (new RegExp(o.omschrijving_patroon, 'i').test(tx.omschrijving)) regelKey = 'pattern';
    } catch {
      if (tx.omschrijving.toLowerCase().includes(o.omschrijving_patroon.toLowerCase())) regelKey = 'pattern';
    }
  }

  const regelLabel = t('modal.match.rule.' + regelKey);
  const regelbadge = {
    iban: 'background:#dbeafe;color:#1d4ed8',
    pattern: 'background:#ede9fe;color:#6d28d9',
    amount: 'background:#fef3c7;color:#92400e'
  }[regelKey] || '';

  document.getElementById('match-detail-inhoud').innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;width:140px">${t('modal.match.date')}</td><td style="font-size:13px">${datumNL(tx.datum)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">${t('modal.match.amount')}</td><td style="font-size:13px;font-weight:600">${euro(tx.bedrag)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;vertical-align:top">${t('modal.match.desc')}</td><td style="font-size:12px;word-break:break-word">${esc(tx.omschrijving)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">${t('modal.match.counter')}</td><td style="font-size:12px;font-family:monospace">${esc(tx.tegenrekening || '—')}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">${t('modal.match.txId')}</td><td style="font-size:12px;color:#9ca3af">#${tx.id}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">${t('modal.match.matchedBy')}</td><td><span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;${regelbadge}">${regelLabel}</span></td></tr>
    </table>`;
  const afwijkingDrempel = o.afwijking_drempel ?? 0.01;
  const heeftAfwijking = !o.variabel && Math.abs(Math.abs(tx.bedrag) - o.bedrag) > afwijkingDrempel;
  const accepteerKnop = document.getElementById('btn-accepteer-bedrag');
  const accepteerEenmaligKnop = document.getElementById('btn-accepteer-bedrag-eenmalig');
  if (heeftAfwijking) {
    accepteerKnop.textContent = t('btn.acceptAsNew', { amount: euro(Math.abs(tx.bedrag)) });
    accepteerKnop.dataset.lastId = lastId;
    accepteerKnop.dataset.periodeId = periodeId || '';
    accepteerKnop.style.display = '';
    accepteerEenmaligKnop.textContent = t('btn.acceptOnce', { amount: euro(Math.abs(tx.bedrag)) });
    accepteerEenmaligKnop.dataset.lastId = lastId;
    accepteerEenmaligKnop.dataset.periodeId = periodeId || '';
    accepteerEenmaligKnop.style.display = '';
  } else {
    accepteerKnop.style.display = 'none';
    accepteerEenmaligKnop.style.display = 'none';
  }

  document.getElementById('match-detail-naam').textContent = o.naam;
  document.getElementById('btn-match-ongedaan').dataset.transactieId = tx.id;
  openModal('modal-match-detail');
}

async function accepteerAfwijkingBedrag() {
  const lastId = parseInt(document.getElementById('btn-accepteer-bedrag').dataset.lastId);
  const periodeId = parseInt(document.getElementById('btn-accepteer-bedrag').dataset.periodeId) || null;
  const o = periodeId
    ? dashboardOverzicht.find(x => x.id === lastId && x.periode_id === periodeId)
    : dashboardOverzicht.find(x => x.id === lastId);
  if (!o || !o.betaling) return;
  const periode = allPeriodes.find(p => p.id === huidigePeriodeId);
  if (!periode) return;
  const jaar = new Date(periode.start_datum).getFullYear();
  const nieuwBedrag = Math.abs(o.betaling.bedrag);
  sluitModal('modal-match-detail');
  await api(`/api/lasten/${lastId}/jaar/${jaar}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bedrag: nieuwBedrag, vanaf_datum: periode.start_datum })
  });
  await api(`/api/periodes/${huidigePeriodeId}/hermatchen`, { method: 'POST' });
  laadDashboard();
}

async function accepteerAfwijkingEenmalig() {
  const knop = document.getElementById('btn-accepteer-bedrag-eenmalig');
  const lastId = parseInt(knop.dataset.lastId);
  const periodeId = parseInt(knop.dataset.periodeId) || huidigePeriodeId;
  if (!periodeId) return;
  sluitModal('modal-match-detail');
  await api(`/api/periodes/${periodeId}/accepteer-afwijking-eenmalig/${lastId}`, { method: 'POST' });
  laadDashboard();
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
  if (!confirm(t('alert.markAllPast'))) return;
  try {
    const res = await api('/api/periodes/markeer-verleden-betaald', { method: 'POST' });
    alert(t('alert.markedPast', { count: res.gemarkt, periods: res.periodes }));
    laadDashboard();
  } catch (e) {
    alert(t('alert.error', { error: e.message }));
  }
}

async function markeerBetaald(lastId) {
  await api(`/api/periodes/${huidigePeriodeId}/markeer/${lastId}`, { method: 'POST' });
  laadDashboard();
}

async function activeerLastVoorPeriode(lastId) {
  await api(`/api/periodes/${huidigePeriodeId}/activeer-last/${lastId}`, { method: 'POST' });
  laadDashboard();
}

async function ongedaanMarkering(lastId) {
  await api(`/api/periodes/${huidigePeriodeId}/markeer/${lastId}`, { method: 'DELETE' });
  laadDashboard();
}

function statusLabel(s) {
  const map = { betaald: 'status.paid', open: 'status.open', verwacht: 'status.expected', overgeslagen: 'status.skipped', inactief: 'status.inactive' };
  return map[s] ? t(map[s]) : s;
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
  document.getElementById('zoek-transacties-body').innerHTML = `<tr><td colspan="5" class="empty">${t('transactions.loading')}</td></tr>`;
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
  const gefilterd = bron.filter(tx =>
    !filter ||
    tx.omschrijving.toLowerCase().includes(filter) ||
    (tx.tegenrekening || '').toLowerCase().includes(filter)
  );
  if (!gefilterd.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${t('zoek.noUncoupled')}</td></tr>`;
    return;
  }
  tbody.innerHTML = gefilterd.map(tx => `
    <tr>
      <td>${datumNL(tx.datum)}</td>
      <td style="font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tx.omschrijving)}</td>
      <td>${euro(tx.bedrag)}</td>
      <td style="font-size:11px;color:#6b7280">${esc(tx.tegenrekening)}</td>
      <td><button class="btn btn-sm btn-primary" onclick="koppelVanuitLast(${tx.id}, ${lastId})">${t('btn.link')}</button></td>
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
    alert(t('alert.error', { error: e.message }));
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
  sel.innerHTML = `<option value="">${t('filter.allPeriods')}</option>` +
    allPeriodes.map(p => `<option value="${p.id}">${periodeNaam(p)} ${p.start_datum.slice(0,4)}</option>`).join('');
  if (huidig) sel.value = huidig;
  zoekTransacties();
}

async function zoekTransacties() {
  const q = document.getElementById('transacties-zoek').value.trim();
  const periodeId = document.getElementById('transacties-periode-filter').value;
  const tbody = document.getElementById('transacties-zoek-body');

  if (!q && !periodeId) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${t('transactions.empty.prompt')}</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="6" class="empty">${t('transactions.loading')}</td></tr>`;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (periodeId) params.set('periode_id', periodeId);

  const rijen = await api('/api/transacties?' + params);

  if (!rijen.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${t('transactions.empty.none')}</td></tr>`;
    return;
  }

  tbody.innerHTML = rijen.map(tx => {
    const periode = allPeriodes.find(p => p.id === tx.periode_id);
    return `<tr>
      <td style="white-space:nowrap">${datumNL(tx.datum)}</td>
      <td style="font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tx.omschrijving)}</td>
      <td style="white-space:nowrap">${euro(tx.bedrag)}</td>
      <td style="font-size:11px;color:#6b7280">${esc(tx.tegenrekening || '—')}</td>
      <td style="font-size:12px;white-space:nowrap">${periode ? periodeNaam(periode) + ' ' + periode.start_datum.slice(0,4) : '—'}</td>
      <td style="font-size:12px;color:#6b7280">${tx.last_naam ? esc(tx.last_naam) : '<span style="color:#d1d5db">—</span>'}</td>
    </tr>`;
  }).join('');
}

function openModalNieuweLastVanTransactie(transactieId) {
  const tx = ongekoppeldeTransacties.find(x => x.id === transactieId);
  if (!tx) return;
  document.getElementById('nltv-transactie-id').value = transactieId;
  document.getElementById('nltv-naam').value = tx.omschrijving;
  document.getElementById('nltv-bedrag').value = Math.abs(tx.bedrag).toFixed(2);
  document.getElementById('nltv-iban').value = tx.tegenrekening || '';
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
  const transactie = (bronTransacties || []).find(tx => tx.id === transactieId);
  const last = allLasten.find(l => l.id === lastId);
  if (!transactie || !last) return;

  if (transactie.tegenrekening && !last.iban_tegenrekening) {
    const bevestig = confirm(t('alert.learnIban', { name: last.naam, iban: transactie.tegenrekening }));
    if (bevestig) {
      // Sla globaal op (fallback voor jaren zonder override)
      await api(`/api/lasten/${lastId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...last, iban_tegenrekening: transactie.tegenrekening })
      });
      // Sla ook op in jaar-override zodat autoMatch met jaar-overrides ook matcht
      if (huidigePeriodeId) {
        const periode = allPeriodes.find(p => p.id === huidigePeriodeId);
        const jaar = periode ? new Date(periode.start_datum).getFullYear() : null;
        if (jaar) {
          await api(`/api/lasten/${lastId}/jaar/${jaar}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ iban_tegenrekening: transactie.tegenrekening })
          });
        }
      }
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
  if (!file) { alert(t('alert.selectFile')); return; }

  const form = new FormData();
  form.append('bestand', file);

  const data = await api('/api/import/preview', { method: 'POST', body: form });
  importPreviewData = data.transacties;

  document.getElementById('import-samenvatting').textContent =
    t('import.summary', { total: data.totaal, filename: file.name });

  document.getElementById('import-preview-body').innerHTML = importPreviewData.map(tx => `
    <tr>
      <td>${datumNL(tx.datum)}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tx.omschrijving)}</td>
      <td>${euro(tx.bedrag)}</td>
      <td style="font-size:11px">${esc(tx.tegenrekening)}</td>
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
    let msg = t('import.result', { saved: res.opgeslagen, matched: res.gematcht });
    if (res.dubbel > 0) msg += t('import.duplicates', { count: res.dubbel });
    if (res.geenPeriode > 0) msg += t('import.noPeriod', { count: res.geenPeriode });
    alert(msg);
    laadDashboard();
  } catch (e) {
    alert(t('alert.importError', { error: e.message }));
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
          label: t('charts.dataset.expected'),
          data: data.periodeData.map(p => p.verwacht),
          backgroundColor: '#dbeafe',
          borderColor: '#1d4ed8',
          borderWidth: 1
        },
        {
          label: t('charts.dataset.paid'),
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
    tbody.innerHTML = `<tr><td colspan="3" class="empty" style="font-size:12px">${t('periods.empty')}</td></tr>`;
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
  if (!confirm(t('alert.deletePeriod'))) return;
  try {
    await api(`/api/periodes/${id}`, { method: 'DELETE' });
    if (huidigePeriodeId === id) huidigePeriodeId = null;
    await laadPeriodes();
    renderInstPeriodes();
    laadDashboard();
    toonToast(t('toast.periodDeleted'), 'ok');
  } catch (e) {
    toonToast(t('toast.deleteFailed', { error: e.message }), 'fout');
  }
}

async function slaInstellingenOp() {
  const dag = parseInt(document.getElementById('inst-salaris-dag').value);
  if (!dag || dag < 1 || dag > 31) { alert(t('alert.salaryDayInvalid')); return; }
  await api('/api/instellingen/salaris_dag', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waarde: dag }) });
  appInstellingen.salaris_dag = String(dag);
  sluitModal('modal-instellingen');
  toonToast(t('toast.settingsSaved'), 'ok');
}

async function verwijderJaarPeriodes() {
  const jaar = parseInt(document.getElementById('inst-genereer-jaar').value);
  if (!jaar) { alert(t('alert.yearInvalid')); return; }
  if (!confirm(t('alert.deleteYear', { year: jaar }))) return;
  try {
    const res = await api(`/api/periodes/jaar/${jaar}`, { method: 'DELETE' });
    if (huidigePeriodeId) {
      const periode = allPeriodes.find(p => p.id === huidigePeriodeId);
      if (periode && periode.start_datum.startsWith(String(jaar))) huidigePeriodeId = null;
    }
    await laadPeriodes();
    renderInstPeriodes();
    laadDashboard();
    toonToast(t('toast.yearDeleted', { year: jaar }), 'ok');
  } catch (e) {
    alert(t('alert.error', { error: e.message }));
  }
}

async function genereerPeriodes() {
  const jaar = parseInt(document.getElementById('inst-genereer-jaar').value);
  if (!jaar) { alert(t('alert.yearInvalid')); return; }
  try {
    const res = await api(`/api/periodes/genereer/${jaar}`, { method: 'POST' });
    await laadPeriodes();
    renderInstPeriodes();
    const msg = res.aangemaakt
      ? t('periods.generated', { count: res.aangemaakt, year: jaar }) + (res.overgeslagen ? ` ${t('periods.generatedSkipped', { count: res.overgeslagen })}` : '')
      : t('periods.allExist', { year: jaar });
    toonToast(msg, res.aangemaakt ? 'ok' : 'info');
  } catch (e) {
    alert(t('alert.error', { error: e.message }));
  }
}

// December-reminder
function toonDecemberPopup(volgendJaar) {
  document.getElementById('december-tekst').innerHTML = t('modal.december.text', { year: volgendJaar });
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
    toonToast(t('periods.decemberGenerated', { count: res.aangemaakt, year: volgendJaar }), 'ok');
  } catch (e) {
    alert(t('alert.error', { error: e.message }));
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
      errorEl.textContent = data.error || t('login.error.failed');
      errorEl.style.display = 'block';
      return;
    }
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-layout').style.display = '';
    await startApp();
  } catch {
    errorEl.textContent = t('login.error.connection');
    errorEl.style.display = 'block';
  }
}

async function startApp() {
  await Promise.all([laadLasten(), laadPeriodes(), laadInstellingen()]);

  // First run: no periods yet — auto-generate 12 for the current year
  if (!allPeriodes.length) {
    const jaar = new Date().getFullYear();
    try {
      const res = await api(`/api/periodes/genereer/${jaar}`, { method: 'POST' });
      await laadPeriodes();
      toonToast(t('periods.generated', { count: res.aangemaakt, year: jaar }), 'ok');
    } catch (e) {
      console.warn('Auto-generate periods failed:', e.message);
    }
  }

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
    try {
      await startApp();
    } catch (e) {
      console.error('App laden mislukt:', e);
    }
  } else {
    document.getElementById('login-screen').style.display = '';
    document.getElementById('app-layout').style.display = 'none';
  }
}

init();

document.addEventListener('click', () => sluitActiesMenu());
