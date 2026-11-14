/* global icon, api */
'use strict';

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
function fmtSize(b) {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`;
}
function fmtDate(t) { if (!t) return '—'; return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
function timeAgo(t) {
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return 'just now';
  const m = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [2592000, 'month'], [31536000, 'year']];
  for (let i = m.length - 1; i >= 0; i--) if (s >= m[i][0]) { const n = Math.floor(s / m[i][0]); return `${n} ${m[i][1]}${n > 1 ? 's' : ''} ago`; }
  return '';
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function toast(msg, type = 'info', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info')}<div>${msg}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}

// ---------- state ----------
const S = {
  env: null,
  view: 'library',
  items: [],
  scanned: false,
  lib: { section: 'all', query: '', sort: 'name', mode: 'grid', limit: 150 },
  selected: new Set(),
  imgVer: {},
  browse: { tab: 'all', query: '', sort: 'relevance', page: 0, posts: [], total: 0, totalPages: 1, loading: false, error: null },
  tabs: [],
  installedIds: new Set(),
  jobs: new Map(),
  installs: {},
  updates: null,
  drawerId: null,
};

const GROUPS = [
  { id: 'bikes', label: 'Bikes', icon: 'bike' },
  { id: 'tracks', label: 'Tracks', icon: 'track' },
  { id: 'rider', label: 'Rider Gear', icon: 'helmet' },
  { id: 'tyres', label: 'Tyres', icon: 'tyre' },
  { id: 'misc', label: 'Misc', icon: 'box' },
  { id: 'other', label: 'Other folders', icon: 'folder' },
];
const GROUP_ICON = Object.fromEntries(GROUPS.map((g) => [g.id, g.icon]));
const BRAND_COLORS = {
  Honda: ['#e4002b', '#5c0012'], Kawasaki: ['#46b52d', '#0d3d10'], KTM: ['#ff6a00', '#5a2300'], Yamaha: ['#2457d6', '#0a1b52'],
  Suzuki: ['#e8c100', '#5e4a00'], Husqvarna: ['#2a4f96', '#0a1631'], GasGas: ['#d0021b', '#4a000a'], TM: ['#0a68c9', '#00234a'],
  Fantic: ['#c8102e', '#3d0010'], Beta: ['#d22630', '#45090d'], Triumph: ['#3b3f48', '#0d0e11'], Alta: ['#4a4f5c', '#14161b'],
  Stark: ['#5a5f6b', '#14161b'], Sherco: ['#1f5fb8', '#0a1d3d'],
};
const GROUP_COLORS = { tracks: ['#4d6b2f', '#1b2512'], rider: ['#5b3d8f', '#1d1430'], tyres: ['#3f4450', '#121418'], misc: ['#2e5a66', '#0f1d21'], other: ['#4a4f5c', '#14161b'], bikes: ['#3a3f4c', '#14161b'] };

// ---------- images ----------
function itemImage(it) {
  if (!it.hasImage) return null;
  const root = it.disabled ? S.env.disabledDir : S.env.modsDir;
  const p = it.abs ? it.abs : `${root}\\${it.parts[0].replace(/\//g, '\\')}`;
  const q = [`key=${enc(it.key)}`];
  if (it.info && it.info.pic) q.push(`p=${enc(p)}`, `pic=${enc(it.info.pic)}`);
  if (it.post && it.post.image) q.push(`post=${enc(it.post.image)}`);
  q.push(`v=${S.imgVer[it.key] || 0}`);
  return `mxb://item/?${q.join('&')}`;
}

function placeholder(it) {
  const [c1, c2] = (it.brand && BRAND_COLORS[it.brand]) || GROUP_COLORS[it.group] || GROUP_COLORS.other;
  let big = it.brand || '';
  if (!big) {
    const words = it.title.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(Boolean);
    big = words.slice(0, 2).join(' ').slice(0, 16) || it.title.slice(0, 12);
  }
  return `<div class="ph" style="--ph1:${c1};--ph2:${c2}"><div class="ph-icon">${icon(GROUP_ICON[it.group] || 'box')}</div><div class="ph-sub">${esc(it.label)}</div><div class="ph-brand">${esc(big)}</div></div>`;
}

function thumbHtml(it) {
  const src = itemImage(it);
  return `${placeholder(it)}${src ? `<img loading="lazy" decoding="async" src="${esc(src)}" alt="">` : ''}`;
}

document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('loaded'); }, true);
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG' && !e.target.dataset.keep) e.target.remove(); }, true);

// ---------- rail ----------
const VIEWS = [
  { id: 'library', label: 'My Mods', icon: 'library' },
  { id: 'rider', label: 'Rider', icon: 'helmet' },
  { id: 'get', label: 'Get Mods', icon: 'globe' },
  { id: 'packs', label: 'OEM Packs', icon: 'layers' },
  { id: 'online', label: 'Online', icon: 'user' },
  { id: 'graphics', label: 'Graphics', icon: 'sparkle' },
  { id: 'game', label: 'Game', icon: 'play' },
  { id: 'downloads', label: 'Downloads', icon: 'download' },
];
function renderRail() {
  const active = [...S.jobs.values()].filter((j) => !['done', 'error'].includes(j.status)).length;
  const review = [...S.jobs.values()].filter((j) => j.status === 'review' || j.status === 'browser').length;
  const upd = (S.updates && S.updates.length) || 0;
  const packUpd = S.packsNeed || 0;
  const btn = (v, badge) => `<button class="rail-btn ${S.view === v.id ? 'active' : ''}" data-view="${v.id}">${icon(v.icon)}<span>${v.label}</span>${badge ? `<span class="rail-badge">${badge}</span>` : ''}</button>`;
  $('#rail').innerHTML = VIEWS.map((v) => btn(v, v.id === 'downloads' ? (review || active || upd || '') : v.id === 'packs' ? (packUpd || '') : '')).join('')
    + `<div class="rail-spacer"></div>${btn({ id: 'settings', label: 'Settings', icon: 'settings' })}`;
}
$('#rail').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });

function go(view) {
  // old view names still used in a few places
  if (view === 'browse') { S.getSrc = 'free'; view = 'get'; }
  if (view === 'shops') { S.getSrc = S.shop.id; view = 'get'; }
  if (view === 'installed') { S.dlTab = 'updates'; view = 'downloads'; }
  if (view === 'library' && S.lib.scope === 'rider') { S.lib.scope = 'mods'; S.lib.tab = 'bikes'; S.lib.f = {}; S.lib.query = ''; S.selected.clear(); }
  if (view === 'rider' && S.view !== 'rider') S.riderTab = S.riderTab || 'outfit';
  if (view !== 'rider' && S.rider) {
    for (const key of ['viewer', 'bikeViewer']) if (S.rider[key]) { S.rider[key].dispose(); S.rider[key] = null; }
    S.rider.modelKey = null; S.rider.bikeModelKey = null; S.rider.modelOk = false;
  }
  S.view = view;
  closeDrawer();
  renderRail();
  render();
}

function render() {
  const c = $('#content');
  if (!S.env.modsFound && S.view !== 'settings') return renderSetup(c);
  if (S.view === 'library') renderLibrary(c);
  else if (S.view === 'rider') renderRider(c);
  else if (S.view === 'get') renderGet(c);
  else if (S.view === 'packs') renderPacks(c);
  else if (S.view === 'online') renderOnline(c);
  else if (S.view === 'graphics') renderGraphics(c);
  else if (S.view === 'game') renderGame(c);
  else if (S.view === 'downloads') (S.dlTab === 'updates' ? renderInstalled(c) : renderDownloads(c));
  else if (S.view === 'settings') renderSettings(c);
}

function renderSetup(c) {
  c.innerHTML = `<div class="view"><div class="setup">${icon('folder', '').replace('class="ico ', 'style="width:56px;height:56px;color:var(--accent)" class="ico ')}
    <h1>Find your MX Bikes folder</h1>
    <p>Couldn't find the MX Bikes mods folder automatically. It's normally <span class="mono">Documents\\PiBoSo\\MX Bikes</span>. Launch the game once, or pick the folder manually.</p>
    <p class="mono muted">${esc(S.env.settings.gameUserDir)}</p>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:18px"><button class="btn btn-primary" data-act="pick-user">${icon('folder')}Choose folder</button><button class="btn" data-act="redetect">${icon('refresh')}Try again</button></div>
  </div></div>`;
}

// ---------- My Mods (and Rider → My gear, same screen with scope 'rider') ----------
function gearName(i) { return i.sub.split('/').pop(); }
function isOldGear(i) { return i.group === 'rider' && i.sub.startsWith('legacy/'); }
const GEAR_MAIN = ['helmets', 'paints', 'gloves', 'boots', 'boots paints', 'protections', 'goggles', 'riders'];
const LIB_TABS = {
  mods: [
    { id: 'bikes', label: 'Bikes', icon: 'bike', match: (i) => i.group === 'bikes' },
    { id: 'tracks', label: 'Tracks', icon: 'track', match: (i) => i.group === 'tracks' },
    { id: 'other', label: 'Tyres & other', icon: 'tyre', match: (i) => ['tyres', 'misc', 'other'].includes(i.group) },
    { id: 'graphics', label: 'Graphics', icon: 'sparkle', match: () => false },
  ],
  rider: [
    { id: 'bikePaints', label: 'Bike paints', icon: 'paint', match: (i) => i.group === 'bikePaints' },
    { id: 'helmets', label: 'Helmets', icon: 'helmet', match: (i) => gearName(i) === 'helmets' },
    { id: 'paints', label: 'Kits', icon: 'shirt', match: (i) => gearName(i) === 'paints' },
    { id: 'gloves', label: 'Gloves', icon: 'glove', match: (i) => gearName(i) === 'gloves' },
    { id: 'boots', label: 'Boots', icon: 'boot', match: (i) => gearName(i) === 'boots' || gearName(i) === 'boots paints' },
    { id: 'protections', label: 'Protectors', icon: 'shield', match: (i) => gearName(i) === 'protections' },
    { id: 'goggles', label: 'Goggles', icon: 'goggles', match: (i) => gearName(i) === 'goggles' },
    { id: 'riders', label: 'Rider models', icon: 'rider', match: (i) => gearName(i) === 'riders' },
    { id: 'more', label: 'More', icon: 'box', match: (i) => !GEAR_MAIN.includes(gearName(i)) },
  ],
};
S.lib.tab = S.lib.tab || 'bikes';
S.lib.f = {};
S.lib.quick = 'all';

function riderTabsHtml(active) {
  return `<div class="seg-tabs"><button class="${active === 'outfit' ? 'active' : ''}" data-rider-tab="outfit">${icon('rider')}Outfit</button><button class="${active === 'bike' ? 'active' : ''}" data-rider-tab="bike">${icon('bike')}Bike</button><button class="${active === 'gear' ? 'active' : ''}" data-rider-tab="gear">${icon('helmet')}My gear</button></div>`;
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-rider-tab]');
  if (!t) return;
  S.riderTab = t.dataset.riderTab;
  closeDrawer(); S.selected.clear();
  renderRider($('#content'));
});

function libItems() {
  return S.items.filter((i) => (S.lib.scope === 'rider' ? (i.group === 'rider' || i.group === 'bikePaints') && (S.lib.showOld || !isOldGear(i)) : i.group !== 'rider' && i.group !== 'bikePaints'));
}
function currentTab() { const tabs = LIB_TABS[S.lib.scope || 'mods']; return tabs.find((t) => t.id === S.lib.tab) || tabs[0]; }
function tabItems() { return libItems().filter(currentTab().match); }

const FACETS = {
  bikes: [
    { key: 'brand', label: 'Brand', get: (i) => i.brand, fmt: (v) => v },
    { key: 'cc', label: 'Size', get: (i) => i.cc, fmt: (v) => (v === 'Electric' ? '⚡ Electric' : `${v}cc`), order: (a, b) => (a === 'Electric') - (b === 'Electric') || Number(a) - Number(b) },
    { key: 'cls', label: 'Class', get: (i) => i.bikeClass, fmt: (v) => v },
  ],
  tracks: [{ key: 'type', label: 'Type', get: (i) => i.label, fmt: (v) => v }],
};
FACETS.bikePaints = FACETS.bikes;
for (const category of ['helmets', 'paints', 'gloves', 'boots', 'protections', 'goggles', 'riders']) {
  FACETS[category] = [{ key: 'brand', label: 'Brand', get: (i) => gearBrand(`${i.name} ${i.title}`), fmt: (v) => v }];
}

