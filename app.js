const SERIES_SHEET_ID = '1B5crPF8woDq_S0Tq47ynx3Rfw8aAa6TJFHNqIer0sY';
const CONNECTION_SHEET_ID = '1Zb0OsuV9yLpv_3Z1GyFGBF2Sa04B-UcmpwxxCwOMO60';

const GVIZ = (id) => `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json`;

const state = {
  rawSeries: [],
  rawConnections: [],
  root: null,
  filters: { era: '', universe: '', hero: '' },
  zoom: 1,
  panX: 80,
  panY: 80,
  drag: null,
  columnMap: {}
};

const el = {
  viewport: document.getElementById('mapViewport'),
  surface: document.getElementById('mapSurface'),
  edgeLayer: document.getElementById('edgeLayer'),
  nodeLayer: document.getElementById('nodeLayer'),
  eraFilter: document.getElementById('eraFilter'),
  universeFilter: document.getElementById('universeFilter'),
  heroFilter: document.getElementById('heroFilter'),
  resetFilters: document.getElementById('resetFilters'),
  warning: document.getElementById('sheetWarning'),
  error: document.getElementById('sheetError'),
  zoomPct: document.getElementById('zoomPct'),
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  resetView: document.getElementById('resetView'),
  fitTree: document.getElementById('fitTree'),
  modal: document.getElementById('detailsModal'),
  modalContent: document.getElementById('modalContent'),
  closeModal: document.getElementById('closeModal'),
  themeToggle: document.getElementById('themeToggle')
};