function filterItems() {
  let xs = tabItems();
  const q = S.lib.quick;
  if (q === 'fav') xs = xs.filter((i) => i.favorite);
  else if (q === 'disabled') xs = xs.filter((i) => i.disabled);
  else if (q === 'dups') xs = xs.filter((i) => i.duplicateOf || i.hasDuplicates);
  else if (q === 'app') xs = xs.filter((i) => i.post);
  for (const fc of FACETS[currentTab().id] || []) { const v = S.lib.f[fc.key]; if (v) xs = xs.filter((i) => fc.get(i) === v); }
  if (S.lib.query) {
    const terms = S.lib.query.toLowerCase().split(/\s+/).filter(Boolean);
    xs = xs.filter((i) => {
      const hay = `${i.title} ${i.name} ${i.brand || ''} ${i.cc || ''} ${i.bikeClass || ''} ${i.label} ${(i.info && i.info.author) || ''} ${(i.info && i.info.location) || ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  const cmp = {
    name: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
    newest: (a, b) => b.mtime - a.mtime,
    size: (a, b) => b.size - a.size,
  }[S.lib.sort] || ((a, b) => a.title.localeCompare(b.title));
  return [...xs].sort(cmp);
}

function renderLibrary(c) {
  const scope = S.lib.scope || 'mods';
  if (!LIB_TABS[scope].some((t) => t.id === S.lib.tab)) { S.lib.tab = LIB_TABS[scope][0].id; S.lib.f = {}; }
  if (!$('#libView') || $('#libView').dataset.scope !== scope) {
    c.innerHTML = `<div class="view" id="libView" data-scope="${scope}"><div class="main" style="position:relative">
      <div class="toolbar">${scope === 'rider' ? `<h2>Rider</h2>${riderTabsHtml('gear')}` : '<h2>My Mods</h2>'}<div class="grow"></div>
        <div class="search">${icon('search')}<input id="libSearch" placeholder="Search…  (Ctrl+F)" spellcheck="false"></div>
        <button class="btn btn-icon" data-act="rescan" title="Refresh list">${icon('refresh')}</button>
        <button class="btn btn-primary" data-act="pick-files">${icon('upload')}Add mod from PC</button></div>
      <div class="bigtabs" id="libTabs"></div>
      <div class="filters" id="libFilters"></div>
      <div class="scroller" id="libScroll"></div>
      <div class="bulkbar" id="bulkbar"></div></div></div>`;
    $('#libSearch').addEventListener('input', debounce((e) => { S.lib.query = e.target.value.trim(); S.lib.limit = 150; renderLibItems(); }, 120));
  }
  $('#libSearch').value = S.lib.query;
  renderLibItems();
}

function drawLibTabs() {
  const all = libItems();
  $('#libTabs').innerHTML = LIB_TABS[S.lib.scope || 'mods'].map((t) => {
    const n = t.id === 'graphics' ? (S.gfx ? S.gfx.items.length : '') : all.filter(t.match).length;
    if (!n && t.id === 'more') return '';
    return `<button class="bigtab ${t.id === currentTab().id ? 'active' : ''}" data-libtab="${t.id}">${icon(t.icon)}<span>${t.label}</span><span class="n">${n}</span></button>`;
  }).join('');
}

// Small popover menu (iOS style). options: [{value,label,count?,sep?}]
function openMenu(anchor, options, current, onPick) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = options.map((o) => (o.sep ? '<div class="sep"></div>' : `<button data-mv="${esc(o.value)}">${o.value === current ? icon('check') : '<span style="width:15px"></span>'}<span>${esc(o.label)}</span>${o.count != null ? `<span class="n">${o.count}</span>` : ''}</button>`)).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - m.offsetWidth - 12);
  const top = r.bottom + m.offsetHeight + 8 > window.innerHeight ? Math.max(12, r.top - m.offsetHeight - 6) : r.bottom + 6;
  m.style.left = left + 'px'; m.style.top = top + 'px';
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-mv]'); if (b) { closeMenu(); onPick(b.dataset.mv); } });
  setTimeout(() => document.addEventListener('mousedown', menuOutside), 0);
}
function menuOutside(e) { if (!e.target.closest('.menu')) closeMenu(); }
function closeMenu() { for (const m of $$('.menu')) m.parentNode.removeChild(m); document.removeEventListener('mousedown', menuOutside); }

const QUICK = [['all', 'Everything'], ['fav', 'Favorites'], ['disabled', 'Turned off'], ['dups', 'Duplicates'], ['app', 'Installed with this app']];
const SORTS = [['name', 'Name'], ['newest', 'Newest'], ['size', 'Size']];
const FACET_ALL = { brand: 'All brands', cc: 'All sizes', cls: 'All classes', type: 'All types' };

function drawLibFilters(count) {
  const base = tabItems();
  const pills = [];
  S.lib.facetOpts = {};
  for (const fc of FACETS[currentTab().id] || []) {
    const counts = new Map();
    for (const i of base) { const v = fc.get(i); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
    if (counts.size < 2 && S.lib.scope !== 'rider') continue;
    const vals = [...counts.keys()].sort(fc.order || ((a, b) => counts.get(b) - counts.get(a) || String(a).localeCompare(String(b))));
    S.lib.facetOpts[fc.key] = [{ value: '', label: FACET_ALL[fc.key] || 'All' }, { sep: true }, ...vals.map((v) => ({ value: v, label: fc.fmt(v), count: counts.get(v) }))];
    const cur = S.lib.f[fc.key];
    pills.push(cur
      ? `<button class="pill-btn on" data-fmenu="${fc.key}">${esc(fc.fmt(cur))}<span class="x" data-fclear="${fc.key}">${icon('x')}</span></button>`
      : `<button class="pill-btn" data-fmenu="${fc.key}">${fc.label}${icon('chevdown')}</button>`);
  }
  const quickLabel = (QUICK.find((q) => q[0] === S.lib.quick) || QUICK[0])[1];
  pills.push(`<button class="pill-btn ${S.lib.quick !== 'all' ? 'on' : ''}" data-qmenu>${S.lib.quick === 'all' ? 'Show' : esc(quickLabel)}${icon('chevdown')}</button>`);
  pills.push(`<button class="pill-btn" data-smenu>${icon('list')}${esc((SORTS.find((s) => s[0] === S.lib.sort) || SORTS[0])[1])}</button>`);
  if (S.lib.scope === 'rider' && S.items.some(isOldGear)) pills.push(`<label class="mini-toggle"><input type="checkbox" id="showOld" ${S.lib.showOld ? 'checked' : ''}> Old folders</label>`);
  pills.push(`<span class="count">${count} ${count === 1 ? 'item' : 'items'}</span>`);
  $('#libFilters').innerHTML = pills.join('');
  const so = $('#showOld'); if (so) so.addEventListener('change', (e) => { S.lib.showOld = e.target.checked; renderLibItems(); });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-libtab]');
  if (t) { S.lib.tab = t.dataset.libtab; S.lib.f = {}; S.lib.quick = 'all'; S.lib.limit = 150; S.selected.clear(); renderLibItems(); $('#libScroll').scrollTop = 0; return; }
  const clr = e.target.closest('[data-fclear]');
  if (clr) { e.stopPropagation(); S.lib.f[clr.dataset.fclear] = null; renderLibItems(); return; }
  const fm = e.target.closest('[data-fmenu]');
  if (fm) { const k = fm.dataset.fmenu; openMenu(fm, S.lib.facetOpts[k], S.lib.f[k] || '', (v) => { S.lib.f[k] = v || null; S.lib.limit = 150; renderLibItems(); }); return; }
  const qm = e.target.closest('[data-qmenu]');
  if (qm) {
    const base = tabItems();
    const n = { fav: base.filter((i) => i.favorite).length, disabled: base.filter((i) => i.disabled).length, dups: base.filter((i) => i.duplicateOf).length, app: base.filter((i) => i.post).length };
    openMenu(qm, QUICK.map(([v, l]) => ({ value: v, label: l, count: n[v] })), S.lib.quick, (v) => { S.lib.quick = v; renderLibItems(); });
    return;
  }
  const sm = e.target.closest('[data-smenu]');
  if (sm) openMenu(sm, SORTS.map(([v, l]) => ({ value: v, label: `Sort by ${l.toLowerCase()}` })), S.lib.sort, (v) => { S.lib.sort = v; renderLibItems(); });
});
function cardMeta(it) {
  const bits = [];
  if (it.group === 'bikePaints') return [esc(it.bikeTitle || bikeTitle(it.bike)), it.cc && `${esc(it.cc)}cc`].filter(Boolean).join('<span class="dot"></span>');
  if (it.group === 'bikes') { if (it.cc) bits.push(it.cc === 'Electric' ? 'Electric' : `${it.cc}cc`); if (it.bikeClass) bits.push(it.bikeClass); if (it.paints) bits.push(`${it.paints} paint${it.paints > 1 ? 's' : ''}`); }
  else if (it.group === 'tracks') bits.push(esc((it.info && it.info.author) || it.label));
  else { bits.push(esc(it.label.replace(' · old layout', ''))); if (it.paints) bits.push(`${it.paints} paints`); }
  return bits.join('<span class="dot"></span>');
}

function badgesHtml(it) {
  const b = [];
  if (it.disabled) b.push(`<span class="badge danger">${icon('power')}Off</span>`);
  if (it.duplicateOf) b.push(`<span class="badge warn">${icon('dup')}Duplicate</span>`);
  if (it.kind === 'archive') b.push(`<span class="badge warn">${icon('box')}Needs installing</span>`);
  if (isOldGear(it)) b.push('<span class="badge">Old folder</span>');
  if (it.stock) b.push('<span class="badge info">Built-in</span>');
  return b.join('');
}

function cardHtml(it) {
  const sel = S.selected.has(it.id);
  return `<div class="card ${sel ? 'selected' : ''} ${it.disabled ? 'is-disabled' : ''}" data-item="${esc(it.id)}">
    <div class="thumb">${thumbHtml(it)}<div class="badges">${badgesHtml(it)}</div>${it.favorite ? `<div class="fav-star">${icon('star')}</div>` : ''}
      <div class="card-check" data-check>${icon('check')}</div></div>
    <div class="card-body"><div class="card-title" title="${esc(it.title)}">${esc(it.title)}</div><div class="card-meta">${cardMeta(it)}</div></div></div>`;
}

let libObserver = null;
function renderLibItems() {
  if (!$('#libScroll')) return;
  if (currentTab().id === 'graphics') {
    // Graphics mods live in the game folder, not mods/ — shown as their own list
    drawLibTabs(); $('#libFilters').innerHTML = ''; renderBulk();
    renderGraphicsInto($('#libScroll'));
    return;
  }
  const xs = filterItems();
  drawLibTabs();
  drawLibFilters(xs.length);
  const sc = $('#libScroll');
  if (!S.scanned) { sc.innerHTML = `<div class="grid">${Array.from({ length: 12 }, () => '<div class="card"><div class="thumb skeleton"></div><div class="card-body"><div class="skeleton" style="height:12px;border-radius:4px;width:70%"></div></div></div>').join('')}</div>`; return; }
  if (!xs.length) {
    const filtered = S.lib.query || S.lib.quick !== 'all' || Object.values(S.lib.f).some(Boolean);
    sc.innerHTML = `<div class="empty"><div>${icon(filtered ? 'search' : 'box')}<h3>${filtered ? 'No matches' : 'Nothing here yet'}</h3><div>${filtered ? 'Try clearing a filter.' : 'Get some from <b>Get Mods</b>, or add a file from your PC.'}</div></div></div>`;
    renderBulk(); return;
  }
  const extra = [];
  if (S.lib.quick === 'dups') extra.push(`<div class="notice warn">${icon('dup')}<div>These were downloaded twice (names ending in “(1)”). The ones marked Duplicate are identical copies — safe to delete. <button class="btn btn-sm" style="margin-left:6px" data-act="select-dupes">Select all identical copies</button></div></div>`);
  const shown = xs.slice(0, S.lib.limit);
  sc.innerHTML = extra.join('') + `<div class="grid">${shown.map(cardHtml).join('')}</div>` + (xs.length > S.lib.limit ? `<div class="loadmore" id="libMore"><div class="spinner"></div></div>` : '');
  sc.classList.toggle('selecting', S.selected.size > 0);
  if (libObserver) libObserver.disconnect();
  const more = $('#libMore');
  if (more) {
    libObserver = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) { S.lib.limit += 150; const top = sc.scrollTop; renderLibItems(); sc.scrollTop = top; }
    }, { root: sc, rootMargin: '600px' });
    libObserver.observe(more);
  }
  renderBulk();
}


function renderBulk() {
  const bar = $('#bulkbar');
  if (!bar) return;
  const n = S.selected.size;
  bar.classList.toggle('show', n > 0);
  if (!n) return;
  const sel = S.items.filter((i) => S.selected.has(i.id));
  const anyEnabled = sel.some((i) => !i.disabled), anyDisabled = sel.some((i) => i.disabled);
  bar.innerHTML = `<span class="n">${n} selected</span>
    ${anyEnabled ? `<button class="btn btn-sm" data-act="bulk-disable">${icon('power')}Disable</button>` : ''}
    ${anyDisabled ? `<button class="btn btn-sm" data-act="bulk-enable">${icon('power')}Enable</button>` : ''}
    <button class="btn btn-sm btn-danger" data-act="bulk-delete">${icon('trash')}Delete</button>
    <button class="btn btn-sm btn-ghost" data-act="bulk-all">Select all in view</button>
    <button class="btn btn-sm btn-ghost btn-icon" data-act="bulk-clear" title="Clear selection">${icon('x')}</button>`;
}

function toggleSelect(id) {
  S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
  const el = $(`[data-item="${CSS.escape(id)}"]`);
  if (el) el.classList.toggle('selected', S.selected.has(id));
  $('#libScroll').classList.toggle('selecting', S.selected.size > 0);
  renderBulk();
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-item]');
  if (!card || !card.closest('#libScroll')) return;
  const id = card.dataset.item;
  const clickedItem = S.items.find((i) => i.id === id);
  if (clickedItem && clickedItem.stock) { openItem(id); return; } // built-in tracks can't be selected for bulk actions
  if (e.target.closest('[data-check]') || e.ctrlKey || e.shiftKey || S.selected.size > 0) toggleSelect(id);
  else openItem(id);
});

async function rescan(quiet) {
  const r = await api.invoke('library:scan');
  S.items = r.items;
  S.scanned = true;
  buildNameIndex();
  for (const id of [...S.selected]) if (!S.items.some((i) => i.id === id)) S.selected.delete(id);
  if (S.view === 'library' || (S.view === 'rider' && S.riderTab === 'gear')) renderLibrary($('#content'));
  if (S.drawerId) {
    const cur = S.items.find((i) => i.id === S.drawerId) || S.items.find((i) => i.key === (S.drawerKey || ''));
    if (cur) openItem(cur.id, true); else closeDrawer();
  }
  if (!quiet) toast(`Scanned ${r.items.length} mods in ${r.ms} ms`, 'ok', 2200);
}

// ---------- item drawer ----------
function closeDrawer() {
  if (S.drawerViewer) { S.drawerViewer.dispose(); S.drawerViewer = null; }
  $('#drawer').classList.remove('show');
  $('#drawerScrim').classList.remove('show');
  S.drawerId = null;
}
$('#drawerScrim').addEventListener('click', closeDrawer);

async function openItem(id, keepScroll) {
  if (S.drawerViewer) { S.drawerViewer.dispose(); S.drawerViewer = null; }
  const it = S.items.find((i) => i.id === id);
  if (!it) return;
  S.drawerId = id; S.drawerKey = it.key;
  const d = $('#drawer');
  const scroll = keepScroll && $('.drawer-body', d) ? $('.drawer-body', d).scrollTop : 0;
  const info = it.info || {};
  const kv = [];
  kv.push(['Type', esc(it.label) + (it.kind === 'pkz' ? ' · packed (.pkz)' : it.kind === 'folder' ? ' · folder' : it.kind === 'pnt' ? ' · paint' : it.kind === 'archive' ? ' · archive (not extracted)' : '')]);
  if (info.author) kv.push(['Author', esc(info.author)]);
  if (info.location) kv.push(['Location', esc(info.location)]);
  if (info.layouts) kv.push(['Layouts', String(info.layouts)]);
  if (it.paints) kv.push(['Paints', String(it.paints)]);
  if (it.goggles) kv.push(['Goggle paints', String(it.goggles)]);
  kv.push(['Size', fmtSize(it.size)]);
  kv.push(['Added', `${fmtDate(it.mtime)} <span class="muted">(${timeAgo(it.mtime)})</span>`]);
  if (info.encrypted) kv.push(['Protection', 'Protected by its creator — works normally in game']);
  kv.push(['Files', it.parts.map((p) => `<code>${esc(p)}</code>`).join('<br>')]);
  if (it.post) kv.push(['Source', `<a href="#" data-open="${esc(it.post.link)}">${esc(it.post.title)}</a> <span class="muted">· installed ${timeAgo(it.post.installedAt)}</span>`]);

  const notices = [];
  if (it.duplicateOf) notices.push(`<div class="notice warn">${icon('dup')}<div>${it.duplicateExact ? 'Exact duplicate' : 'Same name as'} <span class="mono">${esc(it.duplicateOf)}</span>${it.duplicateExact ? ' — safe to delete.' : ' but a different size; may be a different version.'}</div></div>`);
  if (it.kind === 'archive') notices.push(`<div class="notice warn">${icon('box')}<div>This is a compressed archive sitting in your mods folder — the game can't read it. Install it to unpack it into the right place.<div style="margin-top:8px"><button class="btn btn-sm btn-primary" data-act="install-local">${icon('download')}Install this archive</button></div></div></div>`);
  if (it.disabled) notices.push(`<div class="notice danger">${icon('power')}<div>Disabled — moved out of the mods folder so the game won't load it. Enable to restore it.</div></div>`);
  if (it.group === 'tracks' && it.sub === '(loose)') notices.push(`<div class="notice warn">${icon('alert')}<div>This track is directly in <span class="mono">tracks/</span>. MX Bikes only loads tracks from a type folder like <span class="mono">tracks/motocross</span>.</div></div>`);

  const src = itemImage(it);
  const modelPreview = ['bikes', 'bikePaints'].includes(it.group) || (it.group === 'rider' && it.sub === 'riders');
  d.innerHTML = `<div class="drawer-hero ${modelPreview ? 'drawer-bike-hero' : ''}">${modelPreview ? '<div id="drawerBikeModel" class="drawer-bike-model"><div class="spinner"></div></div>' : placeholder(it) + (src ? `<img src="${esc(src)}" alt="">` : '')}<button class="btn btn-icon close" data-act="close-drawer">${icon('x')}</button></div>
    <div class="drawer-body">
      <h2>${esc(it.title)}</h2>
      <div class="subtitle">${badgesHtml(it)}<span class="mono">${esc(it.name)}</span></div>
      ${notices.join('')}
      <div class="actions">
        ${it.stock ? `<span class="have">${icon('check')}Comes with MX Bikes</span>` : `
        ${it.disabled ? `<button class="btn btn-primary" data-act="enable">${icon('power')}Enable</button>` : `<button class="btn" data-act="disable">${icon('power')}Disable</button>`}
        <button class="btn ${it.favorite ? 'btn-primary' : ''}" data-act="fav">${icon('star')}${it.favorite ? 'Favorited' : 'Favorite'}</button>
        <button class="btn" data-act="reveal">${icon('folder')}Show in folder</button>
        <button class="btn btn-danger" data-act="delete">${icon('trash')}Delete</button>`}
      </div>
      ${it.stock && it.info && it.info.layoutNames && it.info.layoutNames.length ? `<div class="muted" style="font-size:13px;margin:-8px 4px 14px">Layouts: ${esc([it.title, ...it.info.layoutNames].join(' · '))}</div>` : ''}
      <div class="section-title">Image</div>
      <div class="actions">
        <button class="btn btn-sm" data-act="find-image">${icon('search')}Find image</button>
        <button class="btn btn-sm" data-act="pick-image">${icon('upload')}Choose file…</button>
        ${it.customImage ? `<button class="btn btn-sm btn-ghost" data-act="clear-image">${icon('x')}Reset</button>` : ''}
      </div>
      <div class="section-title">Details</div>
      <div class="kv">${kv.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div>
      <div id="paintsBox"></div>
    </div>`;
  d.classList.add('show');
  $('#drawerScrim').classList.add('show');
  $('.drawer-body', d).scrollTop = scroll;
  if (it.paints || it.goggles) loadPaints(it);
  if (modelPreview) {
    const attach = async () => {
      if (S.drawerId !== id || !$('#drawerBikeModel')) return;
      try {
        const model = it.group === 'rider' ? await api.invoke('rider:previewModel', it.name)
          : await api.invoke('bike:model', null, it.bike || it.name, it.group === 'bikePaints' ? it.name : null);
        if (S.drawerId !== id || !$('#drawerBikeModel')) return;
        const stage = $('#drawerBikeModel'); stage.innerHTML = '';
        S.drawerViewer = window.RiderViewer.create(stage); S.drawerViewer.load(model);
      } catch (e) { if (S.drawerId === id && $('#drawerBikeModel')) $('#drawerBikeModel').innerHTML = `<div class="stage-err">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`; }
    };
    if (window.RiderViewer) attach(); else window.addEventListener('riderviewer-ready', attach, { once: true });
  }
}

async function loadPaints(it) {
  const list = await api.invoke('library:paints', it.id);
  const box = $('#paintsBox');
  if (!box || S.drawerId !== it.id) return;
  box.innerHTML = `<div class="section-title">${icon('paint')}Paints <span class="muted">(${list.length})</span><span class="grow"></span>
      <div class="search" style="margin:0"><input id="paintFilter" placeholder="Filter paints…" style="width:170px;height:28px;padding-left:10px"></div></div>
    <div class="paint-list" id="paintList">${list.map((p) => `<div class="paint" data-name="${esc(p.name.toLowerCase())}">${icon('paint')}<span class="n" title="${esc(p.name)}">${esc(p.name)}</span>${p.sub === 'goggles' ? '<span class="tag">goggles</span>' : ''}<span class="s">${fmtSize(p.size)}</span>
      <button class="btn btn-sm btn-ghost btn-icon" data-act="paint-show" data-path="${esc(p.path)}" title="Show in folder">${icon('folder')}</button>
      <button class="btn btn-sm btn-ghost btn-icon btn-danger" data-act="paint-delete" data-path="${esc(p.path)}" title="Delete paint">${icon('trash')}</button></div>`).join('')}</div>`;
  $('#paintFilter').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('#paintList .paint').forEach((r) => { r.style.display = r.dataset.name.includes(q) ? '' : 'none'; });
  });
}

// ---------- modals ----------
function modal({ title, body, foot = '', size = '', onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${size}"><div class="modal-head"><h3>${title}</h3><button class="btn btn-ghost btn-icon" data-close>${icon('x')}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { wrap.remove(); onClose && onClose(); };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  $('#modalRoot').appendChild(wrap);
  wrap.close = close;
  return wrap;
}

function confirmBox(title, html, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: esc(title), size: 'sm', body: `<div style="color:var(--text-2)">${html}</div>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okLabel)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    $('[data-ok]', m).addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}

// ---------- image picker ----------
function cleanQuery(it) {
  let q = (it.info && it.info.name) || it.title;
  q = q.replace(/\(\d+\)/g, '').replace(/\b(pkz|mx[12]|oem|factory|v\d+(\.\d+)*)\b/gi, ' ').replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return q;
}

function openImagePicker(it) {
  const tab = it.group === 'tracks' ? 'tracks' : it.group === 'bikes' ? 'all' : 'all';
  const m = modal({
    title: `Choose an image — ${esc(it.title)}`, size: 'md',
    body: `<div class="toolbar" style="padding:0 0 14px"><div class="search wide">${icon('search')}<input id="pickQ" value="${esc(cleanQuery(it))}"></div><select id="imageSource"><option value="all">All sources</option><option value="free">mxb-mods</option><option value="mxbs">MX Bikes Shop</option><option value="hub">MXB Hub</option></select><button class="btn" id="imageSearch">Search</button></div><div id="pickRes"><div class="loadmore"><div class="spinner"></div></div></div>`,
  });
  const run = async () => {
    const box = $('#pickRes', m);
    box.innerHTML = '<div class="loadmore"><div class="spinner"></div></div>';
    try {
      const r = await api.invoke('library:imageCandidates', { query: $('#pickQ', m).value, tab, source: $('#imageSource', m).value });
      const posts = r.posts.filter((p) => p.image);
      box.innerHTML = posts.length ? `<div class="pick-grid">${posts.map((p) => `<div class="pick" data-img="${esc(p.image)}"><img src="${esc(p.image)}" alt=""><div>${esc(p.title)}<small class="muted"> · ${esc(p.source || 'mxb-mods')}</small></div></div>`).join('')}</div>`
        : `<div class="empty"><div>${icon('image')}<h3>No results</h3><div>Try fewer words.</div></div></div>`;
    } catch (e) { box.innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
  };
  $('#pickQ', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  $('#imageSource', m).addEventListener('change', run);
  $('#imageSearch', m).addEventListener('click', run);
  $('#pickRes', m).addEventListener('click', async (e) => {
    const p = e.target.closest('[data-img]');
    if (!p) return;
    await api.invoke('library:setImageUrl', it.key, p.dataset.img);
    S.imgVer[it.key] = Date.now();
    m.close();
    toast('Image updated', 'ok', 1800);
    await rescan(true);
  });
  run();
}

// Background: fetch a picture for every bike/track with none, once per mod (remembered per PC).
let bgImagesRunning = false;
async function backgroundImages() {
  if (bgImagesRunning || S.env.settings.autoImages === false) return;
  let tried;
  try { tried = JSON.parse(localStorage.getItem('imgTriedRanked3') || '{}'); } catch { tried = {}; }
  const gearModel = (i) => i.group === 'rider' && !i.sub.startsWith('legacy/') && /(helmets|boots|protections)$/.test(i.sub) && i.kind !== 'pnt';
  const todo = S.items.filter((i) => !i.hasImage && !i.disabled && (i.group === 'bikes' || i.group === 'tracks' || gearModel(i)) && Date.now() - (tried[i.key] || 0) > 6 * 60 * 60 * 1000);
  if (!todo.length) return;
  bgImagesRunning = true;
  let found = 0;
  for (const it of todo) {
    try {
      const tab = it.group === 'tracks' ? 'tracks' : /helmets$/.test(it.sub) ? 'helmets' : /boots$/.test(it.sub) ? 'boots' : /protections$/.test(it.sub) ? 'protection' : 'all';
      const r = await api.invoke('library:imageCandidates', { query: cleanQuery(it), tab, source: it.group === 'tracks' ? 'all' : 'free' });
      const p = r.posts.find((p) => p.image && p.matchReliable);
      if (p) {
        await api.invoke('library:setImageUrl', it.key, p.image);
        it.hasImage = true; it.customImage = true; S.imgVer[it.key] = Date.now(); found++;
        // update the visible card in place
        const card = document.querySelector(`[data-item="${CSS.escape(it.id)}"] .thumb`);
        if (card) card.innerHTML = thumbHtml(it) + (card.querySelector('.badges') ? card.querySelector('.badges').outerHTML : '');
      }
      tried[it.key] = Date.now();
    } catch { /* A failed request is retried on the next scan or launch. */ }
    try { localStorage.setItem('imgTriedRanked3', JSON.stringify(tried)); } catch {}
  }
  bgImagesRunning = false;
  if (found) toast(`Added pictures for ${found} mod${found > 1 ? 's' : ''}`, 'ok', 3000);
}

async function autoFindImages() {
  const xs = filterItems().filter((i) => !i.hasImage && (i.group === 'tracks' || i.group === 'bikes') && !i.disabled);
  if (!xs.length) return;
  const ok = await confirmBox('Find images online', `Search mxb-mods, MX Bikes Shop, and MXB Hub for <b>${xs.length}</b> mod${xs.length > 1 ? 's' : ''} without an image. Matches use the name, year, round, and variant. You can choose another image from any mod's details.`, 'Find images');
  if (!ok) return;
  let found = 0;
  toast(`Searching images for ${xs.length} mods…`, 'info', 2500);
  for (const it of xs) {
    try {
      const r = await api.invoke('library:imageCandidates', { query: cleanQuery(it), tab: it.group === 'tracks' ? 'tracks' : 'all', source: 'all' });
      const p = r.posts.find((x) => x.image && x.matchReliable);
      if (p) { await api.invoke('library:setImageUrl', it.key, p.image); S.imgVer[it.key] = Date.now(); found++; }
    } catch { /* keep going */ }
  }
  toast(`Found images for ${found} of ${xs.length}`, 'ok');
  rescan(true);
}

// ---------- browse ----------
const AUTO_HOSTS = /^(mxb-mods\.com|drive\.google\.com|docs\.google\.com|mediafire\.com|mega\.nz|dropbox\.com)$/;
function hostMode(d) {
  if (/\/folder\/|#F!|\/drive\/folders\/|\/scl\/fo\//.test(d.url)) return 'browser';
  if (AUTO_HOSTS.test(d.host)) return 'auto';
  if (/\.(pkz|zip|rar|7z|pnt)(\?|$)/i.test(d.url)) return 'auto';
  return 'browser';
}

// ---------- Get Mods: free (mxb-mods.com) + both shops behind one switch ----------
S.getSrc = 'free';
function isFree() { return (S.view === 'get' && S.getSrc === 'free') || (S.view === 'graphics' && S.gfxTab === 'get'); }
function isShop() { return S.view === 'get' && S.getSrc !== 'free'; }
function renderGet(c) {
  const src = (id, ic, label) => `<button class="${S.getSrc === id ? 'active' : ''}" data-src="${id}">${icon(ic)}${label}</button>`;
  c.innerHTML = `<div class="view col"><div class="srcbar"><h2>Get Mods</h2><div class="seg-tabs">${src('free', 'globe', 'Free mods')}${src('hub', 'cart', 'MXB Hub')}${src('mxbs', 'cart', 'MX Bikes Shop')}</div></div><div class="view" id="getBody"></div></div>`;
  const body = $('#getBody');
  if (S.getSrc === 'free') { renderBrowse(body); return; }
  if (S.shop.id !== S.getSrc) { S.shop.id = S.getSrc; S.shop.cat = 0; S.shop.sort = 'date'; S.shop.query = ''; S.shop.products = []; S.shop.page = 0; S.shop.totalPages = 1; S.shop.total = 0; S.shop.req++; S.shop.loading = false; }
  renderShops(body);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-src]');
  if (b && S.view === 'get') { S.getSrc = b.dataset.src; renderGet($('#content')); }
});

// ---------- OEM packs ----------
S.packs = null;
async function renderPacks(c, force) {
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>OEM Packs</h2><div class="grow"></div><button class="btn" data-act="packs-refresh">${icon('refresh')}Check again</button></div>
    <div class="scroller"><p class="muted" style="margin:-4px 0 18px;max-width:640px">The official bike packs most servers use. The app compares each pack with your bikes and only downloads what's missing or changed — not the whole pack.</p>
    <div class="packs" id="packList">${[1, 2, 3, 4].map(() => '<div class="pack"><div class="pack-img skeleton"></div><div class="pack-body"><div class="skeleton" style="height:16px;width:50%;border-radius:6px"></div><div class="skeleton" style="height:10px;width:80%;border-radius:6px"></div></div></div>').join('')}</div></div></div></div>`;
  try { if (!S.packs || force) S.packs = await api.invoke('packs:list', !!force); }
  catch (e) { $('#packList').innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`; return; }
  S.packsNeed = S.packs.filter((p) => p.summary && p.summary.needCount && p.summary.have).length;
  renderRail();
  if (S.view !== 'packs') return;
  $('#packList').innerHTML = S.packs.map(packCard).join('');
}

function packCard(p) {
  const s = p.summary;
  let state, foot;
  const busy = [...S.jobs.values()].some((j) => j.packId === p.id && !['done', 'error'].includes(j.status));
  if ((p.error || !s) && p.downloadUrl && p.post) {
    // Host can't serve parts of the file: offer the full pack (identical files are skipped on install).
    state = `<div class="pack-state" style="color:var(--muted)">${icon('info')}Can't compare this one ahead of time — the full pack downloads, and files you already have are skipped.</div>`;
    foot = `<button class="btn btn-primary" data-pack-full="${p.id}" ${busy ? 'disabled' : ''}>${icon('download')}${busy ? 'Downloading…' : 'Download pack'}</button><button class="btn btn-ghost" data-open="${esc(p.post.link)}">Page</button>`;
  } else if (p.error || !s) {
    state = `<div class="pack-state" style="color:var(--muted)">${icon('info')}${esc(p.error || p.listError || "Couldn't read this pack's file list")}</div>`;
    foot = p.post ? `<button class="btn" data-open="${esc(p.post.link)}">${icon('external')}Open page</button>` : '';
  } else if (!s.needCount) {
    state = `<div class="pack-state ok">${icon('check')}Up to date · all ${s.total} files</div>`;
    foot = `<span class="have">${icon('check')}Installed</span><button class="btn btn-ghost" data-pack-detail="${p.id}">What's inside</button>`;
  } else {
    const fresh = !s.have;
    state = `<div class="pack-state need">${icon(fresh ? 'download' : 'refresh')}${fresh ? 'Not installed' : `${s.needCount} file${s.needCount > 1 ? 's' : ''} to update`} · ${fmtSize(s.needBytes)}</div>`;
    foot = `<button class="btn btn-primary" data-pack-update="${p.id}" ${busy ? 'disabled' : ''}>${icon('download')}${busy ? 'Downloading…' : fresh ? `Install · ${fmtSize(s.needBytes)}` : `Update · ${fmtSize(s.needBytes)}`}</button><button class="btn btn-ghost" data-pack-detail="${p.id}">What's inside</button>`;
  }
  const pct = s && s.total ? Math.round((s.have / s.total) * 100) : 0;
  return `<div class="pack"><div class="pack-img">${p.post && p.post.image ? `<img src="${esc(p.post.image)}" alt="">` : ''}</div>
    <div class="pack-body"><div><div class="pack-title">${esc(p.name)}</div><div class="pack-ver">${p.version ? 'Version ' + esc(p.version) : ''}${s ? ` · ${s.have} of ${s.total} files` : ''}</div></div>
      <div class="muted" style="font-size:13px">${esc(p.blurb || '')}</div>
      ${s ? `<div class="pack-bar"><div style="width:${pct}%"></div></div>` : ''}
      ${state}<div class="pack-foot">${foot}</div></div></div>`;
}

async function openPackDetail(id) {
  const m = modal({ title: 'Pack contents', size: 'md', body: '<div class="loadmore"><div class="spinner"></div></div>' });
  let d;
  try { d = await api.invoke('packs:detail', id); } catch (e) { $('.modal-body', m).innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`; return; }
  const c = d.compare;
  $('.modal-head h3', m).textContent = `${d.name}${d.version ? ' v' + d.version : ''}`;
  if (!c) { $('.modal-body', m).innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(d.listError || "Couldn't read this pack's file list.")}</div></div>`; return; }
  const label = { ok: '<span class="pill new">Installed</span>', missing: '<span class="pill unresolved">Missing</span>', changed: '<span class="pill overwrite">Update</span>' };
  const rows = [...c.rows].sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || a.name.localeCompare(b.name, undefined, { numeric: true }));
  $('.modal-body', m).innerHTML = `${c.needCount ? `<div class="notice info">${icon('download')}<div>${c.needCount} file${c.needCount > 1 ? 's' : ''} to download (${fmtSize(c.needBytes)}) instead of the full ${fmtSize(c.packBytes)} pack.</div></div>` : `<div class="notice ok">${icon('check')}<div>You have everything in this pack.</div></div>`}
    <div class="pack-list">${rows.map((r) => `<div class="pack-row"><span class="t">${esc(prettifyBike(r.name))}</span><span class="s">${fmtSize(r.size)}</span>${label[r.status]}</div>`).join('')}</div>
    ${c.old.length ? `<div class="section-title">Older OEM bikes you have</div><div class="muted" style="font-size:13px;margin:0 4px 8px">Not part of the current pack (renamed or retired models). Servers using this pack won't use them.</div><div class="pack-list">${c.old.map((n) => `<div class="pack-row"><span class="t">${esc(prettifyBike(n))}</span><span class="pill skip">Old</span></div>`).join('')}</div>` : ''}`;
}

function prettifyBike(n) {
  const m = n.match(/^(MX\w*?|SM\w*?|EN\w*?)OEM_(\d{4}|Service)_(.+)$/i);
  return m ? `${m[2]} ${m[3].replace(/_/g, ' ')}  ·  ${m[1].toUpperCase()}` : n.replace(/_/g, ' ');
}

document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-pack-detail]');
  if (d) { openPackDetail(d.dataset.packDetail); return; }
  const full = e.target.closest('[data-pack-full]');
  if (full) {
    const p = S.packs.find((x) => x.id === full.dataset.packFull);
    full.disabled = true; full.innerHTML = `${icon('download')}Downloading… see Downloads`;
    await api.invoke('jobs:start', { title: `${p.name} pack${p.version ? ' v' + p.version : ''}`, postId: p.post.id, url: p.downloadUrl, image: p.post.image, link: p.post.link, modified: p.post.modified, categories: p.post.categories });
    return;
  }
  const u = e.target.closest('[data-pack-update]');
  if (u) {
    u.disabled = true; u.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>Starting…';
    try {
      const jid = await api.invoke('packs:update', u.dataset.packUpdate);
      if (jid) { const j = S.jobs.get(jid); if (j) j.packId = u.dataset.packUpdate; S.packJob = S.packJob || {}; S.packJob[jid] = u.dataset.packUpdate; toast('Downloading only the files you need…', 'info', 2500); }
      else toast('Already up to date', 'ok', 1800);
    } catch (err) { toast(esc(cleanErr(err)), 'err', 5000); }
    if (S.view === 'packs') { const p = S.packs.find((x) => x.id === u.dataset.packUpdate); u.outerHTML = `<button class="btn btn-primary" disabled>${icon('download')}Downloading… see Downloads</button>`; }
  }
});

function dlTabs(active) {
  const n = (S.updates && S.updates.length) || 0;
  return `<div class="seg-tabs"><button class="${active === 'downloads' ? 'active' : ''}" data-dltab="downloads">${icon('download')}Downloads</button><button class="${active === 'updates' ? 'active' : ''}" data-dltab="updates">${icon('refresh')}Updates${n ? ` (${n})` : ''}</button></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-dltab]');
  if (b) { S.dlTab = b.dataset.dltab; render(); }
});

function renderBrowse(c) {
  if (!$('#browseView')) {
    c.innerHTML = `<div class="view" id="browseView"><div class="main">
      <div class="toolbar" style="padding-top:10px">
        <div class="search wide">${icon('search')}<input id="brSearch" placeholder="Search mxb-mods.com — bikes, tracks, gear…" spellcheck="false"></div>
        <select id="brSort"><option value="relevance">Best match</option><option value="popular-week">🔥 Popular this week</option><option value="popular-month">🔥 Popular this month</option><option value="popular-today">🔥 Popular today</option><option value="popular-all">🔥 Popular all time</option><option value="date">Newest</option><option value="modified">Recently updated</option><option value="title">Title A–Z</option></select>
        <span class="sub" id="brCount"></span><div class="grow"></div>
        <button class="btn btn-icon" data-act="open-site" title="Open mxb-mods.com">${icon('external')}</button>
      </div>
      <div class="chips" id="brTabs"></div>
      <div class="scroller" id="brScroll"></div>
    </div></div>`;
    $('#brSearch').value = S.browse.query;
    $('#brSearch').addEventListener('input', debounce((e) => {
      S.browse.query = e.target.value.trim();
      if (S.browse.query && (S.browse.sort === 'date' || S.browse.sort.startsWith('popular'))) { S.browse.sort = 'relevance'; $('#brSort').value = 'relevance'; }
      browseReset();
    }, 380));
    $('#brSort').addEventListener('change', (e) => { S.browse.sort = e.target.value; browseReset(); });
    $('#brTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { S.browse.tab = b.dataset.tab; browseReset(); } });
  }
  $('#brSort').value = S.browse.sort;
  $('#brTabs').innerHTML = S.tabs.map((t) => `<button class="chip ${S.browse.tab === t.id ? 'active' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('');
  if (!S.browse.posts.length && !S.browse.loading) browseLoad(); else renderBrowseGrid();
}

function browseReset() {
  S.browse.page = 0; S.browse.posts = []; S.browse.totalPages = 1; S.browse.error = null;
  S.browse.reqId = (S.browse.reqId || 0) + 1;
  $$('#brTabs .chip').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.browse.tab));
  browseLoad();
}

async function browseLoad() {
  const b = S.browse;
  if (b.loading || b.page >= b.totalPages) return;
  b.loading = true;
  const reqId = b.reqId;
  renderBrowseGrid();
  try {
    const r = await api.invoke('site:search', { query: b.query, tab: b.tab, page: b.page + 1, perPage: 30, orderby: b.sort });
    if (reqId !== b.reqId) return;
    b.page = r.page; b.totalPages = r.totalPages; b.total = r.total;
    b.posts.push(...r.posts.filter((p) => !b.posts.some((x) => x.id === p.id)));
  } catch (e) {
    if (reqId === b.reqId) b.error = e.message;
  } finally {
    if (reqId === b.reqId) b.loading = false;
    if (reqId === b.reqId && isFree()) renderBrowseGrid();
  }
}

function siteCard(p) {
  const installed = haveMod({ postId: p.id, title: p.title });
  const cat = p.categoryNames.filter((n) => !/^(Bikes|Rider|Other|Paid Mods)$/.test(n)).slice(-1)[0] || p.categoryNames[0] || '';
  return `<div class="card" data-post="${p.id}">
    <div class="thumb"><div class="ph" style="--ph1:#2b303c;--ph2:#15171c"><div class="ph-icon">${icon('globe')}</div><div class="ph-brand" style="font-size:16px">${esc(p.title.slice(0, 28))}</div></div>
      ${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="">` : ''}
      <div class="badges">${p.rank ? `<span class="badge accent">#${p.rank}</span>` : ''}${installed ? `<span class="badge ok">${icon('check')}Installed</span>` : ''}${p.paid ? '<span class="badge warn">Paid</span>' : ''}</div></div>
    <div class="card-body"><div class="card-title" title="${esc(p.title)}">${esc(p.title)}</div>
      <div class="card-meta">${esc(cat)}<span class="dot"></span>${p.views ? `${p.views.toLocaleString()} views` : timeAgo(p.date)}</div></div></div>`;
}

let brObserver = null;
function renderBrowseGrid() {
  const sc = $('#brScroll');
  if (!sc) return;
  const b = S.browse;
  $('#brCount').textContent = b.total ? `${b.total.toLocaleString()} mods` : '';
  let html = '';
  if (b.posts.length) html += `<div class="grid big">${b.posts.map(siteCard).join('')}</div>`;
  else if (b.loading) html += `<div class="grid big">${Array.from({ length: 12 }, () => '<div class="card"><div class="thumb skeleton"></div><div class="card-body"><div class="skeleton" style="height:12px;border-radius:4px;width:70%"></div></div></div>').join('')}</div>`;
  else if (b.error) html += `<div class="empty"><div>${icon('alert')}<h3>Couldn't reach mxb-mods.com</h3><div>${esc(b.error)}</div><div style="margin-top:12px"><button class="btn" data-act="browse-retry">${icon('refresh')}Retry</button></div></div></div>`;
  else html += `<div class="empty"><div>${icon('search')}<h3>No mods found</h3><div>Try another search or category.</div></div></div>`;
  if (b.page < b.totalPages && b.posts.length) html += `<div class="loadmore" id="brMore">${b.loading ? '<div class="spinner"></div>' : '<button class="btn" data-act="browse-more">Load more</button>'}</div>`;
  const top = sc.scrollTop;
  sc.innerHTML = html;
  sc.scrollTop = top;
  if (brObserver) brObserver.disconnect();
  const more = $('#brMore');
  if (more) {
    brObserver = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) browseLoad(); }, { root: sc, rootMargin: '700px' });
    brObserver.observe(more);
  }
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-post]');
  if (c && c.closest('#brScroll')) {
    const p = S.browse.posts.find((x) => x.id === Number(c.dataset.post));
    if (p) openPost(p);
  }
});