async function fetchGvizJson(sheetId) {
  const res = await fetch(GVIZ(sheetId));
  if (!res.ok) throw new Error(`Sheet ${sheetId} request failed`);
  const txt = await res.text();
  const json = JSON.parse(txt.substring(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  return json.table;
}

function normalizeKey(k) {
  return (k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function rowToObject(table, row) {
  const obj = {};
  table.cols.forEach((c, i) => {
    const label = c.label || c.id;
    obj[label] = row.c[i]?.v ?? '';
  });
  return obj;
}

function deriveSeries(obj) {
  const entries = Object.keys(obj).map((k) => [normalizeKey(k), k]);
  const pick = (aliases) => {
    const hit = entries.find(([nk]) => aliases.includes(nk));
    return hit ? String(obj[hit[1]] ?? '').trim() : '';
  };

  return {
    id: pick(['seriesid','id']),
    name: pick(['seriescomicname','seriesname','comicname','name','title']),
    era: pick(['era']),
    universe: pick(['universe']),
    branch: pick(['branch']),
    startDate: pick(['startdate']),
    endDate: pick(['enddate']),
    issueStart: pick(['issuestart','issuefrom']),
    issueEnd: pick(['issueend','issueto']),
    coverUrl: pick(['coverurl','cover','imageurl']),
    readUrl: pick(['readurl','readlink']),
    summary: pick(['summarydescription','summary','description']),
    titleHistory: pick(['titlehistoryrenamedinformation','titlehistory','renamedinformation']),
    superheroes: pick(['superheroes','hero','characters']),
    seriesGroupID: pick(['seriesgroupid'])
  };
}

function deriveConnection(obj) {
  const entries = Object.keys(obj).map((k) => [normalizeKey(k), k]);
  const pick = (aliases) => {
    const hit = entries.find(([nk]) => aliases.includes(nk));
    return hit ? String(obj[hit[1]] ?? '').trim() : '';
  };
  return {
    fromID: pick(['fromid']),
    toID: pick(['toid']),
    connectionType: pick(['connectiontype']),
    readingOrder: Number(pick(['readingorder']) || 0)
  };
}

function parseDateValue(v) {
  if (!v) return Number.POSITIVE_INFINITY;
  const d = new Date(v);
  return Number.isNaN(d.valueOf()) ? Number.POSITIVE_INFINITY : d.valueOf();
}

function issueRange(s) {
  const a = s.issueStart || '?';
  const b = s.issueEnd || '?';
  return `#${a} – #${b}`;
}
function dateRange(s) {
  return `${s.startDate || '?'} – ${s.endDate || '?'}`;
}

function buildVisibleTree() {
  const filtered = state.rawSeries.filter((s) => {
    if (state.filters.era && s.era !== state.filters.era) return false;
    if (state.filters.universe && s.universe !== state.filters.universe) return false;
    if (state.filters.hero) {
      const heroes = String(s.superheroes || '').toLowerCase();
      if (!heroes.includes(state.filters.hero.toLowerCase())) return false;
    }
    return true;
  });

  const eras = [...new Set(filtered.map((s) => s.era || 'Unknown Era'))];

  const byEra = new Map();
  eras.forEach((e) => byEra.set(e, []));
  filtered.forEach((s) => byEra.get(s.era || 'Unknown Era').push(s));

  for (const [era, list] of byEra) {
    const groupMap = new Map();
    list.forEach((s) => {
      const key = s.seriesGroupID || `__${s.id}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(s);
    });

    const sorted = [];
    [...groupMap.entries()]
      .map(([k, arr]) => [k, arr.sort((a,b) => parseDateValue(a.startDate) - parseDateValue(b.startDate))])
      .sort((a,b) => parseDateValue(a[1][0]?.startDate) - parseDateValue(b[1][0]?.startDate))
      .forEach(([, arr]) => sorted.push(...arr));

    byEra.set(era, sorted);
  }

  state.root = { eras: byEra, filtered };
}

function renderFilters() {
  const eras = [...new Set(state.rawSeries.map((s) => s.era).filter(Boolean))].sort();
  const universes = [...new Set(state.rawSeries.map((s) => s.universe).filter(Boolean))].sort();
  const heroes = [...new Set(state.rawSeries.flatMap((s) => String(s.superheroes || '').split(',').map(x => x.trim()).filter(Boolean)))].sort();

  const fill = (select, items, first) => {
    select.innerHTML = '';
    const o = document.createElement('option');
    o.value = '';
    o.textContent = first;
    select.appendChild(o);
    items.forEach((v) => {
      const it = document.createElement('option');
      it.value = v;
      it.textContent = v;
      select.appendChild(it);
    });
  };

  fill(el.eraFilter, eras, 'All eras');
  fill(el.universeFilter, universes, 'All universes');
  fill(el.heroFilter, heroes, 'All superheroes');
}

function createSeriesCard(s) {
  const n = document.createElement('article');
  n.className = 'node series-card';
  n.dataset.id = s.id;

  const left = s.coverUrl
    ? `<img class="cover" alt="${s.name} cover" src="${s.coverUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';"/><div class='cover-placeholder' style='display:none'>No Cover</div>`
    : `<div class='cover-placeholder'>No Cover</div>`;

  n.innerHTML = `
    ${left}
    <div>
      <div class="card-title">${s.name || 'Untitled Series'}</div>
      <div class="card-meta">${issueRange(s)}</div>
      <div class="card-meta">${dateRange(s)}</div>
    </div>
  `;

  n.addEventListener('click', () => openModal(s));
  return n;
}

function openModal(s) {
  const rel = state.rawConnections
    .filter((c) => c.fromID === s.id || c.toID === s.id)
    .sort((a,b) => a.readingOrder - b.readingOrder);

  const relList = rel.length
    ? `<ul>${rel.map((r) => `<li>${r.connectionType || 'related'} (${r.fromID} → ${r.toID}) ${r.readingOrder ? `[Order ${r.readingOrder}]` : ''}</li>`).join('')}</ul>`
    : '<p>No explicit cross-series relationship listed.</p>';

  el.modalContent.innerHTML = `
    <div class="modal-grid">
      <div>
        ${s.coverUrl ? `<img class="modal-cover" src="${s.coverUrl}" alt="${s.name} cover"/>` : `<div class='cover-placeholder' style='width:220px;height:320px'>No Cover</div>`}
      </div>
      <div>
        <h2>${s.name || 'Untitled Series'}</h2>
        <div class="detail-row"><span class="detail-label">Issue Range:</span> ${issueRange(s)}</div>
        <div class="detail-row"><span class="detail-label">Publication:</span> ${dateRange(s)}</div>
        <div class="detail-row"><span class="detail-label">Era:</span> ${s.era || '—'}</div>
        <div class="detail-row"><span class="detail-label">Universe:</span> ${s.universe || '—'}</div>
        <div class="detail-row"><span class="detail-label">Branch:</span> ${s.branch || '—'}</div>
        <div class="detail-row"><span class="detail-label">Superheroes:</span> ${s.superheroes || '—'}</div>
        <div class="detail-row"><span class="detail-label">Summary:</span> ${s.summary || '—'}</div>
        <div class="detail-row"><span class="detail-label">Title History / Renamed:</span> ${s.titleHistory || '—'}</div>
        ${s.readUrl ? `<div class="detail-row"><a href="${s.readUrl}" target="_blank" rel="noopener">Read URL</a></div>` : ''}
        <h3>Connections</h3>
        ${relList}
      </div>
    </div>
  `;
  el.modal.showModal();
}

function renderTree() {
  el.nodeLayer.innerHTML = '';
  el.edgeLayer.innerHTML = '';

  const marginX = 60;
  const marginY = 50;
  const eraGap = 100;
  const cardW = 240;
  const cardH = 110;
  const colGap = 24;
  const rowGap = 20;

  const nodePositions = new Map();

  const root = document.createElement('div');
  root.className = 'node root-node';
  root.textContent = 'MARVEL';
  root.style.left = `${marginX}px`;
  root.style.top = `${marginY}px`;
  el.nodeLayer.appendChild(root);
  nodePositions.set('ROOT', { x: marginX, y: marginY, w: 180, h: 48 });

  let xCursor = marginX;
  const eraY = marginY + 110;
  const cardsY = eraY + 70;

  for (const [era, list] of state.root.eras.entries()) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const eraContentW = cols * cardW + (cols - 1) * colGap;
    const eraW = Math.max(220, eraContentW + 20);

    const eraNode = document.createElement('div');
    eraNode.className = 'node era-node';
    eraNode.textContent = era;
    eraNode.style.left = `${xCursor + (eraW - 220)/2}px`;
    eraNode.style.top = `${eraY}px`;
    eraNode.style.width = '220px';
    el.nodeLayer.appendChild(eraNode);

    const eraCenterX = xCursor + eraW / 2;
    nodePositions.set(`ERA:${era}`, { x: eraCenterX - 110, y: eraY, w: 220, h: 44 });

    list.forEach((s, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const x = xCursor + 10 + c * (cardW + colGap);
      const y = cardsY + r * (cardH + rowGap);

      const card = createSeriesCard(s);
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      el.nodeLayer.appendChild(card);
      nodePositions.set(`S:${s.id}`, { x, y, w: cardW, h: cardH, data: s });
    });

    xCursor += eraW + eraGap;
  }

  const maxY = Math.max(...[...nodePositions.values()].map((p) => p.y + p.h), 600);
  const maxX = Math.max(...[...nodePositions.values()].map((p) => p.x + p.w), 1200);

  el.nodeLayer.style.width = `${maxX + 80}px`;
  el.nodeLayer.style.height = `${maxY + 100}px`;
  el.edgeLayer.setAttribute('width', String(maxX + 80));
  el.edgeLayer.setAttribute('height', String(maxY + 100));

  drawEdges(nodePositions);
}

function edgePath(a, b) {
  const x1 = a.x + a.w/2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w/2;
  const y2 = b.y;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${x1} ${y1+40}, ${x2} ${y2-40}, ${x2} ${y2}`;
}

function addArrowDefs() {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="arrowSubtle" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b96ad" />
    </marker>
    <marker id="arrowStrong" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f86ff" />
    </marker>
  `;
  el.edgeLayer.appendChild(defs);
}

function drawEdges(pos) {
  addArrowDefs();

  const root = pos.get('ROOT');
  for (const [k, p] of pos.entries()) {
    if (!k.startsWith('ERA:')) continue;
    const d = edgePath(root, p);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#8b96ad');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('marker-end', 'url(#arrowSubtle)');
    el.edgeLayer.appendChild(path);
  }

  for (const [eraKey, eraPos] of pos.entries()) {
    if (!eraKey.startsWith('ERA:')) continue;
    const era = eraKey.slice(4);
    const list = state.root.eras.get(era) || [];
    list.forEach((s) => {
      const sPos = pos.get(`S:${s.id}`);
      if (!sPos) return;
      const d = edgePath(eraPos, sPos);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#a3aec4');
      path.setAttribute('stroke-width', '1.1');
      path.setAttribute('marker-end', 'url(#arrowSubtle)');
      el.edgeLayer.appendChild(path);
    });
  }

  const visibleIds = new Set(state.root.filtered.map((s) => s.id));
  const conns = state.rawConnections
    .filter((c) => visibleIds.has(c.fromID) && visibleIds.has(c.toID))
    .sort((a,b) => a.readingOrder - b.readingOrder);

  const colorByType = (t) => {
    const key = (t || '').toLowerCase();
    if (key.includes('rename')) return '#b57cff';
    if (key.includes('crossover')) return '#44a8ff';
    if (key.includes('follow')) return '#35c58a';
    return '#4f86ff';
  };

  conns.forEach((c) => {
    const a = pos.get(`S:${c.fromID}`);
    const b = pos.get(`S:${c.toID}`);
    if (!a || !b) return;
    const d = edgePath(a, b);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', colorByType(c.connectionType));
    path.setAttribute('stroke-width', '2');
    path.setAttribute('opacity', '0.95');
    path.setAttribute('marker-end', 'url(#arrowStrong)');
    el.edgeLayer.appendChild(path);
  });
}

function applyTransform() {
  el.surface.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  el.zoomPct.textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(next, cx = 0, cy = 0) {
  const z = Math.min(2.5, Math.max(0.25, next));
  const prev = state.zoom;
  if (z === prev) return;
  const worldX = (cx - state.panX) / prev;
  const worldY = (cy - state.panY) / prev;
  state.zoom = z;
  state.panX = cx - worldX * z;
  state.panY = cy - worldY * z;
  applyTransform();
}

function fitTree() {
  const rect = el.nodeLayer.getBoundingClientRect();
  const vw = el.viewport.clientWidth;
  const vh = el.viewport.clientHeight;
  const pad = 40;
  const sX = (vw - pad*2) / rect.width;
  const sY = (vh - pad*2) / rect.height;
  state.zoom = Math.min(1.4, Math.max(0.25, Math.min(sX, sY)));
  state.panX = (vw - rect.width * state.zoom) / 2;
  state.panY = (vh - rect.height * state.zoom) / 2;
  applyTransform();
}

function bindUI() {
  el.eraFilter.addEventListener('change', () => { state.filters.era = el.eraFilter.value; rebuild(); });
  el.universeFilter.addEventListener('change', () => { state.filters.universe = el.universeFilter.value; rebuild(); });
  el.heroFilter.addEventListener('change', () => { state.filters.hero = el.heroFilter.value; rebuild(); });
  el.resetFilters.addEventListener('click', () => {
    state.filters = { era: '', universe: '', hero: '' };
    el.eraFilter.value = '';
    el.universeFilter.value = '';
    el.heroFilter.value = '';
    rebuild();
  });

  el.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.15, el.viewport.clientWidth - 60, el.viewport.clientHeight - 60));
  el.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.15, el.viewport.clientWidth - 60, el.viewport.clientHeight - 60));
  el.resetView.addEventListener('click', () => { state.zoom = 1; state.panX = 80; state.panY = 80; applyTransform(); });
  el.fitTree.addEventListener('click', fitTree);

  el.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    setZoom(state.zoom * factor, e.clientX, e.clientY - 78);
  }, { passive: false });

  el.viewport.addEventListener('mousedown', (e) => {
    state.drag = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
  });
  window.addEventListener('mousemove', (e) => {
    if (!state.drag) return;
    state.panX = state.drag.panX + (e.clientX - state.drag.x);
    state.panY = state.drag.panY + (e.clientY - state.drag.y);
    applyTransform();
  });
  window.addEventListener('mouseup', () => { state.drag = null; });

  el.closeModal.addEventListener('click', () => el.modal.close());

  el.themeToggle.addEventListener('click', () => {
    const html = document.documentElement;
    const dark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', dark ? 'light' : 'dark');
    el.themeToggle.textContent = dark ? '🌙 Dark' : '☀️ Light';
  });
}

function rebuild() {
  buildVisibleTree();
  renderTree();
  fitTree();
}

async function init() {
  bindUI();
  try {
    const seriesTable = await fetchGvizJson(SERIES_SHEET_ID);
    state.rawSeries = seriesTable.rows.map((r) => deriveSeries(rowToObject(seriesTable, r))).filter((s) => s.id);
    if (!state.rawSeries.length) throw new Error('No series rows found in series sheet.');
  } catch (e) {
    el.error.textContent = `Failed to load series data. ${e.message}`;
    el.error.classList.remove('hidden');
    return;
  }

  try {
    const connTable = await fetchGvizJson(CONNECTION_SHEET_ID);
    state.rawConnections = connTable.rows.map((r) => deriveConnection(rowToObject(connTable, r))).filter((c) => c.fromID && c.toID);
  } catch (e) {
    el.warning.textContent = `Connection sheet could not be loaded. Series tree is still available. (${e.message})`;
    el.warning.classList.remove('hidden');
    state.rawConnections = [];
  }

  renderFilters();
  rebuild();
}

init();