async function openPost(summary) {
  const m = modal({
    title: esc(summary.title),
    body: `<div class="post"><div><div class="gallery-main">${summary.image ? `<img src="${esc(summary.image)}" data-keep="1">` : ''}</div></div><div><div class="loadmore"><div class="spinner"></div></div></div></div>`,
    foot: `<span class="grow">mxb-mods.com</span><button class="btn" data-open="${esc(summary.link)}">${icon('external')}Open page</button>`,
  });
  let p;
  try { p = await api.invoke('site:post', summary.id); }
  catch (e) { $('.post > div:last-child', m).innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
  if (!m.isConnected) return;
  const installed = haveMod({ postId: p.id, title: p.title, urls: p.downloads.map((d) => d.url) });
  const hasUpdate = installed && updateFor(p.id, p.modified);
  const dls = p.downloads.length ? p.downloads.map((d, i) => {
    const mode = p.paid ? 'browser' : hostMode(d);
    const action = p.paid ? `<button class="btn" data-open="${esc(d.url)}">${icon('external')}Open</button>`
      : hasUpdate ? `<button class="btn btn-primary" data-dl="${i}">${icon('refresh')}Update</button>`
      : installed ? `<span class="have">${icon('check')}Installed</span>`
      : `<button class="btn btn-primary" data-dl="${i}">${icon('download')}Install</button>`;
    return `<div class="dl"><div class="info">${d.flag ? `<div class="flag">${esc(d.flag)}</div>` : ''}<div class="label">${esc(d.label || (d.host === 'mxb-mods.com' ? decodeURIComponent(d.url.split('/').pop()) : d.host) || 'Download')}</div>
      <div class="host">${esc(d.host)}<span class="host-pill ${mode}">${mode === 'auto' ? 'Auto-install' : 'Via browser'}</span></div></div>
      ${action}</div>`;
  }).join('') : `<div class="notice warn">${icon('alert')}<div>No download links found on this page. Open it on the site to check.</div></div>`;

  $('.modal-body', m).innerHTML = `<div class="post">
    <div>
      <div class="gallery-main"><img id="galMain" src="${esc(p.images[0] || p.image || '')}" data-keep="1" alt=""></div>
      ${p.images.length > 1 ? `<div class="gallery-strip">${p.images.map((u, i) => `<img src="${esc(u)}" data-gal="${i}" class="${i === 0 ? 'active' : ''}" data-keep="1" loading="lazy">`).join('')}</div>` : ''}
      <div class="desc">${p.description || '<p class="muted">No description.</p>'}</div>
    </div>
    <div>
      <h2>${esc(p.title)}</h2>
      <div class="post-meta">${p.author ? `<span>${icon('user')}${esc(p.author)}</span>` : ''}<span>${icon('clock')}${fmtDate(p.date)}</span>${p.modified && p.modified.slice(0, 10) !== p.date.slice(0, 10) ? `<span>${icon('refresh')}Updated ${fmtDate(p.modified)}</span>` : ''}</div>
      <div class="tags">${p.categoryNames.map((n) => `<span class="tag">${esc(n)}</span>`).join('')}</div>
      ${hasUpdate ? `<div class="notice info">${icon('refresh')}<div>You have this mod, and there's a newer version.</div></div>` : installed ? `<div class="notice ok">${icon('check')}<div>You already have this mod.</div></div>` : ''}
      ${p.madeFor ? `<div class="notice info">${icon('info')}<div>${esc(p.madeFor)}</div></div>` : ''}
      ${p.paid ? `<div class="notice warn">${icon('alert')}<div>This is a paid mod — buy it from the creator's store, then drag the downloaded file onto this window to install it.</div></div>` : ''}
      <div class="section-title">Downloads</div>
      <div class="dl-list">${dls}</div>
    </div></div>`;
  $('.modal-body', m).addEventListener('click', (e) => {
    const g = e.target.closest('[data-gal]');
    if (g) { $('#galMain', m).src = p.images[Number(g.dataset.gal)]; $$('[data-gal]', m).forEach((x) => x.classList.toggle('active', x === g)); }
    const d = e.target.closest('[data-dl]');
    if (d) {
      const dl = p.downloads[Number(d.dataset.dl)];
      startDownload(p, dl);
      d.disabled = true; d.innerHTML = `${icon('check')}Queued`;
    }
  });
}

async function startDownload(p, dl) {
  await api.invoke('jobs:start', {
    title: p.title, postId: p.id, url: dl.url, image: p.image, link: p.link, modified: p.modified,
    categories: p.categories, categoryNames: p.categoryNames,
  });
  toast(`Downloading <b>${esc(p.title)}</b>…`, 'info', 2500);
}

// ---------- downloads ----------
const STATUS_LABEL = { queued: 'Queued', downloading: 'Downloading', extracting: 'Unpacking', review: 'Needs review', installing: 'Installing', done: 'Installed', error: 'Failed', browser: 'Waiting for browser' };

function jobHtml(j) {
  const pct = j.total ? Math.min(100, (j.received / j.total) * 100) : 0;
  const running = ['downloading', 'extracting', 'installing', 'queued'].includes(j.status);
  const prog = running ? `<div class="progress ${!j.total || j.status !== 'downloading' ? 'indet' : ''}"><div style="width:${pct}%"></div></div>` : '';
  const sizeTxt = j.status === 'downloading' ? `${fmtSize(j.received)}${j.total ? ' / ' + fmtSize(j.total) : ''}` : j.fileName ? esc(j.fileName) : '';
  const acts = [];
  if (j.status === 'review') acts.push(`<button class="btn btn-primary btn-sm" data-job-act="review">${icon('check')}Review & install</button>`);
  if (j.status === 'error' && j.url) acts.push(`<button class="btn btn-sm" data-job-act="retry">${icon('refresh')}Retry</button><button class="btn btn-sm" data-job-act="browser">${icon('globe')}Use browser</button>`);
  if (j.status === 'done') acts.push(`<button class="btn btn-sm" data-job-act="library">${icon('library')}View in library</button>`);
  if (running || j.status === 'browser' || j.status === 'review') acts.push(`<button class="btn btn-sm btn-ghost" data-job-act="cancel">Cancel</button>`);
  if (j.status === 'done' || j.status === 'error') acts.push(`<button class="btn btn-sm btn-ghost btn-icon" data-job-act="dismiss" title="Remove from list">${icon('x')}</button>`);
  return `<div class="job" data-job="${j.id}">
    <div class="jthumb">${icon('download')}${j.image ? `<img src="${esc(j.image)}" alt="">` : ''}</div>
    <div style="min-width:0"><div class="jt">${esc(j.title)}</div>
      <div class="js"><span class="status ${j.status}">${STATUS_LABEL[j.status] || j.status}</span><span>${sizeTxt}</span>${j.plan && j.status !== 'done' ? `<span>→ ${esc(j.plan.kindLabel)}</span>` : ''}</div>
      ${prog}
      ${j.note && j.status !== 'error' ? `<div class="note">${esc(j.note)}</div>` : ''}
      ${j.error ? `<div class="err">${esc(j.error)}</div>` : ''}
    </div>
    <div class="jactions">${acts.join('')}</div></div>`;
}

function renderDownloads(c) {
  const list = [...S.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>Downloads</h2>${dlTabs("downloads")}<div class="grow"></div>
      <button class="btn" data-act="pick-files">${icon('upload')}Install from file…</button>
      ${list.some((j) => ['done', 'error'].includes(j.status)) ? `<button class="btn btn-ghost" data-act="clear-jobs">Clear finished</button>` : ''}</div>
    <div class="scroller"><div class="jobs" id="jobsList">${list.length ? list.map(jobHtml).join('') : `<div class="empty"><div>${icon('download')}<h3>No downloads yet</h3><div>Install mods from the Browse tab, or drag .pkz / .zip / .rar files onto this window.</div></div></div>`}</div></div>
  </div></div>`;
}

function updateJobInPlace(j) {
  const el = $(`[data-job="${j.id}"]`);
  if (el) { const t = document.createElement('div'); t.innerHTML = jobHtml(j); el.replaceWith(t.firstElementChild); }
  else if (S.view === 'downloads') renderDownloads($('#content'));
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-job-act]');
  if (!b) return;
  const id = b.closest('[data-job]').dataset.job;
  const act = b.dataset.jobAct;
  if (act === 'review') openReview(id);
  else if (act === 'retry') api.invoke('jobs:retry', id);
  else if (act === 'browser') api.invoke('jobs:openBrowser', id);
  else if (act === 'cancel') api.invoke('jobs:cancel', id);
  else if (act === 'library') { S.lib.quick = 'app'; go('library'); }
  else if (act === 'dismiss') { await api.invoke('jobs:dismiss', id); S.jobs.delete(id); renderDownloads($('#content')); renderRail(); }
});

// ---------- install review ----------
const UPLOAD_TYPES = [
  { id: 'bike', label: 'Bike', icon: 'bike', hint: 'a whole new bike' },
  { id: 'bikePaint', label: 'Bike livery', icon: 'paint', hint: 'graphics for a bike' },
  { id: 'track', label: 'Track', icon: 'track' },
  { id: 'riderKit', label: 'Rider kit', icon: 'shirt', hint: 'jersey & pants' },
  { id: 'helmet', label: 'Helmet', icon: 'helmet' },
  { id: 'helmetPaint', label: 'Helmet paint', icon: 'paint' },
  { id: 'goggles', label: 'Goggles', icon: 'goggles' },
  { id: 'gloves', label: 'Gloves', icon: 'glove' },
  { id: 'boots', label: 'Boots', icon: 'boot' },
  { id: 'bootPaint', label: 'Boot paint', icon: 'paint' },
  { id: 'protection', label: 'Chest protector', icon: 'shield', hint: 'or neck brace' },
  { id: 'protectionPaint', label: 'Protector paint', icon: 'paint' },
  { id: 'tyre', label: 'Tyres', icon: 'tyre' },
  { id: 'custom', label: 'Something else', icon: 'folder', hint: 'choose the folder' },
];
let reviewOpen = null;
function openReview(id) {
  const j = S.jobs.get(id);
  if (!j || !j.plan) return;
  if (reviewOpen) reviewOpen.close();
  let opts = { ...(j.plan.options || {}), kind: j.plan.kind };
  let paintModelInfo = j.plan.paintModelInfo || [];
  const targetBike = (name) => bikeItem(name) || paintModelInfo.find((i) => i.name === name);
  const targetFilters = { brand: '', cc: '' };
  const targetMatches = (name) => {
    const bike = targetBike(name);
    return (!targetFilters.brand || (bike && bike.brand === targetFilters.brand)) && (!targetFilters.cc || (bike && String(bike.cc) === targetFilters.cc));
  };
  const m = modal({
    title: `Install — ${esc(j.title)}`, size: 'md', body: '<div id="rv"></div>',
    foot: `<span class="grow" id="rvSummary"></span><button class="btn" data-close>Later</button><button class="btn btn-primary" id="rvInstall">${icon('download')}Install</button>`,
    onClose: () => { reviewOpen = null; },
  });
  reviewOpen = m;
  const draw = (job) => {
    const p = job.plan;
    paintModelInfo = p.paintModelInfo || [];
    if (p.askType) {
      const why = p.detectReason === 'paint' ? 'It contains paint files (.pnt), which can belong to a bike, helmet, kit, gloves and more.'
        : p.detectReason === 'encrypted' ? 'The file is protected by its author, so the app can’t look inside it.' : 'The app couldn’t recognise the files inside.';
      $('#rv', m).innerHTML = `<div style="text-align:center;margin:4px 0 16px"><div style="font:700 20px var(--display);text-transform:uppercase">What did you upload?</div><div class="muted">${esc(why)} Pick what it is and it'll go in the right place.</div></div>
        <div class="type-grid">${UPLOAD_TYPES.map((t) => `<button class="type-tile" data-kind="${t.id}">${icon(t.icon)}${esc(t.label)}${t.hint ? `<small>${esc(t.hint)}</small>` : ''}</button>`).join('')}</div>
        <div class="muted" style="font-size:12px;margin-top:10px">Files: ${p.entries.slice(0, 6).map((e) => `<span class="mono">${esc(e.rel)}</span>`).join(', ')}${p.totalEntries > 6 ? '…' : ''}</div>`;
      $('#rvSummary', m).textContent = '';
      $('#rvInstall', m).disabled = true;
      return;
    }
    const ctl = [];
    ctl.push(`<div class="field"><label>Mod type</label><select data-opt="kind">${p.kinds.map((k) => `<option value="${k.id}" ${k.id === p.kind ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></div>`);
    if (p.kind === 'track') ctl.push(`<div class="field"><label>Track type</label><select data-opt="trackType">${p.trackTypes.map((t) => `<option ${t === p.options.trackType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`);
    if (p.paintModelsBase) {
      const bikeTarget = p.kind === 'bikePaint' || p.paintModelsBase === 'bikes';
      const candidates = p.paintModels.filter((n) => !bikeTarget || targetMatches(n));
      if (bikeTarget) {
        const targetBikes = p.paintModels.map(targetBike).filter(Boolean);
        for (const fc of FACETS.bikes.filter((f) => f.key !== 'cls')) {
          const values = [...new Set(targetBikes.map(fc.get).filter(Boolean))].sort(fc.order || ((a, b) => String(a).localeCompare(String(b))));
          ctl.push(`<div class="field"><label>${esc(fc.label)}</label><select data-target-filter="${fc.key}"><option value="">${esc(FACET_ALL[fc.key])}</option>${values.map((v) => `<option value="${esc(v)}" ${String(v) === targetFilters[fc.key] ? 'selected' : ''}>${esc(fc.fmt(v))}</option>`).join('')}</select></div>`);
        }
      }
      ctl.push(`<div class="field"><label>Install paints onto${bikeTarget ? ` (${candidates.length})` : ''}</label><select data-opt="paintTarget"><option value="">— choose —</option>${candidates.map((n) => `<option value="${esc(n)}" ${n === p.options.paintTarget ? 'selected' : ''}>${esc(bikeTarget ? bikeTitle(n) : n)}</option>`).join('')}</select></div>`);
    }
    if (p.kind === 'custom') ctl.push(`<div class="field"><label>Folder inside mods/</label><input class="input" data-opt="customDir" list="dirsList" placeholder="e.g. bikes/MY_BIKE/paints" value="${esc(p.options.customDir || '')}"><datalist id="dirsList">${['bikes', 'tracks/motocross', 'tracks/supercross', 'rider/paints', 'rider/helmets', 'rider/boots', 'rider/gloves', 'rider/protections', 'tyres', 'misc'].map((d) => `<option value="${d}">`).join('')}</datalist></div>`);
    const warn = p.warnings.map((w) => `<div class="notice warn">${icon('alert')}<div>${esc(w)}</div></div>`).join('');
    const detected = p.kindHint && p.kind === p.kindHint ? `<div class="notice ok">${icon('check')}<div>Detected a <b>${esc(p.kindLabel)}</b> from the files inside. Change the type above if that's wrong.</div></div>` : '';
    const guess = detected + (p.paintGuess === 'title' ? `<div class="notice info">${icon('info')}<div>Guessed <b>${esc(p.options.paintTarget)}</b> from the mod name — check it's the right one.</div></div>` : '');
    const rows = p.entries.map((e) => `<div class="plan-row"><div class="src" title="${esc(e.rel)}">${esc(e.rel)}</div>${icon('chevron')}<div class="dst" title="${esc(e.dest || '')}">${e.dest ? 'mods/' + esc(e.dest) : '<span class="muted">—</span>'}</div><span class="pill ${e.status}">${e.status}</span></div>`).join('');
    $('#rv', m).innerHTML = `<div class="plan-controls">${ctl.join('')}</div>${warn}${guess}
      <div class="section-title">Files <span class="muted">(${p.totalEntries})</span></div><div class="plan-table">${rows}</div>${p.totalEntries > p.entries.length ? `<div class="muted" style="margin-top:6px">…and ${p.totalEntries - p.entries.length} more</div>` : ''}`;
    $('#rvSummary', m).textContent = `${p.installable} file(s) will be installed`;
    $('#rvInstall', m).disabled = !p.installable || (p.paintModelsBase === 'bikes' && (!p.options.paintTarget || !targetMatches(p.options.paintTarget)));
  };
  draw(j);
  $('#rv', m).addEventListener('click', async (e) => {
    const t = e.target.closest('[data-kind]');
    if (!t) return;
    opts = { kind: t.dataset.kind };
    const nj = await api.invoke('jobs:plan', id, opts);
    if (nj) { S.jobs.set(id, nj); opts = { ...nj.plan.options, kind: nj.plan.kind }; draw(nj); }
  });
  $('#rv', m).addEventListener('change', async (e) => {
    if (e.target.dataset.targetFilter) {
      targetFilters[e.target.dataset.targetFilter] = e.target.value;
      if (opts.paintTarget && !targetMatches(opts.paintTarget)) { opts.paintTarget = ''; opts.requirePaintTarget = true; }
      $('#rvInstall', m).disabled = true;
      const nj = await api.invoke('jobs:plan', id, opts);
      if (nj) { S.jobs.set(id, nj); opts = { ...nj.plan.options, kind: nj.plan.kind }; draw(nj); }
      return;
    }
    const k = e.target.dataset.opt;
    if (!k) return;
    opts[k] = e.target.value;
    if (k === 'kind') { delete opts.paintTarget; }
    const nj = await api.invoke('jobs:plan', id, opts);
    if (nj) { S.jobs.set(id, nj); opts = { ...nj.plan.options, kind: nj.plan.kind }; draw(nj); }
  });
  $('#rvInstall', m).addEventListener('click', () => { api.invoke('jobs:install', id, opts); m.close(); });
}

// ---------- rider (loadout per bike, stored in the game profile) ----------
S.rider = { profile: null, profiles: [], bikes: null, bike: null, lo: null };
const SLOT_ICONS = { bikePaint: 'paint', rider: 'rider', helmet: 'helmet', helmetPaint: 'paint', gogglesPaint: 'goggles', suitPaint: 'shirt', protection: 'shield', protectionPaint: 'paint', glovesPaint: 'glove', boots: 'boot', bootsPaint: 'paint' };
const PAINT_SLOTS = new Set(['bikePaint', 'helmetPaint', 'gogglesPaint', 'suitPaint', 'protectionPaint', 'glovesPaint', 'bootsPaint']);
// Choosing a new model resets the paints that belonged to the old one.
const RESETS = { helmet: ['helmetPaint', 'gogglesPaint'], boots: ['bootsPaint'], protection: ['protectionPaint'] };

function gearBrand(value) {
  const text = String(value || '').replace(/[_-]/g, ' ').replace(/\d{4}/g, ' ');
  const brands = [
    ['6D', /6d/i], ['100%', /100\s*%|100percent/i], ['Alpinestars', /alpinestars|a\s*stars|astars/i],
    ['Troy Lee Designs', /troy\s*lee|\btld\b/i], ['Fox', /fox/i], ['Fly Racing', /\bfly|flyformula/i],
    ['Bell', /bell/i], ['Airoh', /airoh/i], ['Arai', /arai/i], ['Shoei', /shoei/i], ['AGV', /\bagv\b/i],
    ['Thor', /thor/i], ['Shift', /shift/i], ['Answer', /answer/i], ['Leatt', /leatt/i], ['Gaerne', /gaerne/i],
    ["O'Neal", /o[ '\u2019]?neal/i], ['Acerbis', /acerbis/i], ['Just1', /just\s*1/i], ['Seven', /seven/i],
    ['Fasthouse', /fasthouse/i], ['FXR', /\bfxr\b/i], ['Scott', /scott/i], ['Oakley', /oakley/i],
    ['Progrip', /progrip/i], ['Havoc', /havoc/i], ['Sidi', /sidi/i], ['Forma', /\bforma\b/i],
    ['Dainese', /dainese/i], ['Hebo', /hebo/i], ['Klim', /\bklim\b/i], ['MSR', /\bmsr\b/i],
  ];
  return (brands.find(([, match]) => match.test(text)) || ['Unspecified'])[0];
}

// The installed gear item (helmet/boots/protector model) for a chosen value, for its picture.
function gearItem(slotId, value) {
  if (slotId === 'bikePaint') {
    const paint = S.items.find((i) => i.group === 'bikePaints' && !i.disabled && i.bike === S.rider.bike && i.name === value);
    return paint || (!value || value.toLowerCase() === 'stock' ? bikeItem(S.rider.bike) : null);
  }
  const sub = { helmet: 'helmets', boots: 'boots', protection: 'protections' }[slotId];
  if (!sub || !value) return null;
  return S.items.find((i) => i.group === 'rider' && !i.sub.startsWith('legacy/') && i.sub.endsWith(sub) && i.name === value) || null;
}
function bikeItem(id) { return S.items.find((i) => i.group === 'bikes' && i.name === id); }
function bikeTitle(id) { const it = bikeItem(id); return it ? it.title : id.replace(/_/g, ' '); }
function prettyValue(slot, v) {
  if (!v) return PAINT_SLOTS.has(slot) ? 'Default' : '—';
  if (v === 'default' || v === 'default_mx') return 'Default';
  return v.replace(/_/g, ' ');
}

async function renderRider(c) {
  const R = S.rider;
  if (S.riderTab === 'gear') {
    for (const key of ['viewer', 'bikeViewer']) if (R[key]) { R[key].dispose(); R[key] = null; }
    R.modelKey = null; R.bikeModelKey = null; R.modelOk = false;
    if (S.lib.scope !== 'rider') { S.lib.scope = 'rider'; S.lib.tab = 'helmets'; S.lib.f = {}; S.lib.query = ''; }
    renderLibrary(c);
    return;
  }
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Rider</h2><span class="sub">Pick your gear for each bike</span></div><div class="scroller"><div class="loadmore"><div class="spinner"></div></div></div></div></div>`;
  try {
    if (!R.profile) { const p = await api.invoke('rider:profiles'); R.profiles = p.profiles; R.profile = p.last; R.activeProfile = p.last; }
    if (!R.profile) {
      c.innerHTML = `<div class="view"><div class="empty" style="margin:auto"><div>${icon('rider')}<h3>No game profile yet</h3><div>Start MX Bikes once to create your rider profile, then come back here.</div></div></div></div>`;
      return;
    }
    if (!R.bikes) R.bikes = await api.invoke('rider:bikes', R.profile);
    if (!R.bike) R.bike = (R.bikes.find((b) => b.selected) || R.bikes.find((b) => b.installed) || R.bikes[0] || {}).id;
    R.lo = await api.invoke('rider:loadout', R.profile, R.bike);
  } catch (e) {
    c.innerHTML = `<div class="view"><div class="empty" style="margin:auto"><div>${icon('alert')}<h3>Couldn't read your profile</h3><div>${esc(e.message)}</div></div></div></div>`;
    return;
  }
  if (S.view !== 'rider') return;
  if (S.riderTab === 'bike') {
    if (R.viewer) { R.viewer.dispose(); R.viewer = null; R.modelOk = false; }
    drawBike(c);
  } else {
    if (R.bikeViewer) { R.bikeViewer.dispose(); R.bikeViewer = null; }
    drawRider(c);
  }
}

function drawBike(c) {
  const R = S.rider, lo = R.lo;
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar rider-toolbar"><div class="rider-heading"><h2>Rider</h2>${riderTabsHtml('bike')}</div>${profileControlsHtml()}</div>
    <div class="scroller"><div class="bike-preview-layout">
      <div><div class="rider-stage bike-stage" id="bikeStage"><div class="stage-status" id="bikeStatus"><div class="spinner"></div></div><div class="stage-hint">Drag to turn · scroll to zoom · double-click to reset</div></div><div class="stage-note muted" id="bikeNote"></div></div>
      <div class="rider-wrap"><div class="set-card"><div class="slot-l">Bike model</div><h2>${esc(bikeTitle(R.bike))}</h2>${lo.selectedInGame ? `<span class="badge ok">${icon('check')}Your current bike in game</span>` : ''}<p class="muted">Previewing your installed model and selected livery.</p><button class="btn" data-act="rider-pick-bike">${icon('bike')}Choose bike</button></div>
      <div class="section-title">Livery</div><button class="slot" data-slot="bikePaint"><span class="slot-ico">${icon('paint')}</span><span class="slot-txt"><span class="slot-l">Bike livery</span><span class="slot-v">${esc(prettyValue('bikePaint', lo.current.bikePaint))}</span></span><span class="slot-n">${lo.options.bikePaint.length} ${icon('chevron')}</span></button>
      <p class="muted" style="margin-top:16px;font-size:12px">Close MX Bikes before saving a different livery. Previews do not change your game files.</p></div>
    </div></div></div></div>`;
  mountProfileControls();
  const key = R.profile + '|' + R.bike + '|' + (lo.current.bikePaint || ''); R.bikeModelKey = key;
  const attach = async () => {
    if (R.bikeModelKey !== key || !$('#bikeStage')) return;
    if (!R.bikeViewer) { const host = document.createElement('div'); host.className = 'stage-canvas'; R.bikeViewer = window.RiderViewer.create(host); }
    $('#bikeStage').prepend(R.bikeViewer.el);
    try {
      const model = await api.invoke('bike:model', R.profile, R.bike, lo.current.bikePaint || '');
      if (R.bikeModelKey !== key || !$('#bikeStage') || !R.bikeViewer) return;
      R.bikeViewer.load(model); $('#bikeStatus').hidden = true;
      $('#bikeNote').textContent = model.warnings.join(' ');
    } catch (e) { if (R.bikeModelKey === key && $('#bikeStatus')) $('#bikeStatus').innerHTML = `<div class="stage-err">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`; }
  };
  if (window.RiderViewer) attach(); else window.addEventListener('riderviewer-ready', attach, { once: true });
}

function drawRider(c) {
  const R = S.rider, lo = R.lo;
  const it = bikeItem(R.bike);
  const groups = [...new Set(lo.slots.filter((s) => s.group !== 'Bike').map((s) => s.group))];
  const tile = (s) => {
    const n = lo.options[s.id].length;
    const v = lo.current[s.id];
    const blocked = !n && PAINT_SLOTS.has(s.id);
    const why = s.id === 'helmetPaint' || s.id === 'gogglesPaint' ? (lo.current.helmet && lo.current.helmet !== 'default' ? 'No paints installed for this helmet' : 'Pick a helmet first')
      : s.id === 'bootsPaint' ? 'No paints for these boots' : s.id === 'protectionPaint' ? 'No paints for this protector' : 'Nothing installed yet';
    const gi = gearItem(s.id, v);
    const pic = gi && gi.hasImage ? `<span class="slot-img thumb">${thumbHtml(gi)}</span>` : `<span class="slot-ico">${icon(SLOT_ICONS[s.id] || 'box')}</span>`;
    return `<button class="slot" data-slot="${s.id}" ${blocked ? 'disabled' : ''}>
      ${pic}
      <span class="slot-txt"><span class="slot-l">${esc(s.label)}</span><span class="slot-v">${blocked ? `<span class="muted">${why}</span>` : esc(prettyValue(s.id, v))}</span></span>
      ${blocked ? '' : `<span class="slot-n">${n} ${icon('chevron')}</span>`}</button>`;
  };
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar rider-toolbar"><div class="rider-heading"><h2>Rider</h2>${riderTabsHtml('outfit')}</div>${profileControlsHtml()}
      <span class="sub">Pick your gear for each bike — saves straight to your game</span>
      <button class="btn" data-act="rider-copy-all">${icon('copy')}Use this outfit on all bikes</button></div>
    <div class="scroller"><div class="rider-layout">
      <div class="rider-stage-col"><div class="rider-stage" id="riderStage">
        <div class="stage-status" id="stageStatus"><div class="spinner"></div></div>
        <div class="stage-hint">Drag to turn · scroll to zoom · double-click to reset</div>
      </div><div class="stage-note muted" id="stageNote"></div></div>
      <div class="rider-wrap">
      <div class="outfit-bike-context"><span class="muted">Outfit for ${esc(bikeTitle(R.bike))}</span><button class="btn btn-sm" data-rider-tab="bike">${icon('bike')}Bike & livery</button></div>
      ${groups.map((g) => `<div class="section-title">${esc(g)}</div><div class="slot-grid">${lo.slots.filter((s) => s.group === g).map(tile).join('')}</div>`).join('')}
      <p class="muted" style="margin-top:22px;font-size:12px">${icon('info')} Close MX Bikes before changing gear here. A backup of your profile is kept next to it.</p>
    </div></div></div></div></div>`;
  mountRiderViewer();
  mountProfileControls();
}

function profileControlsHtml() {
  const R = S.rider;
  return `<div class="profile-controls"><label>Profile<select id="riderProfile">${R.profiles.map((p) => `<option ${p === R.profile ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label><button class="btn btn-sm" data-act="profile-create">${icon('plus')}Create profile</button>${R.lo?.profileActive ? `<span class="badge ok">${icon('check')}Active in game</span>` : '<button class="btn btn-sm" data-act="profile-activate">Use in game</button>'}</div>`;
}
function mountProfileControls() {
  const select = $('#riderProfile');
  if (select) select.addEventListener('change', (e) => { S.rider.profile = e.target.value; S.rider.bikes = null; S.rider.bike = null; renderRider($('#content')); });
}

function createProfileDialog() {
  const R = S.rider;
  const m = modal({ title: 'Create game profile', size: 'sm',
    body: '<div class="field"><label>Profile name</label><input class="input" id="newProfileName" maxlength="64" placeholder="Race kit, practice, enduro…"></div><div class="field" style="margin-top:14px"><label>Starting setup</label><select id="newProfileMode"><option value="copy">Copy current gear setup</option><option value="fresh">Default gear setup</option></select></div><p class="muted">This creates a real MX Bikes profile. Your controls and settings are copied. Choose Use in game when you want to ride with it.</p><div id="profileError" class="muted"></div>',
    foot: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="createProfile">Create profile</button>',
  });
  $('#newProfileName', m).focus();
  $('#createProfile', m).addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const result = await api.invoke('rider:createProfile', $('#newProfileName', m).value, R.profile, $('#newProfileMode', m).value === 'copy');
      R.profiles = result.profiles; R.profile = result.name; R.bikes = null; R.bike = null;
      m.close(); renderRider($('#content')); toast('Profile created', 'ok');
    } catch (error) { $('#profileError', m).textContent = cleanErr(error); e.target.disabled = false; }
  });
}

// ---- 3D outfit preview ----
// One viewer for the app's lifetime; its canvas is moved into each fresh Rider page.
function mountRiderViewer() {
  const R = S.rider, stage = $('#riderStage');
  if (!stage) return;
  const attach = () => {
    if (!window.RiderViewer) return false;
    if (!R.viewer) {
      const host = document.createElement('div');
      host.className = 'stage-canvas';
      R.viewer = window.RiderViewer.create(host);
      R.modelOk = false;
    }
    stage.prepend(R.viewer.el);
    loadRiderModel();
    return true;
  };
  if (!attach()) window.addEventListener('riderviewer-ready', attach, { once: true });
}

async function loadRiderModel() {
  const R = S.rider;
  const key = JSON.stringify([R.profile, R.bike, R.lo && R.lo.current]);
  const status = $('#stageStatus'), note = $('#stageNote');
  if (R.modelKey === key && R.modelOk) { if (status) status.hidden = true; if (note) note.innerHTML = R.modelNote || ''; return; }
  R.modelKey = key;
  if (status) { status.hidden = false; status.innerHTML = '<div class="spinner"></div>'; }
  try {
    const m = await api.invoke('rider:model', R.profile, R.bike);
    if (R.modelKey !== key) return; // a newer request is on its way
    R.viewer.load(m);
    R.modelOk = true;
    R.modelNote = m.warnings.length ? `${icon('info')} ${esc(m.warnings.join(' '))}` : '';
    const st = $('#stageStatus'), nt = $('#stageNote');
    if (st) st.hidden = true;
    if (nt) nt.innerHTML = R.modelNote;
  } catch (e) {
    if (R.modelKey !== key) return;
    R.modelOk = false;
    const st = $('#stageStatus');
    if (st) { st.hidden = false; st.innerHTML = `<div class="stage-err">${icon('alert')}<div>${esc(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</div></div>`; }
  }
}

function listPicker({ title, options, current, render, onPick }) {
  const m = modal({
    title: esc(title), size: 'sm',
    body: `<div class="search" style="margin-bottom:10px">${icon('search')}<input id="optQ" placeholder="Search…" style="width:100%"></div><div class="opt-list" id="optList"></div>`,
  });
  const draw = () => {
    const q = $('#optQ', m).value.toLowerCase();
    const xs = options.filter((o) => (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q));
    $('#optList', m).innerHTML = xs.length ? xs.slice(0, 600).map((o) => `<button class="opt ${o.value === current ? 'active' : ''}" data-v="${esc(o.value)}">${render ? render(o) : ''}<span class="opt-txt"><span>${esc(o.label)}</span>${o.sub ? `<span class="muted">${esc(o.sub)}</span>` : ''}</span>${o.value === current ? icon('check') : ''}</button>`).join('')
      : `<div class="muted" style="padding:20px;text-align:center">No matches</div>`;
  };
  $('#optQ', m).addEventListener('input', draw);
  $('#optList', m).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { m.close(); onPick(b.dataset.v); } });
  draw();
  setTimeout(() => $('#optQ', m).focus(), 50);
}

// Both Game and Rider use the same installed-bike choices and library facets.
function bikePicker({ current, onPick, selectedInGame }) {
  const seen = new Set();
  const items = S.items.filter((i) => i.group === 'bikes' && !i.disabled && i.kind !== 'archive' && !i.duplicateOf)
    .filter((i) => { if (seen.has(i.name)) return false; seen.add(i.name); return true; });
  return gridPicker({ title: 'Choose a bike', items, current, onPick, facets: FACETS.bikes,
    meta: (i) => [i.brand, i.cc && (i.cc === 'Electric' ? 'Electric' : `${i.cc}cc`), i.bikeClass, i.name === selectedInGame && 'Current bike in game'].filter(Boolean).join(' · '),
  });
}

async function saveSlot(slotId, value) {
  const R = S.rider;
  const change = { [slotId]: value };
  for (const r of RESETS[slotId] || []) change[r] = '';
  try {
    await api.invoke('rider:save', R.profile, { [R.bike]: change });
    toast(`Saved — ${esc(prettyValue(slotId, value))}`, 'ok', 1600);
  } catch (e) { toast(esc(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')), 'err', 6000); }
  renderRider($('#content'));
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-slot]');
  if (!t || S.view !== 'rider') return;
  const lo = S.rider.lo;
  const slot = lo.slots.find((s) => s.id === t.dataset.slot);
  const opts = lo.options[slot.id].map((v) => ({ value: v, label: prettyValue(slot.id, v) }));
  if (PAINT_SLOTS.has(slot.id) && !opts.some((o) => o.value === '')) opts.unshift({ value: '', label: 'Default', sub: 'The standard paint' });
  const withPics = ['helmet', 'boots', 'protection'].includes(slot.id);
  const render = withPics ? (o) => { const gi = gearItem(slot.id, o.value); return `<span class="opt-img thumb">${gi && gi.hasImage ? thumbHtml(gi) : `<span class="slot-ico" style="width:100%;height:100%">${icon(SLOT_ICONS[slot.id])}</span>`}</span>`; } : null;
  if (slot.id === 'bikePaint' || (GEAR_3D.has(slot.id) && window.RiderViewer)) return gearPicker(slot, opts, lo);
  listPicker({ title: slot.label, options: opts, current: lo.current[slot.id] || '', render, onPick: (v) => saveSlot(slot.id, v) });
});

// ---------- Gear picker with 3D renders ----------
// Every option is drawn in 3D (with your other gear) and shown as a tile. Renders are made one at
// a time, visible tiles first, and kept for the session.
const GEAR_3D = new Set(['rider', 'bikePaint', 'helmet', 'helmetPaint', 'gogglesPaint', 'suitPaint', 'glovesPaint', 'boots', 'bootsPaint', 'protection', 'protectionPaint']);
const GEAR_FRAMING = { glovesPaint: 'hands', boots: 'feet', bootsPaint: 'feet' };
S.gearThumbs = new Map();
function gearThumbKey(slotId, value, lo) {
  const c = lo.current;
  const ctx = { bikePaint: lo.bike, helmetPaint: c.helmet, gogglesPaint: c.helmet, bootsPaint: c.boots, protectionPaint: c.protection, suitPaint: c.rider, glovesPaint: c.rider }[slotId] || c.rider || '';
  return `${slotId}|${ctx || ''}|${value}`;
}
function gearPicker(slot, opts, lo) {
  const R = S.rider;
  const current = lo.current[slot.id] || '';
  const sorted = [...opts].sort((a, b) => (b.value === current) - (a.value === current));
  const optionBrand = (o) => {
    if (slot.id === 'bikePaint') return bikeItem(R.bike)?.brand || 'Unspecified';
    const brand = gearBrand(o.value);
    if (brand !== 'Unspecified') return brand;
    const parent = { helmetPaint: lo.current.helmet, gogglesPaint: lo.current.helmet, bootsPaint: lo.current.boots, protectionPaint: lo.current.protection }[slot.id];
    return gearBrand(parent);
  };
  const brands = [...new Set(opts.map(optionBrand))].sort();
  let closed = false, running = false, io = null;
  const queue = [];
  const m = modal({
    title: esc(slot.label), size: 'lg',
    body: `<div class="search wide" style="margin-bottom:14px">${icon('search')}<input id="gpQ" placeholder="Search ${opts.length} options…" spellcheck="false"></div><div class="picker-filters"><label><span>Brand</span><select id="gpBrand"><option value="">All brands</option>${brands.map((b) => `<option>${esc(b)}</option>`).join('')}</select></label></div><div class="picker-count" id="gearCount"></div><div id="gpGrid" class="gear-grid"></div>`,
    foot: slot.id === 'rider' ? `<button class="btn" data-model-add>${icon('upload')}Add model</button><button class="btn btn-danger" data-model-delete ${/^(default|default_mx|default_sm)$/i.test(current) || !current ? 'disabled' : ''}>${icon('trash')}Delete selected model</button>` : '',
    onClose: () => { closed = true; if (io) io.disconnect(); },
  });
  const tileImg = (key) => {
    const u = S.gearThumbs.get(key);
    if (u && u.pic && !u.locked) return u.pic;
    if (u && u.locked) return `${u.pic ? u.pic : `<span class="gear-noimg">${icon(SLOT_ICONS[slot.id] || 'box')}</span>`}<span class="gear-lock">Preview unavailable</span>`;
    if (u) return `<img src="${u}" alt="">`;
    if (u === null) return `<span class="gear-noimg">${icon(SLOT_ICONS[slot.id] || 'box')}<span>No preview</span></span>`;
    return '<span class="gear-spin"><span class="spinner"></span></span>';
  };
  io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const key = en.target.dataset.key;
      if (!S.gearThumbs.has(key) && !queue.includes(key)) queue.push(key);
    }
    pump();
  }, { root: $('.modal-body', m), rootMargin: '200px' });
  async function pump() {
    if (running) return;
    running = true;
    while (!closed && queue.length) {
      const key = queue.shift();
      if (S.gearThumbs.has(key)) continue;
      const value = key.split('|').slice(2).join('|');
      let url = null;
      const gi = gearItem(slot.id, value);
      const pic = gi && gi.hasImage ? thumbHtml(gi) : null;
      if (slot.id === 'bikePaint') {
        // Livery choices use the image recorded with the installed download.
        // The interactive Bike page still renders the selected paint itself.
        url = pic ? { pic, locked: false } : null;
      } else {
      try {
        const model = await api.invoke('rider:thumbModel', R.profile, R.bike, slot.id, value);
        // Missing, unsupported and protected assets all lack a preview; this
        // alone does not establish that the creator encrypted the file.
        if ((model.unreadable || []).includes(slot.id)) url = { locked: true, pic };
        else url = window.RiderViewer.thumb(model, GEAR_FRAMING[slot.id] || 'full', 320);
      } catch { url = null; }
      }
      if (!url && pic) url = { locked: false, pic };
      S.gearThumbs.set(key, url);
      while (S.gearThumbs.size > 180) S.gearThumbs.delete(S.gearThumbs.keys().next().value);
      const el = m.querySelector(`[data-key="${CSS.escape(key)}"] .gear-img`);
      if (el) el.innerHTML = tileImg(key);
    }
    running = false;
  }
  const draw = () => {
    io.disconnect();
    queue.length = 0;
    const q = $('#gpQ', m).value.toLowerCase().split(/\s+/).filter(Boolean);
    const brand = $('#gpBrand', m).value;
    const xs = sorted.filter((o) => (!brand || optionBrand(o) === brand) && q.every((t) => `${o.label} ${o.value} ${optionBrand(o)}`.toLowerCase().includes(t)));
    $('#gearCount', m).textContent = `${xs.length} of ${opts.length}`;
    $('#gpGrid', m).innerHTML = xs.length ? xs.slice(0, 400).map((o) => {
      const key = gearThumbKey(slot.id, o.value, lo);
      return `<button class="gear-tile ${o.value === current ? 'selected' : ''}" data-v="${esc(o.value)}" data-key="${esc(key)}">
        <span class="gear-img">${tileImg(key)}</span>${o.value === current ? `<span class="badge ok gear-sel">${icon('check')}Wearing</span>` : ''}
        <span class="gear-name" title="${esc(o.label)}">${esc(o.label)}</span></button>`;
    }).join('') : `<div class="empty"><div>${icon('search')}<h3>No matches</h3></div></div>`;
    $$('.gear-tile', m).forEach((t) => io.observe(t));
  };
  $('#gpQ', m).addEventListener('input', debounce(draw, 150));
  $('#gpBrand', m).addEventListener('change', draw);
  const addModel = $('[data-model-add]', m);
  if (addModel) addModel.addEventListener('click', () => { m.close(); const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.pkz,.zip,.rar,.7z'; input.onchange = () => installFiles([...input.files]); input.click(); });
  const deleteModel = $('[data-model-delete]', m);
  if (deleteModel) deleteModel.addEventListener('click', async () => {
    if (!(await confirmBox('Delete rider model', `Move <b>${esc(current)}</b> and its paints to the Recycle Bin? Profiles using it will switch to the default rider, with backups.`, 'Move to Recycle Bin', true))) return;
    try { await api.invoke('rider:deleteModel', current); m.close(); S.gearThumbs.clear(); R.bikes = null; await rescan(true); renderRider($('#content')); }
    catch (e) { toast(esc(cleanErr(e)), 'err', 6000); }
  });
  $('#gpGrid', m).addEventListener('click', (e) => { const t = e.target.closest('[data-v]'); if (t) { m.close(); saveSlot(slot.id, t.dataset.v); } });
  draw();
  setTimeout(() => $('#gpQ', m).focus(), 50);
}

// ---------- accounts (Steam + shops) ----------
S.accounts = { steam: null, shops: [] };
async function refreshAccounts() {
  const [st, sh] = await Promise.all([api.invoke('steam:detect').catch(() => ({ found: false })), api.invoke('shops:list').catch(() => [])]);
  S.accounts = { steam: st, shops: sh };
  return S.accounts;
}
function cleanErr(e) { return String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

function accountCardsHtml() {
  const st = S.accounts.steam || { found: false };
  const steamCard = `<div class="acct">
    <div class="acct-logo steam">${st.avatarData ? `<img src="${st.avatarData}" alt="">` : icon('steam')}</div>
    <div class="acct-txt"><div class="acct-name">Steam</div>
      ${st.found ? `<div class="acct-sub"><span class="ok-dot"></span>${esc(st.name || st.account)} · <span class="mono">${esc(st.steamId)}</span></div>
        <div class="acct-note">Some paid mods are locked to your Steam account — creators ask for this Steam ID when you buy.</div>`
      : `<div class="acct-sub muted">Steam isn't signed in on this PC.</div>`}</div>
    ${st.found ? `<button class="btn btn-sm" data-act="copy-steamid">${icon('copy')}Copy Steam ID</button>` : ''}</div>`;
  const shopCards = S.accounts.shops.map((s) => `<div class="acct">
    <div class="acct-logo">${icon('cart')}</div>
    <div class="acct-txt"><div class="acct-name">${esc(s.name)}</div>
      ${s.account.signedIn ? `<div class="acct-sub"><span class="ok-dot"></span>Signed in as <b>${esc(s.account.user)}</b></div>` : `<div class="acct-sub muted">Sign in to see and install the mods you've bought.</div>`}</div>
    ${s.account.signedIn ? `<button class="btn btn-sm btn-ghost" data-shop-signout="${s.id}">${icon('logout')}Sign out</button>` : `<button class="btn btn-sm btn-primary" data-shop-signin="${s.id}">${icon('key')}Sign in</button>`}</div>`).join('');
  return `<div class="accts">${steamCard}${shopCards}</div>
    <div class="muted" style="font-size:12px;margin-top:10px">${icon('info')} You sign in on each shop's own page inside the app. Your password goes only to the shop — the app never sees it.</div>`;
}

document.addEventListener('click', async (e) => {
  const si = e.target.closest('[data-shop-signin]');
  const so = e.target.closest('[data-shop-signout]');
  if (!si && !so) return;
  const id = (si || so).dataset[si ? 'shopSignin' : 'shopSignout'];
  if (si) {
    si.disabled = true; si.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>Waiting for sign-in…';
    const acct = await api.invoke('shops:signIn', id);
    toast(acct.signedIn ? `Signed in as <b>${esc(acct.user)}</b>` : 'Sign-in window closed', acct.signedIn ? 'ok' : 'info');
  } else {
    await api.invoke('shops:signOut', id);
    toast('Signed out', 'ok', 1800);
  }
  await refreshAccounts();
  if (S.shop) S.shop.owned = {};
  rerenderAccountsArea();
});

function rerenderAccountsArea() {
  $$('[data-accounts]').forEach((el) => { el.innerHTML = accountCardsHtml(); });
  if (isShop()) drawShops();
}

// ---------- shops ----------
S.shop = { id: 'hub', mode: 'store', query: '', cat: 0, sort: 'date', page: 0, totalPages: 1, total: 0, products: [], loading: false, cats: {}, owned: {}, req: 0 };

async function renderShops(c) {
  if (!S.accounts.shops.length) await refreshAccounts();
  c.innerHTML = `<div class="view" id="shopsView"><div class="main">
    <div class="toolbar" style="padding-top:10px"><div id="shopTabs"></div><div class="grow"></div><div id="shopAcct"></div></div>

    <div class="toolbar" id="shopBar" style="padding-top:6px"></div>
    <div class="chips" id="shopCats"></div>
    <div class="scroller" id="shopScroll"></div></div></div>`;
  drawShops();
  if (S.shop.mode === 'store' && !S.shop.products.length) shopLoad();
  if (S.shop.mode === 'owned') loadOwned();
}

function currentShop() { return S.accounts.shops.find((s) => s.id === S.shop.id) || { id: S.shop.id, name: '', account: { signedIn: false } }; }

function drawShops() {
  if (!$('#shopsView')) return;
  const sh = currentShop(), st = S.shop;
  $('#shopAcct').innerHTML = sh.account.signedIn
    ? `<div class="shop-account"><span class="shop-account-avatar">${icon('user')}</span><span class="shop-account-label"><strong>${esc(sh.account.user)}</strong><span>Signed in to ${esc(sh.name)}</span></span><button class="btn btn-sm" data-shop-signout="${sh.id}" title="Sign out of ${esc(sh.name)}">${icon('logout')}Sign out</button></div>`
    : `<button class="btn btn-primary" data-shop-signin="${sh.id}">${icon('key')}Sign in to ${esc(sh.name)}</button>`;
  $('#shopTabs').innerHTML = `<div class="seg-tabs" style="margin:0"><button class="${st.mode === 'store' ? 'active' : ''}" data-shop-mode="store">${icon('cart')}Store</button><button class="${st.mode === 'owned' ? 'active' : ''}" data-shop-mode="owned">${icon('installed')}My purchases</button></div>`;
  if (st.mode === 'store') {
    $('#shopBar').innerHTML = `<div class="search wide">${icon('search')}<input id="shopQ" placeholder="Search ${esc(sh.name)}…" value="${esc(st.query)}"></div>
      <select id="shopSort">${(st.id === 'hub' ? [['date', 'Newest'], ['popularity', 'Popular'], ['price', 'Price: low to high']] : [['date', 'Newest'], ['title', 'Title A–Z']]).map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="sub" id="shopCount">${st.total ? st.total.toLocaleString() + ' items' : ''}</span><div class="grow"></div>
      <button class="btn btn-ghost" data-open="${esc(sh.url)}">${icon('external')}Open site</button>`;
    $('#shopQ').addEventListener('input', debounce((e) => { st.query = e.target.value.trim(); shopReset(); }, 380));
    $('#shopSort').addEventListener('change', (e) => { st.sort = e.target.value; shopReset(); });
    const cats = st.cats[st.id];
    if (!cats) api.invoke('shops:cats', st.id).then((cs) => { st.cats[st.id] = cs; drawShops(); }).catch(() => {});
    $('#shopCats').innerHTML = (cats || []).map((c) => `<button class="chip ${c.id === st.cat ? 'active' : ''}" data-shop-cat="${c.id}">${esc(c.label)}</button>`).join('');
    drawShopGrid();
  } else {
    $('#shopBar').innerHTML = ''; $('#shopCats').innerHTML = '';
    drawOwned();
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-shop-tab]');
  if (t) { S.shop.id = t.dataset.shopTab; S.shop.cat = 0; S.shop.sort = 'date'; shopReset(true); if (S.shop.mode === 'owned') loadOwned(); return; }
  const m = e.target.closest('[data-shop-mode]');
  if (m) { S.shop.mode = m.dataset.shopMode; drawShops(); if (S.shop.mode === 'store' && !S.shop.products.length) shopLoad(); if (S.shop.mode === 'owned') loadOwned(); return; }
  const ct = e.target.closest('[data-shop-cat]');
  if (ct) { S.shop.cat = Number(ct.dataset.shopCat); shopReset(); return; }
  const p = e.target.closest('[data-product]');
  if (p) { const prod = S.shop.products.find((x) => String(x.id) === p.dataset.product); if (prod) openProduct(prod); }
});

function shopReset(redraw) {
  const st = S.shop;
  st.page = 0; st.totalPages = 1; st.products = []; st.total = 0; st.req++; st.error = null; st.loading = false;
  if (redraw) drawShops(); else { $$('#shopCats .chip').forEach((b) => b.classList.toggle('active', Number(b.dataset.shopCat) === st.cat)); }
  shopLoad();
}

async function shopLoad() {
  const st = S.shop;
  if (st.loading || st.page >= st.totalPages) return;
  st.loading = true;
  const req = st.req;
  drawShopGrid();
  try {
    const r = await api.invoke('shops:search', { shop: st.id, query: st.query, cat: st.cat, page: st.page + 1, sort: st.sort });
    if (req !== st.req) return;
    st.page = r.page; st.totalPages = r.totalPages; st.total = r.total;
    st.products.push(...r.products);
  } catch (e) { if (req === st.req) st.error = cleanErr(e); }
  if (req !== st.req) return;
  st.loading = false;
  if (isShop() && st.mode === 'store') { drawShopGrid(); fillPrices(); const n = $('#shopCount'); if (n) n.textContent = st.total ? st.total.toLocaleString() + ' items' : ''; }
}

function priceHtml(p) {
  if (p.price == null) return p.shop === 'mxbs' ? '<span class="price muted">…</span>' : '';
  if (p.price === 0) return '<span class="price free">Free</span>';
  return `<span class="price">${esc(p.currency)}${p.price.toFixed(2)}</span>`;
}

function ownedGroupFor(p) {
  const o = S.shop.owned[p.shop];
  if (!o || !o.groups) return null;
  return o.groups.find((g) => (g.prod && g.prod.link === p.link) || normName(g.title) === normName(p.title)) || null;
}
function productInstalled(p) { return haveMod({ shopKey: p.link, title: p.title }); }

function productCard(p, attr) {
  const owned = !!ownedGroupFor(p);
  const inst = productInstalled(p);
  const status = inst ? `<span class="badge ok">${icon('check')}Installed</span>` : owned ? `<span class="badge ok">${icon('check')}Owned</span>` : '';
  return `<div class="card" ${attr || `data-product="${p.id}"`}><div class="thumb">
      <div class="ph" style="--ph1:#3a2a1c;--ph2:#1c1c1e"><div class="ph-icon">${icon('cart')}</div><div class="ph-brand" style="font-size:16px">${esc(p.title.slice(0, 26))}</div></div>
      ${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="">` : ''}
      <div class="badges" data-price-of="${p.id}">${status || priceHtml(p)}</div></div>
    <div class="card-body"><div class="card-title" title="${esc(p.title)}">${esc(p.title)}</div>
      <div class="card-meta" data-creator-of="${p.id}">${esc(p.creator || (p.categories || []).slice(-1)[0] || '')}</div></div></div>`;
}

let shopObserver = null;
function drawShopGrid() {
  const sc = $('#shopScroll');
  if (!sc || S.shop.mode !== 'store') return;
  const st = S.shop;
  let html;
  if (st.products.length) html = `<div class="grid big">${st.products.map((p) => productCard(p)).join('')}</div>`;
  else if (st.error) html = `<div class="empty"><div>${icon('alert')}<h3>Couldn't load the shop</h3><div>${esc(st.error)}</div></div></div>`;
  else if (st.loading) html = `<div class="grid big">${Array.from({ length: 12 }, () => '<div class="card"><div class="thumb skeleton"></div><div class="card-body"><div class="skeleton" style="height:12px;border-radius:4px;width:70%"></div></div></div>').join('')}</div>`;
  else html = `<div class="empty"><div>${icon('search')}<h3>Nothing found</h3></div></div>`;
  if (st.page < st.totalPages && st.products.length) html += `<div class="loadmore" id="shopMore"><div class="spinner"></div></div>`;
  const top = sc.scrollTop; sc.innerHTML = html; sc.scrollTop = top;
  if (shopObserver) shopObserver.disconnect();
  const more = $('#shopMore');
  if (more) { shopObserver = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) shopLoad(); }, { root: sc, rootMargin: '700px' }); shopObserver.observe(more); }
}

// MX Bikes Shop only shows prices on product pages: fill them in a few at a time.
let pricing = false;
async function fillPrices() {
  if (pricing) return;
  pricing = true;
  const queue = () => S.shop.products.filter((p) => p.shop === 'mxbs' && p.price == null && !p._priced);
  const worker = async () => {
    for (let p = queue()[0]; p; p = queue()[0]) {
      p._priced = true;
      try {
        const d = await api.invoke('shops:details', 'mxbs', p.link);
        p.price = d.price; p.creator = d.creator; p.images = d.images;
        const b = $(`[data-price-of="${p.id}"]`);
        if (b && !productInstalled(p) && !ownedGroupFor(p)) b.innerHTML = priceHtml(p);
        const cr = $(`[data-creator-of="${p.id}"]`); if (cr && p.creator) cr.textContent = p.creator;
      } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  pricing = false;
}

function descToHtml(html) {
  // Render shop descriptions as plain text paragraphs (no site HTML is injected).
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const blocks = [...doc.body.querySelectorAll('p, li, h2, h3, h4')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!blocks.length) { const t = doc.body.textContent.trim(); return t ? `<p>${esc(t)}</p>` : ''; }
  return blocks.map((t) => `<p>${esc(t)}</p>`).join('');
}

async function openProduct(p, files) {
  const sh = currentShop();
  const group = files ? { files } : ownedGroupFor(p);
  const m = modal({ title: esc(p.title), body: `<div class="loadmore"><div class="spinner"></div></div>`, foot: `<span class="grow">${esc(sh.name)}</span>${p.link ? `<button class="btn" data-open="${esc(p.link)}">${icon('external')}Open in my browser</button>` : ''}` });
  let d = {};
  let imgs = [], detailError = '';
  const renderDetails = () => {
  if (!m.isConnected) return;
  const footer = $('.modal-foot', m);
  if (footer) footer.innerHTML = `<span class="grow">${esc(sh.name)}</span>${p.link ? `<button class="btn" data-open="${esc(p.link)}">${icon('external')}Open store page</button>` : ''}`;
  if (d.price != null && p.price == null) p.price = d.price;
  if (d.creator && !p.creator) p.creator = d.creator;
  imgs = [...new Set([...(p.images || []), ...(d.images || []), p.image].filter(Boolean))].slice(0, 16);
  const installed = productInstalled(p);
  let box;
  if (group) {
    box = `<div class="section-title">You own this</div><div class="dl-list">${group.files.map((f, i) => {
      const done = installed || haveMod({ shopKey: f.url, title: f.file, urls: [f.url] });
      return `<div class="dl"><div class="info"><div class="label">${esc(f.file || f.title)}</div><div class="host">${esc(sh.name)}</div></div>
        ${done ? `<span class="have">${icon('check')}Installed</span>` : `<button class="btn btn-primary" data-own-file="${i}">${icon('download')}Install</button>`}</div>`;
    }).join('')}</div>`;
  } else if (installed) {
    box = `<div class="buy-box"><span class="have">${icon('check')}Installed</span><span class="muted" style="font-size:12.5px">You already have this mod.</span></div>`;
  } else {
    box = `<div class="buy-box"><div class="buy-price">${p.price == null ? '—' : p.price === 0 ? 'Free' : esc(p.currency) + p.price.toFixed(2)}</div>
        <button class="btn btn-primary" data-buy="${esc(p.link)}">${icon('cart')}${p.price === 0 ? 'Get it' : 'Buy'}</button></div>
      <div class="muted" style="font-size:12px;margin-top:10px">Opens ${esc(sh.name)}'s own checkout${sh.account.signedIn ? ` (signed in as <b>${esc(sh.account.user)}</b>)` : ''}. After buying it shows up in <b>My purchases</b> — or click its download button and it installs automatically.</div>`;
  }
  $('.modal-body', m).innerHTML = `<div class="post">
    <div><div class="gallery-main"><img id="pgMain" src="${esc(imgs[0] || '')}" data-keep="1" alt=""></div>
      ${imgs.length > 1 ? `<div class="gallery-strip">${imgs.map((u, i) => `<img src="${esc(u)}" data-pg="${i}" class="${i === 0 ? 'active' : ''}" data-keep="1" loading="lazy">`).join('')}</div>` : ''}
      <div class="desc">${descToHtml(d.description || p.description || p.summary) || '<p class="muted">This store has not supplied a description here. Use the store-page button for its full listing.</p>'}${detailError ? `<p class="muted">${esc(detailError)}</p>` : ''}</div></div>
    <div><h2>${esc(p.title)}</h2>
      <div class="post-meta">${p.creator ? `<span>${icon('user')}${esc(p.creator)}</span>` : ''}<span>${icon('cart')}${esc(sh.name)}</span></div>
      <div class="tags">${(p.categories || []).map((n) => `<span class="tag">${esc(n)}</span>`).join('')}</div>
      ${box}
    </div></div>`;
  };
  renderDetails();
  $('.modal-body', m).addEventListener('click', async (e) => {
    const g = e.target.closest('[data-pg]');
    if (g) { $('#pgMain', m).src = imgs[Number(g.dataset.pg)]; $$('[data-pg]', m).forEach((x) => x.classList.toggle('active', x === g)); }
    const b = e.target.closest('[data-buy]');
    if (b) api.invoke('shops:open', p.shop, b.dataset.buy);
    const of = e.target.closest('[data-own-file]');
    if (of) {
      of.outerHTML = `<span class="have">${icon('download')}Downloading…</span>`;
      await installOwned(group.files[Number(of.dataset.ownFile)], p);
    }
  });
  try {
    if (!p.link) {
      const found = await api.invoke('shops:lookup', p.shop, [{ key: 'detail', title: p.title, productId: p.productId }]);
      if (found.detail) Object.assign(p, found.detail);
    }
    if (p.link) d = await api.invoke('shops:details', p.shop, p.link);
  } catch (e) { detailError = `Store details could not be refreshed: ${cleanErr(e)}`; }
  renderDetails();
}

async function loadOwned(force) {
  const st = S.shop;
  const id = st.id;
  if (!force && st.owned[id]) { drawOwned(); return; }
  const previous = st.owned[id];
  const request = Symbol('purchases');
  st.owned[id] = { ...(previous || {}), loading: true, error: null, request };
  drawOwned();
  try {
    const o = await api.invoke('shops:owned', id, !!force);
    if (st.owned[id].request !== request) return;
    // one card per product (a product can have several files)
    const groups = new Map();
    for (const it of o.items || []) {
      const key = it.product || normName(it.title);
      if (!groups.has(key)) groups.set(key, { key, title: it.title, product: it.product, productId: it.productId, files: [] });
      groups.get(key).files.push(it);
    }
    o.groups = [...groups.values()];
    for (const g of o.groups) g.prod = { shop: id, id: g.key, title: g.title, link: g.product, productId: g.productId, image: null, categories: [], description: '' };
    st.owned[id] = o;
    if (isShop() && st.id === id) drawShops();
    o.enriching = !!o.groups.length;
    for (let offset = 0; offset < o.groups.length; offset += 12) {
      const batch = o.groups.slice(offset, offset + 12);
      const found = await api.invoke('shops:lookup', id, batch.map((g) => ({ key: g.key, product: g.product, productId: g.productId, title: g.title }))).catch(() => ({}));
      if (st.owned[id] !== o) return;
      for (const g of batch) if (found[g.key]) g.prod = found[g.key];
      if (isShop() && st.id === id && st.mode === 'owned') drawOwned();
    }
    o.enriching = false;
    st.owned[id] = o;
  } catch (e) { st.owned[id] = { ...(previous || {}), loading: false, error: cleanErr(e) }; }
  if (st.owned[id].expired) await refreshAccounts();
  if (isShop()) drawShops();
}

function drawOwned() {
  const sc = $('#shopScroll');
  if (!sc || S.shop.mode !== 'owned') return;
  const sh = currentShop();
  const o = S.shop.owned[S.shop.id];
  if (!sh.account.signedIn) {
    sc.innerHTML = `<div class="empty"><div>${icon('key')}<h3>Sign in to ${esc(sh.name)}</h3><div>See every mod you've bought and install it with one click.</div>
      <div style="margin-top:16px"><button class="btn btn-primary" data-shop-signin="${sh.id}">${icon('key')}Sign in</button></div></div></div>`;
    return;
  }
  if (!o || (o.loading && !o.groups?.length)) { sc.innerHTML = `<div class="loadmore"><div class="spinner"></div><span class="muted">Loading your purchases…</span></div>`; return; }
  if (o.error && !o.groups?.length) { sc.innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(o.error)} <button class="btn btn-sm" data-act="owned-refresh">Try again</button></div></div>`; return; }
  if (!o.groups || !o.groups.length) {
    sc.innerHTML = `<div class="empty"><div>${icon('cart')}<h3>No purchases yet</h3><div>Mods you buy on ${esc(sh.name)} as <b>${esc(sh.account.user)}</b> show up here.</div>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:center"><button class="btn" data-act="owned-refresh">${icon('refresh')}Refresh</button><button class="btn" data-buy-open="${esc(sh.url)}">${icon('external')}Open my account</button></div></div></div>`;
    return;
  }
  const notInstalled = o.groups.filter((g) => !productInstalled(g.prod)).length;
  sc.innerHTML = `<div class="filters" style="padding:0 0 14px"><span class="muted">${o.groups.length} mod${o.groups.length > 1 ? 's' : ''} on <b>${esc(sh.account.user)}</b>'s account</span><span class="grow"></span>
      ${o.enriching ? '<span class="muted">Loading pictures…</span>' : ''}
      <button class="btn" data-act="owned-refresh">${icon('refresh')}Refresh</button>
      ${notInstalled ? `<button class="btn btn-primary" data-act="owned-all">${icon('download')}Install ${notInstalled} not installed</button>` : `<span class="have">${icon('check')}All installed</span>`}</div>
    <div class="grid big">${o.groups.map((g, i) => productCard(g.prod, `data-owned-group="${i}"`)).join('')}</div>`;
}

async function installOwned(it, prod) {
  await api.invoke('jobs:start', { title: prod ? prod.title : it.title, url: it.url, shopKey: prod && prod.link ? prod.link : it.url, link: prod?.link || it.product || null, image: prod ? prod.image : null });
  toast(`Downloading <b>${esc(prod ? prod.title : it.title)}</b>…`, 'info', 2200);
}

document.addEventListener('click', async (e) => {
  const bo = e.target.closest('[data-buy-open]');
  if (bo) { api.invoke('shops:open', S.shop.id, bo.dataset.buyOpen); return; }
  const g = e.target.closest('[data-owned-group]');
  if (g) { const grp = S.shop.owned[S.shop.id].groups[Number(g.dataset.ownedGroup)]; openProduct(grp.prod, grp.files); }
});

// ---------- first-run setup ----------
const SETUP_STEPS = ['welcome', 'game', 'accounts', 'prefs', 'done'];
let setupStep = 0;

async function openSetup(start = 0) {
  setupStep = start;
  let el = $('#setup');
  if (!el) { el = document.createElement('div'); el.id = 'setup'; el.className = 'setup-overlay'; document.body.appendChild(el); }
  await refreshAccounts();
  drawSetup();
}

function drawSetup() {
  const el = $('#setup');
  const step = SETUP_STEPS[setupStep];
  const env = S.env, s = env.settings;
  const dots = SETUP_STEPS.map((_, i) => `<span class="sdot ${i === setupStep ? 'on' : i < setupStep ? 'done' : ''}"></span>`).join('');
  let body = '', next = 'Next';
  if (step === 'welcome') {
    body = `<div class="setup-hero"><span class="brand-mark" style="font-size:22px;padding:9px 12px 8px">MXB</span>
      <h1>Welcome to MX Bikes Manager</h1><p>Everything for your MX Bikes mods in one place. Let's get you set up — it takes a minute.</p></div>
      <div class="setup-feats">
        <div>${icon('library')}<b>Your mods</b><span>See every bike, track and piece of gear you have installed, with pictures.</span></div>
        <div>${icon('globe')}<b>One-click installs</b><span>Browse mxb-mods.com and install straight into the game.</span></div>
        <div>${icon('helmet')}<b>Your rider</b><span>Change helmet, kit, gloves and boots for each bike.</span></div>
        <div>${icon('cart')}<b>Paid mods</b><span>Browse the shops and install the mods you own.</span></div></div>`;
    next = 'Get started';
  } else if (step === 'game') {
    const row = (label, val, ok, which, hint) => `<div class="set-row"><div class="set-row-l"><b>${label}</b><span class="muted">${hint}</span></div>
      <div class="path-row"><div class="path">${ok ? `<span class="ok">${icon('check')}</span>` : `<span class="bad">${icon('alert')}</span>`}${esc(val || 'Not found')}</div><button class="btn" data-act="pick-${which}">Change…</button></div></div>`;
    body = `<h2 class="setup-h">Find your game</h2><p class="setup-p">We looked for MX Bikes automatically. Check these look right.</p>
      ${row('Mods folder', env.modsDir, env.modsFound, 'user', 'Where your mods live (Documents\\PiBoSo\\MX Bikes)')}
      ${row('Game install', s.gameInstallDir, !!env.gameExe, 'install', 'Used for the Launch button (your Steam library)')}
      ${env.modsFound ? `<div class="notice ok">${icon('check')}<div>Found <b>${S.items.length.toLocaleString()}</b> installed mods.</div></div>` : `<div class="notice warn">${icon('alert')}<div>Couldn't find your mods folder. Start MX Bikes once, or choose the folder.</div></div>`}`;
  } else if (step === 'accounts') {
    body = `<h2 class="setup-h">Link your accounts</h2><p class="setup-p">Optional — link the shops you buy mods from so your purchases show up ready to install. You can do this later in Settings.</p>
      <div data-accounts>${accountCardsHtml()}</div>`;
  } else if (step === 'prefs') {
    body = `<h2 class="setup-h">A couple of choices</h2><p class="setup-p">You can change these any time in Settings.</p>
      <div class="set-card" style="margin-bottom:10px"><label class="toggle"><input type="checkbox" data-pref="autoInstall" ${s.autoInstall ? 'checked' : ''}><span class="sw"></span><span><b>Install mods automatically</b><br><span class="muted">When the app is sure where a mod goes, it installs it straight away. Otherwise it asks.</span></span></label></div>
      <div class="set-card"><label class="toggle"><input type="checkbox" data-pref="autoImages" ${s.autoImages !== false ? 'checked' : ''}><span class="sw"></span><span><b>Find pictures for my mods</b><br><span class="muted">Fetch pictures for bikes and tracks from mxb-mods.com.</span></span></label></div>`;
  } else {
    body = `<div class="setup-hero">${icon('check').replace('class="ico ', 'style="width:64px;height:64px;color:var(--ok)" class="ico ')}<h1>You're all set</h1><p>Your library is ready. Have fun out there.</p></div>`;
    next = 'Open my library';
  }
  el.innerHTML = `<div class="setup-card"><div class="setup-top">${dots}${setupStep < SETUP_STEPS.length - 1 ? '<button class="btn btn-ghost btn-sm" data-setup="skip">Skip setup</button>' : ''}</div>
    <div class="setup-body">${body}</div>
    <div class="setup-foot">${setupStep > 0 && step !== 'done' ? '<button class="btn" data-setup="back">Back</button>' : '<span></span>'}<button class="btn btn-primary" data-setup="next">${next}</button></div></div>`;
}

document.addEventListener('change', async (e) => {
  const p = e.target.closest('[data-pref]');
  if (p) S.env = await api.invoke('settings:set', { [p.dataset.pref]: p.checked });
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-setup]');
  if (!b) return;
  const a = b.dataset.setup;
  if (a === 'back') { setupStep = Math.max(0, setupStep - 1); drawSetup(); return; }
  if (a === 'next' && setupStep < SETUP_STEPS.length - 1) { setupStep++; drawSetup(); return; }
  // finish or skip
  S.env = await api.invoke('settings:set', { setupDone: true });
  $('#setup').remove();
  go('library');
  if (S.env.modsFound) { await rescan(true); setTimeout(backgroundImages, 1000); }
});

// ---------- installed / updates ----------
async function renderInstalled(c) {
  S.installs = await api.invoke('installs:list');
  const recs = Object.entries(S.installs).sort((a, b) => b[1].installedAt - a[1].installedAt);
  const upd = new Map((S.updates || []).map((u) => [u.id, u]));
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>Downloads</h2>${dlTabs("updates")}<span class="sub">${recs.length} installed with this app</span><div class="grow"></div>
      <button class="btn btn-primary" data-act="check-updates">${icon('refresh')}Check for updates</button></div>
    <div class="scroller"><div class="jobs">
      ${S.updates && !S.updates.length ? `<div class="notice ok">${icon('check')}<div>Everything is up to date.</div></div>` : ''}
      ${S.updates && S.updates.length ? `<div class="notice warn">${icon('refresh')}<div>${S.updates.length} mod${S.updates.length > 1 ? 's have' : ' has'} been updated on mxb-mods.com since you installed ${S.updates.length > 1 ? 'them' : 'it'}.</div></div>` : ''}
      ${recs.length ? recs.map(([key, r]) => {
        const u = r.postId && upd.get(r.postId);
        return `<div class="inst ${u ? 'update' : ''}">${r.image ? `<img src="${esc(r.image)}" alt="">` : '<div class="noimg"></div>'}
          <div style="min-width:0"><div class="t">${esc(r.title)}</div><div class="m">${r.files.length} file(s) · installed ${timeAgo(r.installedAt)}${u ? ` · <span style="color:var(--accent-2)">updated ${fmtDate(u.modified)}</span>` : ''}</div>
            <div class="m mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.files.slice(0, 3).join(', '))}${r.files.length > 3 ? '…' : ''}</div></div>
          <div class="jactions">${u ? `<button class="btn btn-primary btn-sm" data-update="${r.postId}">${icon('download')}Update</button>` : ''}
            ${r.link ? `<button class="btn btn-sm" data-open="${esc(r.link)}">${icon('external')}Page</button>` : ''}
            <button class="btn btn-sm btn-danger" data-uninstall="${esc(key)}">${icon('trash')}Uninstall</button></div></div>`;
      }).join('') : `<div class="empty"><div>${icon('refresh')}<h3>Nothing installed via Manager yet</h3><div>Mods you install from the Browse tab are tracked here so you can update or cleanly uninstall them.</div></div></div>`}
    </div></div></div></div>`;
}

document.addEventListener('click', async (e) => {
  const u = e.target.closest('[data-update]');
  if (u) {
    u.disabled = true;
    try {
      const p = await api.invoke('site:post', Number(u.dataset.update));
      const dl = p.downloads.find((d) => /default|recommended/i.test(d.flag)) || p.downloads[0];
      if (!dl) throw new Error('No download link on the mod page');
      await startDownload(p, dl);
      S.updates = (S.updates || []).filter((x) => x.id !== p.id);
    } catch (err) { toast(esc(err.message), 'err'); u.disabled = false; }
    return;
  }
  const un = e.target.closest('[data-uninstall]');
  if (un) {
    const rec = S.installs[un.dataset.uninstall];
    if (!(await confirmBox('Uninstall', `Move the ${rec.files.length} file(s) installed for <b>${esc(rec.title)}</b> to the Recycle Bin?`, 'Uninstall', true))) return;
    await api.invoke('installs:uninstall', un.dataset.uninstall);
    await refreshInstalledIds();
    toast('Uninstalled', 'ok');
    renderInstalled($('#content'));
    rescan(true);
  }
});

// ---------- settings ----------
async function renderSettings(c) {
  if (!S.accounts.shops.length) await refreshAccounts();
  const env = S.env, s = env.settings;
  const pathRow = (val, ok, which) => `<div class="path-row"><div class="path">${ok ? `<span class="ok">${icon('check')}</span>` : `<span class="bad">${icon('alert')}</span>`}${esc(val || 'Not found')}</div>
    <button class="btn" data-act="pick-${which}">Change…</button>${val ? `<button class="btn btn-icon" data-folder="${which}" title="Open">${icon('folder')}</button>` : ''}</div>`;
  const t = env.tools;
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Settings</h2></div><div class="scroller"><div class="settings">
    <div class="set-card"><h3>MX Bikes user folder</h3><p>Where your mods, profiles and replays live. Detected automatically from your Documents folder.</p>
      ${pathRow(s.gameUserDir, env.modsFound, 'user')}
      <div class="muted mono" style="margin-top:8px">mods: ${esc(env.modsDir)}</div></div>
    <div class="set-card"><h3>Game install folder</h3><p>Detected from your Steam libraries. Used for the Launch button.</p>
      ${pathRow(s.gameInstallDir, !!env.gameExe, 'install')}
      ${env.gameExe ? `<div class="muted mono" style="margin-top:8px">${esc(env.gameExe)}</div>` : `<div class="muted" style="margin-top:8px">No game exe found — Launch will start the game through Steam.</div>`}
      <div style="margin-top:12px"><button class="btn" data-act="redetect">${icon('refresh')}Re-detect both folders</button></div></div>
    <div class="set-card"><h3>Accounts</h3><p>Link the shops you buy mods from, and see the Steam account used for account-locked mods.</p><div data-accounts>${accountCardsHtml()}</div></div>
    <div class="set-card"><h3>Installing</h3><p>When the manager is sure where a download belongs, it can install it straight away. Otherwise it asks you to review.</p>
      <label class="toggle"><input type="checkbox" id="autoInstall" ${s.autoInstall ? 'checked' : ''}><span class="sw"></span><span>Install automatically when the destination is certain</span></label></div>
    <div class="set-card"><h3>Pictures</h3><p>Bike files are encrypted, so their pictures come from mxb-mods.com. The app finds one for each bike/track without a picture, in the background. You can change any picture from its details panel.</p>
      <label class="toggle"><input type="checkbox" id="autoImages" ${s.autoImages !== false ? 'checked' : ''}><span class="sw"></span><span>Automatically find pictures for my mods</span></label></div>
    <div class="set-card"><h3>Extraction tools</h3><p>Used to unpack .zip / .rar / .7z downloads.</p>
      <div class="tool-list">
        <div>${t.sevenZip ? `<span style="color:var(--ok)">${icon('check')}</span>7-Zip <span class="muted mono">${esc(t.sevenZip)}</span>` : `<span style="color:var(--warn)">${icon('alert')}</span>7-Zip not found — <a href="#" data-open="https://www.7-zip.org/">get 7-Zip</a> for best .rar/.7z support`}</div>
        <div>${t.unrar ? `<span style="color:var(--ok)">${icon('check')}</span>WinRAR UnRAR <span class="muted mono">${esc(t.unrar)}</span>` : `<span class="muted">${icon('info')}</span><span class="muted">WinRAR not installed (optional)</span>`}</div>
        <div>${t.tar ? `<span style="color:var(--ok)">${icon('check')}</span>Windows built-in tar <span class="muted mono">${esc(t.tar)}</span>` : ''}</div>
      </div></div>
    <div class="set-card"><h3>Disabled mods</h3><p>Disabling a mod moves it here so the game stops loading it. Enabling moves it back. Nothing is deleted.</p>
      <div class="path-row"><div class="path">${esc(env.disabledDir)}</div><button class="btn btn-icon" data-folder="disabled" title="Open">${icon('folder')}</button></div></div>
    <div class="set-card"><h3>Setup</h3><p>Go through the welcome setup again.</p><button class="btn" data-act="run-setup">${icon('sparkle')}Run setup again</button></div>
    <div class="set-card"><h3>About</h3><p>MX Bikes Manager ${esc(env.version)} · Mods are browsed from <a href="#" data-open="https://mxb-mods.com">mxb-mods.com</a>. Please support mod creators — rate and thank them on the site.</p></div>
  </div></div></div></div>`;
  $('#autoInstall').addEventListener('change', async (e) => { S.env = await api.invoke('settings:set', { autoInstall: e.target.checked }); });
  $('#autoImages').addEventListener('change', async (e) => { S.env = await api.invoke('settings:set', { autoImages: e.target.checked }); if (e.target.checked) backgroundImages(); });
}

// ---------- global actions ----------
document.addEventListener('click', async (e) => {
  const o = e.target.closest('[data-open]');
  if (o) { e.preventDefault(); api.invoke('open:external', o.dataset.open); return; }
  const ext = e.target.closest('a[data-external]');
  if (ext) { e.preventDefault(); api.invoke('open:external', ext.getAttribute('href')); return; }
  const f = e.target.closest('[data-folder]');
  if (f) { api.invoke('open:folder', f.dataset.folder); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  const it = S.drawerId && S.items.find((i) => i.id === S.drawerId);
  switch (act) {
    case 'profile-create': createProfileDialog(); break;
    case 'profile-activate': {
      try { const result = await api.invoke('rider:activateProfile', S.rider.profile); S.rider.activeProfile = result.name; await renderRider($('#content')); toast('Profile selected for your next ride', 'ok'); }
      catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
      break;
    }
    case 'rescan': await rescan(); break;
    case 'close-drawer': closeDrawer(); break;
    case 'enable': case 'disable': {
      const r = await api.invoke('library:enable', [it.id], act === 'enable');
      if (r.errors.length) toast(esc(r.errors.join('\n')), 'err', 6000); else toast(`${esc(it.title)} ${act}d`, 'ok', 1800);
      S.drawerId = (act === 'enable' ? 'E:' : 'D:') + it.key;
      await rescan(true);
      break;
    }
    case 'fav': await api.invoke('library:favorite', it.key, !it.favorite); await rescan(true); break;
    case 'reveal': api.invoke('library:reveal', it.id); break;
    case 'delete': {
      const riderNote = it.group === 'rider' && it.sub === 'riders' ? '<p>Its gear folder is included. Profiles using this model will switch to the default rider, with backups.</p>' : '';
      if (!(await confirmBox('Delete mod', `Move <b>${esc(it.title)}</b> (${fmtSize(it.size)}) to the Recycle Bin?${riderNote}<div class="mono muted" style="margin-top:8px">${it.parts.map(esc).join('<br>')}</div>`, 'Move to Recycle Bin', true))) return;
      const r = await api.invoke('library:trash', [it.id]);
      if (r.errors.length) toast(esc(r.errors.join('\n')), 'err', 6000); else toast('Moved to Recycle Bin', 'ok');
      closeDrawer(); await rescan(true);
      break;
    }
    case 'find-image': openImagePicker(it); break;
    case 'pick-image': if (await api.invoke('library:pickImage', it.key)) { S.imgVer[it.key] = Date.now(); await rescan(true); } break;
    case 'clear-image': await api.invoke('library:clearImage', it.key); S.imgVer[it.key] = Date.now(); await rescan(true); break;
    case 'install-local': await api.invoke('library:installLocal', it.id); closeDrawer(); go('downloads'); break;
    case 'paint-show': api.invoke('library:showFile', a.dataset.path); break;
    case 'paint-delete': {
      if (!(await confirmBox('Delete paint', 'Move this paint to the Recycle Bin?', 'Delete', true))) return;
      await api.invoke('library:trashFile', a.dataset.path);
      a.closest('.paint').remove();
      rescan(true);
      break;
    }
    case 'auto-images': autoFindImages(); break;
    case 'select-dupes': for (const x of libItems()) if (x.duplicateOf && x.duplicateExact) S.selected.add(x.id); renderLibItems(); break;
    case 'bulk-clear': S.selected.clear(); renderLibItems(); break;
    case 'bulk-all': for (const x of filterItems()) S.selected.add(x.id); renderLibItems(); break;
    case 'bulk-enable': case 'bulk-disable': {
      const r = await api.invoke('library:enable', [...S.selected], act === 'bulk-enable');
      if (r.errors.length) toast(esc(r.errors.slice(0, 4).join('<br>')), 'err', 7000); else toast(`${S.selected.size} mod(s) ${act === 'bulk-enable' ? 'enabled' : 'disabled'}`, 'ok');
      S.selected.clear(); await rescan(true);
      break;
    }
    case 'bulk-delete': {
      const sel = S.items.filter((x) => S.selected.has(x.id));
      const size = sel.reduce((s2, x) => s2 + x.size, 0);
      if (!(await confirmBox('Delete mods', `Move <b>${sel.length}</b> mod(s) (${fmtSize(size)}) to the Recycle Bin?${sel.some((i) => i.group === 'rider' && i.sub === 'riders') ? '<p>Deleting a rider model includes its gear folder. Profiles using it switch to the default rider, with backups.</p>' : ''}`, 'Move to Recycle Bin', true))) return;
      const r = await api.invoke('library:trash', [...S.selected]);
      if (r.errors.length) toast(esc(r.errors.slice(0, 4).join('<br>')), 'err', 7000); else toast(`Moved ${sel.length} mod(s) to the Recycle Bin`, 'ok');
      S.selected.clear(); await rescan(true);
      break;
    }
    case 'rider-pick-bike': {
      const R = S.rider;
      bikePicker({ current: R.bike, selectedInGame: R.bikes.find((b) => b.selected)?.id,
        onPick: (v) => { R.bike = v; renderRider($('#content')); } });
      break;
    }
    case 'rider-copy-all': {
      const R = S.rider;
      if (!(await confirmBox('Use this outfit on all bikes', `Copy the rider, helmet, goggles, kit, protector, gloves and boots from <b>${esc(bikeTitle(R.bike))}</b> to every installed bike?<br><br><span class="muted">Bike liveries stay as they are. A backup of your profile is kept.</span>`, 'Copy to all bikes'))) return;
      try { const r = await api.invoke('rider:copyToAll', R.profile, R.bike); toast(`Outfit copied to ${r.count} bikes`, 'ok'); }
      catch (err) { toast(esc(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')), 'err', 6000); }
      break;
    }
    case 'copy-steamid': navigator.clipboard.writeText(S.accounts.steam.steamId); toast('Steam ID copied', 'ok', 1600); break;
    case 'owned-refresh': loadOwned(true); break;
    case 'owned-all': {
      const groups = S.shop.owned[S.shop.id].groups.filter((g) => !productInstalled(g.prod));
      if (!(await confirmBox('Install purchases', `Download and install the <b>${groups.length}</b> mod${groups.length > 1 ? 's' : ''} you own but haven't installed yet?`, 'Install'))) return;
      for (const g of groups) for (const f of g.files) await installOwned(f, g.prod);
      go('downloads');
      break;
    }
    case 'run-setup': openSetup(0); break;
    case 'packs-refresh': renderPacks($('#content'), true); break;
    case 'open-site': api.invoke('open:external', 'https://mxb-mods.com'); break;
    case 'browse-more': browseLoad(); break;
    case 'browse-retry': browseReset(); break;
    case 'pick-user': case 'pick-install': S.env = await api.invoke('settings:pickFolder', act === 'pick-user' ? 'user' : 'install'); render(); if (S.env.modsFound) rescan(true); break;
    case 'redetect': S.env = await api.invoke('settings:redetect'); render(); if (S.env.modsFound) rescan(true); toast('Folders re-detected', 'ok', 1800); break;
    case 'clear-jobs': for (const j of [...S.jobs.values()]) if (['done', 'error'].includes(j.status)) { await api.invoke('jobs:dismiss', j.id); S.jobs.delete(j.id); } renderDownloads($('#content')); renderRail(); break;
    case 'check-updates': {
      a.disabled = true; a.innerHTML = `<div class="spinner" style="width:15px;height:15px"></div>Checking…`;
      try { S.updates = await api.invoke('installs:checkUpdates'); } catch (err) { toast(esc(err.message), 'err'); }
      renderRail(); renderInstalled($('#content'));
      break;
    }
    case 'pick-files': {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.accept = '.pkz,.pnt,.zip,.rar,.7z';
      input.onchange = () => installFiles([...input.files]);
      input.click();
      break;
    }
    default: break;
  }
});

$('#launchBtn').innerHTML = `${icon('play')}Launch MX Bikes`;
$('#launchBtn').addEventListener('click', async () => { try { await api.invoke('game:launch'); toast('Launching MX Bikes…', 'info', 2500); } catch (e) { toast(esc(cleanErr(e)), 'err', 4000); } });

// ---------- drag & drop install ----------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropzone').classList.add('show'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropzone').classList.remove('show'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('#dropzone').classList.remove('show');
  installFiles([...e.dataTransfer.files]);
});
async function installFiles(files) {
  const paths = files.map((f) => api.pathForFile(f)).filter((p) => /\.(pkz|pnt|zip|rar|7z)$/i.test(p));
  if (!paths.length) { toast('Drop .pkz, .pnt, .zip, .rar or .7z files', 'err'); return; }
  await api.invoke('jobs:startFiles', paths);
  go('downloads');
}
$('#dropzone .dz-icon').innerHTML = icon('download');

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = $$('.modal-wrap').pop();
    if (m) m.close(); else if (S.drawerId) closeDrawer(); else if (S.selected.size) { S.selected.clear(); renderLibItems(); }
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const s = $('#libSearch') || $('#brSearch');
    if (s) { s.focus(); s.select(); }
  }
});

// ---------- events from main ----------
api.on('jobs:update', (j) => {
  const prev = S.jobs.get(j.id);
  S.jobs.set(j.id, j);
  if (prev && prev.status !== j.status) {
    if (j.status === 'done') toast(`Installed <b>${esc(j.title)}</b>`, 'ok', 4500);
    if (j.status === 'error' && j.error !== 'Cancelled') toast(`<b>${esc(j.title)}</b>: ${esc(j.error)}`, 'err', 7000);
    if (j.status === 'browser') toast(`<b>${esc(j.title)}</b> needs the browser window — click its download button there.`, 'info', 6000);
    renderRail();
  } else if (!prev) renderRail();
  if (S.view === 'downloads') updateJobInPlace(j);
});
api.on('jobs:review', (id) => {
  const j = S.jobs.get(id);
  if (j) toast(`<b>${esc(j.title)}</b> is ready — review where it goes.`, 'info', 4000);
  if (!reviewOpen) openReview(id);
});
const onLibraryChanged = debounce(async () => {
  S.gearThumbs.clear();
  await refreshInstalledIds(); await rescan(true);
  S.packs = null;
  if (isFree()) renderBrowseGrid();
  if (isShop()) drawShops();
  if (S.view === 'packs') renderPacks($('#content'));
  if (S.view === 'game' && S.gameTab === 'health') renderHealth($('#content'));
}, 400);
api.on('library:changed', onLibraryChanged);

async function refreshInstalledIds() {
  S.installedIds = new Set(await api.invoke('site:installedIds'));
  S.instRecs = await api.invoke('installs:keys');
}

// ---------- "do I already have this?" ----------
const normName = (s) => String(s || '').toLowerCase().replace(/\.(pkz|zip|rar|7z|pnt)$/, '').replace(/\(\d+\)/g, '').replace(/\bv?\d+(\.\d+)+\b/g, '').replace(/[^a-z0-9]/g, '');
function buildNameIndex() {
  S.nameIndex = new Set();
  for (const i of S.items) { for (const n of [i.name, i.title, ...((i.info && i.info.layoutNames) || [])]) { const k = normName(n); if (k.length >= 4) S.nameIndex.add(k); } }
}
function fileNameOf(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    return parts.reverse().find((p) => /\.(pkz|zip|rar|7z|pnt)$/i.test(p)) || null;
  } catch { return null; }
}
// Is a track (by name) installed — mods or the game's built-in tracks, including alternate layouts?
function trackInstalled(name) {
  const n = normName(name);
  if (!n) return false;
  return S.items.some((i) => i.group === 'tracks' && !i.disabled && [i.name, i.title, ...((i.info && i.info.layoutNames) || [])].some((x) => normName(x) === n));
}
function haveMod({ postId, shopKey, title, urls = [] }) {
  if (postId && S.installedIds && S.installedIds.has(postId)) return true;
  // OEM packs that are fully up to date count as installed
  if (postId && (S.packs || []).some((p) => p.post && p.post.id === postId && p.summary && !p.summary.needCount)) return true;
  if (shopKey && (S.instRecs || []).some((r) => r.shopKey === shopKey)) return true;
  if (!S.nameIndex) buildNameIndex();
  for (const u of urls) { const f = fileNameOf(u); if (f && S.nameIndex.has(normName(f))) return true; }
  const t = normName(title);
  return t.length >= 5 && S.nameIndex.has(t);
}
function updateFor(postId, modified) {
  const r = (S.instRecs || []).find((x) => x.postId === postId);
  return !!(r && r.siteModified && modified && new Date(modified) > new Date(r.siteModified));
}

// ---------- boot ----------
(async function boot() {
  S.env = await api.invoke('app:env');
  renderRail();
  render();
  api.invoke('site:tabs').then((t) => { S.tabs = t; if (isFree()) render(); });
  refreshInstalledIds();
  for (const j of await api.invoke('jobs:list')) S.jobs.set(j.id, j);
  if (S.env.modsFound) await rescan(true);
  setTimeout(() => api.invoke('packs:list').then((p) => {
    if (S.packs) return;
    S.packs = p; S.packsNeed = p.filter((x) => x.summary && x.summary.needCount && x.summary.have).length; renderRail();
  }).catch(() => {}), 2500);
  if (!S.env.settings.setupDone) openSetup(0);
  else if (S.env.modsFound) setTimeout(backgroundImages, 1500);
})();

api.on('shops:changed', async () => { await refreshAccounts(); rerenderAccountsArea(); });
api.on('jobs:started', () => { toast('Download started — it will install automatically', 'info', 2500); renderRail(); });

// ---------- Sideways-scrolling option bars ----------
// Chip rows and tab bars scroll horizontally when the window is narrow: the mouse wheel moves them
// sideways, the edges fade where there's more, and the selected option is kept in view.
(() => {
  const SEL = '.chips, .bigtabs, .seg-tabs';
  const fades = (el) => {
    const more = el.scrollWidth - el.clientWidth > 2;
    el.classList.toggle('hscroll-l', more && el.scrollLeft > 2);
    el.classList.toggle('hscroll-r', more && el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  };
  document.addEventListener('wheel', (e) => {
    const el = e.target.closest && e.target.closest(SEL);
    if (!el || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false });
  document.addEventListener('scroll', (e) => { if (e.target.matches && e.target.matches(SEL)) fades(e.target); }, true);
  const refresh = () => document.querySelectorAll(SEL).forEach((el) => {
    fades(el);
    const act = el.querySelector('.active');
    if (act && !el.dataset.hsSeen) { el.dataset.hsSeen = '1'; const l = act.offsetLeft - el.offsetLeft, r = l + act.offsetWidth; if (l < el.scrollLeft || r > el.scrollLeft + el.clientWidth) el.scrollLeft = l - 24; }
  });
  new MutationObserver(() => requestAnimationFrame(refresh)).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', refresh);
})();
