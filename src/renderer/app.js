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
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 260); }, ms);
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
  notifications: { notifications: [], unread: 0 },
  apps: null,
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
  if (it.group === 'bikes' && it.bikePreview) return it.bikePreview;
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
  return `${placeholder(it)}${src ? `<img ${it.group === 'bikes' && src === it.bikePreview ? 'class="bike-render-thumb"' : ''} loading="lazy" decoding="async" src="${esc(src)}" alt="">` : ''}`;
}

document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('loaded'); }, true);
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG' && !e.target.dataset.keep) e.target.remove(); }, true);

// ---------- rail ----------
const VIEWS = [
  { id: 'library', label: 'My Mods', icon: 'library', hint: 'Everything installed in your game' },
  { id: 'get', label: 'Get Mods', icon: 'globe', hint: 'Browse and install free and paid mods' },
  { id: 'packs', label: 'OEM Packs', icon: 'layers', hint: 'Official bike packs and their updates' },
  { id: 'rider', label: 'Rider', icon: 'helmet', hint: 'Outfit, bike, livery and gear' },
  { id: 'game', label: 'Play', icon: 'play', hint: 'Pick a bike and track, then ride' },
  { id: 'graphics', label: 'Graphics', icon: 'sparkle', hint: 'Graphics mods and game graphics settings' },
  { id: 'online', label: 'Online', icon: 'signal', hint: 'Live servers, ranked and hosting' },
  { id: 'friends', label: 'Friends', icon: 'users', hint: 'Friends, outfit sync and status' },
];
// Soft blurred image behind the whole window (for example the mod being viewed).
const ambientStack = [];
function setAmbient(url) {
  const el = document.getElementById('ambientImg'); if (!el) return;
  if (!url) { el.classList.remove('show'); return; }
  const img = new Image();
  img.onload = () => { el.style.backgroundImage = `url("${String(url).replace(/["\\]/g, '')}")`; el.classList.add('show'); };
  img.src = url;
}
function pushAmbient(url) { ambientStack.push(url || null); setAmbient(url); }
function popAmbient() { ambientStack.pop(); setAmbient(ambientStack[ambientStack.length - 1]); }
function renderRail() {
  const rail = $('#rail');
  const previousScroll = rail.scrollLeft;
  const active = [...S.jobs.values()].filter((j) => !['done', 'error'].includes(j.status)).length;
  const review = [...S.jobs.values()].filter((j) => j.status === 'review' || j.status === 'browser').length;
  const upd = (S.updates && S.updates.length) || 0;
  const packUpd = S.packsNeed || 0;
  const btn = (v, badge) => `<button class="rail-btn ${S.view === v.id ? 'active' : ''}" data-view="${v.id}" title="${esc(v.label + ' — ' + v.hint)}">${icon(v.icon)}<span>${v.label}</span>${badge ? `<span class="rail-badge">${badge}</span>` : ''}</button>`;
  rail.innerHTML = '<span class="rail-ind" aria-hidden="true"></span>' + VIEWS.map((v) => btn(v, v.id === 'packs' ? (packUpd || '') : '')).join('');
  rail.scrollLeft = previousScroll;
  const revealActive = railView !== S.view;
  railView = S.view;
  moveRailIndicator(revealActive);
  const dl = review || active || upd || '';
  const steam = S.accounts?.steam;
  const activeUsers = S.live?.status?.service?.activeUsers;
  $('#railAccount').innerHTML = `<button class="top-web-link" data-open="https://coremx.app/#/" title="Open coremx.app">${icon('globe')}<span>coremx.app</span></button>`
    + `<span class="top-active-users" id="activeUsersCount" title="People active in CoreMX in the last two minutes"><i></i><span>${Number.isInteger(activeUsers) ? `${activeUsers} online` : 'Online —'}</span></span>`
    + `<button class="top-icon ${S.view === 'downloads' ? 'active' : ''}" data-view="downloads" title="Downloads & updates">${icon('download')}${dl ? `<span class="rail-badge">${dl}</span>` : ''}</button>`
    + `<button class="top-icon ${S.view === 'settings' ? 'active' : ''}" data-view="settings" title="Settings">${icon('settings')}</button>`
    + `<button class="top-icon" data-help title="Help for this page">${icon('info')}</button>`
    + `<button class="top-icon" data-notifications title="Mod notifications">${icon('bell')}${S.notifications.unread ? `<span class="rail-badge">${S.notifications.unread}</span>` : ''}</button>`
    + `<button class="top-avatar" data-view="friends" title="${esc((steam?.name || 'Steam account') + ' — friends, sync & status')}">${steam?.avatarData ? `<img src="${esc(steam.avatarData)}" alt="">` : icon('steam')}</button>`;
}
// The white pill behind the current page slides between nav items.
let railInd = null, railView = null;
function moveRailIndicator(revealActive = false) {
  const rail = $('#rail'), ind = $('.rail-ind', rail), on = $('.rail-btn.active', rail);
  if (!ind) return;
  if (!on) { ind.style.opacity = '0'; railInd = null; return; }
  const place = (x, w) => { ind.style.transform = `translateX(${x}px)`; ind.style.width = `${w}px`; };
  ind.style.transition = 'none';
  if (railInd) place(railInd.x, railInd.w); else place(on.offsetLeft, on.offsetWidth);
  ind.style.opacity = '1';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ind.style.transition = '';
    place(on.offsetLeft, on.offsetWidth);
    railInd = { x: on.offsetLeft, w: on.offsetWidth };
    if (revealActive) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }));
}
window.addEventListener('resize', () => { railInd = null; moveRailIndicator(true); });
$('#rail').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
$('#rail').addEventListener('wheel', (e) => {
  const rail = e.currentTarget;
  if (rail.scrollWidth <= rail.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  e.preventDefault();
  rail.scrollLeft += e.deltaY;
}, { passive: false });
$('#railAccount').addEventListener('click', (e) => { if (e.target.closest('[data-notifications]')) { openNotifications(); return; } const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });

function go(view) {
  const previousView = S.view;
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
  if (view === 'friends' && previousView !== 'friends') {
    S.live.friendsNext = 0;
    S.live.friendsLoading = true;
    refreshLiveList('friends', true).finally(() => {
      S.live.friendsLoading = false;
      if (S.view === 'friends') renderFriends($('#content'));
    });
  }
  document.body.dataset.view = view;
  closeDrawer();
  renderRail();
  render();
  if (typeof maybeShowTip === 'function' && previousView !== view) maybeShowTip(view);
}

function render() {
  const c = $('#content');
  if (!S.env.modsFound && S.view !== 'settings') return renderSetup(c);
  if (S.view === 'library') renderLibrary(c);
  else if (S.view === 'rider') renderRider(c);
  else if (S.view === 'get') renderGet(c);
  else if (S.view === 'packs') renderPacks(c);
  else if (S.view === 'online') renderOnline(c);
  else if (S.view === 'friends') renderFriends(c);
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
// A number of older downloads put every colourway beside the model as a loose
// .pnt file.  My Gear presents those as one item, then lets the player open
// the colourways on demand instead of filling the library with near-identical
// cards.  We only combine an unmistakable colour/edition suffix and only when
// there are two or more matching files, so ordinary single-file gear remains
// exactly as installed.
const PAINT_VARIANT_WORDS = new Set('black white red blue green yellow orange purple pink grey gray silver gold aqua teal cyan lime maroon navy brown tan sand chrome carbon camo monster fire glow mirror matte gloss bright dark light classic factory stock default edition team'.split(' '));
function gearFamilyBase(it) {
  if (it.group !== 'rider' || it.kind !== 'pnt' || !['helmets', 'paints', 'gloves', 'boots', 'boots paints', 'protections', 'goggles'].includes(gearName(it))) return '';
  const words = it.title.replace(/\.[^.]+$/, '').trim().split(/\s+/);
  let cut = 0;
  while (words.length - cut > 2 && PAINT_VARIANT_WORDS.has(words[words.length - 1 - cut].toLowerCase())) cut++;
  return cut ? words.slice(0, -cut).join(' ') : '';
}
function compactGearItems(items) {
  if (S.lib.scope !== 'rider') return items;
  const families = new Map();
  for (const it of items) {
    const base = gearFamilyBase(it);
    if (!base) continue;
    const key = `${it.sub}|${base.toLowerCase()}`;
    if (!families.has(key)) families.set(key, { base, items: [] });
    families.get(key).items.push(it);
  }
  const replace = new Map();
  for (const [key, f] of families) if (f.items.length > 1) {
    const preferred = f.items.find((i) => /\b(default|stock|black|white)\b/i.test(i.title)) || f.items[0];
    replace.set(key, { ...preferred, id: `family:${key}`, name: f.base, title: f.base, family: f.items, variantCount: f.items.length, paints: f.items.length });
  }
  const result = [], used = new Set();
  for (const it of items) {
    const base = gearFamilyBase(it), key = base && `${it.sub}|${base.toLowerCase()}`;
    if (!key || !replace.has(key)) { result.push(it); continue; }
    if (!used.has(key)) { result.push(replace.get(key)); used.add(key); }
  }
  return result;
}
const LIB_TABS = {
  mods: [
    { id: 'bikes', label: 'Bikes', icon: 'bike', match: (i) => i.group === 'bikes' },
    { id: 'tracks', label: 'Tracks', icon: 'track', match: (i) => i.group === 'tracks' },
    { id: 'other', label: 'Tyres & other', icon: 'tyre', match: (i) => ['tyres', 'misc', 'other'].includes(i.group) },
    { id: 'graphics', label: 'Graphics', icon: 'sparkle', match: () => false },
    { id: 'animations', label: 'Animations', icon: 'rider', match: () => false },
    { id: 'plugins', label: 'Plugins', icon: 'box', match: () => false },
    { id: 'apps', label: 'Apps', icon: 'settings', match: () => false },
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
    { id: 'synced', label: 'Synced from friends', icon: 'download', match: (i) => !!i.synced },
  ],
};
// Gear synced from other riders (and not installed by the player) is only listed under Synced from friends.
for (const t of LIB_TABS.rider) if (t.id !== 'synced') { const own = t.match; t.match = (i) => !i.synced && own(i); }
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

function filterItemsRaw() {
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
function filterItems() {
  return compactGearItems(filterItemsRaw());
}

function renderLibrary(c) {
  const scope = S.lib.scope || 'mods';
  S.lib.scope = scope;
  if (!LIB_TABS[scope].some((t) => t.id === S.lib.tab)) { S.lib.tab = LIB_TABS[scope][0].id; S.lib.f = {}; }
  if (!$('#libView') || $('#libView').dataset.scope !== scope) {
    c.innerHTML = `<div class="view" id="libView" data-scope="${scope}"><div class="main" style="position:relative">
      <div class="toolbar">${scope === 'rider' ? `<h2>Rider</h2>${riderTabsHtml('gear')}` : '<h2>My Mods</h2>'}<div class="grow"></div>
        <div class="search">${icon('search')}<input id="libSearch" placeholder="Search…  (Ctrl+F)" spellcheck="false"></div>
        <button class="btn btn-icon" data-act="rescan" title="Refresh list">${icon('refresh')}</button>
        <button class="btn btn-primary" data-act="pick-files">${icon('upload')}Add mod from PC</button></div>
      ${scope === 'mods' ? '<div class="lib-summary" id="libSummary"></div>' : ''}
      <div class="bigtabs" id="libTabs"></div>
      <div class="filters" id="libFilters"></div>
      <div class="scroller" id="libScroll"></div>
      <div class="bulkbar" id="bulkbar"></div></div></div>`;
    $('#libSearch').addEventListener('input', debounce((e) => { S.lib.query = e.target.value.trim(); S.lib.limit = 150; renderLibItems(); }, 120));
  }
  $('#libSearch').value = S.lib.query;
  renderLibItems();
  if (!S.gfx && !S.gfxLoading) S.gfxLoading = api.invoke('graphics:scan').then((g) => { S.gfx = g; if ($('#libTabs')) drawLibTabs(); }).catch(() => {}).finally(() => { S.gfxLoading = null; });
  if (!S.plugins && !S.pluginsLoading) S.pluginsLoading = api.invoke('plugins:scan').then((items) => { S.plugins = items; if ($('#libTabs')) drawLibTabs(); }).catch(() => {}).finally(() => { S.pluginsLoading = null; });
  if (!S.animations && !S.animationsLoading) S.animationsLoading = api.invoke('animations:scan').then((items) => { S.animations = items; if ($('#libTabs')) drawLibTabs(); }).catch(() => {}).finally(() => { S.animationsLoading = null; });
  if (!S.apps && !S.appsLoading) S.appsLoading = api.invoke('apps:list').then((items) => { S.apps = items; if ($('#libTabs')) drawLibTabs(); }).catch(() => {}).finally(() => { S.appsLoading = null; });
}

function bikePreviewStamp(item) { return `1|${item.key}|${item.size}|${item.mtime}|${item.kind}`; }
function bikePreviewPending() { return S.items.filter((item) => item.group === 'bikes' && !item.disabled && item.kind !== 'archive' && !item.bikePreview && !item.bikePreviewFailed); }
function drawBikePreviewProgress() {
  const sc = $('#libScroll');
  if (!sc || S.view !== 'library' || S.lib.scope !== 'mods' || S.lib.tab !== 'bikes') return;
  const progress = S.lib.bikePreviewProgress;
  sc.classList.toggle('bike-setup-running', !!progress && progress.first);
  const old = $('#bikePreviewProgress', sc);
  if (!progress) { old?.remove(); return; }
  const html = `<div class="bike-preview-progress ${progress.first ? 'first' : 'incremental'}" id="bikePreviewProgress" role="status">
    <span class="bike-preview-progress-icon">${icon('bike')}</span><div class="bike-preview-progress-copy"><b>${progress.first ? 'Preparing your bike gallery' : 'Rendering new bike images'}</b>
    <span>${progress.done} of ${progress.total} bikes processed${progress.failed ? ` · ${progress.failed} could not be previewed` : ''}</span>
    <progress value="${progress.done}" max="${progress.total || 1}"></progress></div></div>`;
  if (old) old.outerHTML = html; else sc.insertAdjacentHTML('afterbegin', html);
}
function showBikePreview(item) {
  const card = $(`[data-item="${CSS.escape(item.id)}"]`, $('#libScroll'));
  const box = card?.querySelector('.thumb');
  if (!item.bikePreview) return;
  if (box) {
    box.querySelectorAll('img').forEach((img) => img.remove());
    const img = document.createElement('img');
    img.className = 'bike-render-thumb'; img.alt = '';
    img.onload = () => img.classList.add('loaded');
    img.src = item.bikePreview;
    box.appendChild(img);
  }
  if (S.drawerId === item.id) openItem(item.id, true);
}
function startBikePreviews() {
  if (!S.scanned || S.lib.bikePreviewTask) { drawBikePreviewProgress(); return; }
  if (S.env?.settings?.setupDone === false) return;
  const pending = bikePreviewPending();
  if (!pending.length) return;
  const progress = S.lib.bikePreviewProgress = { first: !S.lib.bikePreviewsInitialized, done: 0, total: pending.length, failed: 0 };
  drawBikePreviewProgress();
  S.lib.bikePreviewTask = (async () => {
    if (!window.RiderViewer) await new Promise((resolve) => window.addEventListener('riderviewer-ready', resolve, { once: true }));
    for (const item of pending) {
      try {
        const model = await api.invoke('library:bikeThumbnailModel', item.key);
        if (!model?.parts?.length) throw new Error('No readable geometry');
        const image = await window.RiderViewer.thumb(model, 'full', 480);
        if (!image) throw new Error('Empty bike render');
        const url = await api.invoke('library:saveBikeThumbnail', item.key, bikePreviewStamp(item), image);
        const current = S.items.find((entry) => entry.key === item.key && bikePreviewStamp(entry) === bikePreviewStamp(item));
        for (const entry of [item, current].filter(Boolean)) { entry.bikePreview = url; entry.hasImage = true; }
        showBikePreview(current || item);
      } catch (error) {
        progress.failed++;
        item.bikePreviewFailed = true;
        const current = S.items.find((entry) => entry.key === item.key && bikePreviewStamp(entry) === bikePreviewStamp(item));
        if (current) current.bikePreviewFailed = true;
        await api.invoke('library:bikeThumbnailUnavailable', item.key, bikePreviewStamp(item)).catch(() => {});
      }
      progress.done++;
      drawBikePreviewProgress();
      // Keep navigation and card interactions responsive during a large first run.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (progress.first) {
      await api.invoke('library:finishBikeThumbnails').catch(() => {});
      S.lib.bikePreviewsInitialized = true;
    }
  })().finally(() => {
    S.lib.bikePreviewTask = null;
    S.lib.bikePreviewProgress = null;
    drawBikePreviewProgress();
    if (S.view === 'library' && S.lib.scope === 'mods' && S.lib.tab === 'bikes') renderLibItems();
    else if (bikePreviewPending().length) startBikePreviews();
  });
}

// At-a-glance strip for My Mods. Each tile is a shortcut to that list.
function drawLibSummary() {
  const box = $('#libSummary'); if (!box) return;
  const all = libItems();
  const n = { total: all.length, updates: (S.updates && S.updates.length) || 0, disabled: all.filter((i) => i.disabled).length, dups: all.filter((i) => i.duplicateOf).length, fav: all.filter((i) => i.favorite).length };
  const tile = (key, ic, value, label, hint, tone = '') => `<button class="sum-tile ${tone} ${S.lib.quick === key ? 'active' : ''}" data-libsum="${key}" ${!value && key !== 'all' && S.lib.quick !== key ? 'disabled' : ''} title="${esc(hint)}"><span class="sum-ico">${icon(ic)}</span><span class="sum-txt"><b>${value.toLocaleString()}</b><small>${label}</small></span></button>`;
  box.innerHTML = tile('all', 'library', n.total, 'Mods installed', 'Show everything')
    + tile('updates', 'download', n.updates, n.updates === 1 ? 'Update ready' : 'Updates ready', 'Open Downloads → Updates', n.updates ? 'accent' : '')
    + tile('disabled', 'power', n.disabled, 'Turned off', 'Mods you switched off (the game ignores them)')
    + tile('dups', 'dup', n.dups, 'Duplicate copies', 'Files downloaded twice; identical copies are safe to delete', n.dups ? 'warn' : '')
    + tile('fav', 'star', n.fav, 'Favorites', 'Mods you starred');
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-libsum]'); if (!t) return;
  const key = t.dataset.libsum;
  if (key === 'updates') { go('installed'); return; }
  S.lib.quick = S.lib.quick === key && key !== 'all' ? 'all' : key; S.lib.limit = 150; S.selected.clear(); S.lib.f = {};
  // The matches may be on another tab (e.g. a turned-off track while viewing bikes): jump there.
  if (!filterItems().length) {
    const keep = S.lib.tab;
    const hit = LIB_TABS.mods.find((t) => t.id !== 'graphics' && (S.lib.tab = t.id, filterItems().length));
    S.lib.tab = hit ? hit.id : keep;
  }
  renderLibItems(); const sc = $('#libScroll'); if (sc) sc.scrollTop = 0;
});
function drawLibTabs() {
  const all = libItems();
  $('#libTabs').innerHTML = LIB_TABS[S.lib.scope || 'mods'].map((t) => {
    const n = t.id === 'graphics' ? (S.gfx ? S.gfx.items.length + S.gfx.installed.length : '') : t.id === 'animations' ? (S.animations ? S.animations.length : '') : t.id === 'plugins' ? (S.plugins ? S.plugins.length : '') : t.id === 'apps' ? (S.apps ? S.apps.length : '') : compactGearItems(all.filter(t.match)).length;
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
  const base = compactGearItems(tabItems());
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
  else { bits.push(esc(it.label.replace(' · old layout', ''))); if (it.variantCount) bits.push(`${it.variantCount} colourways`); else if (it.paints) bits.push(`${it.paints} paints`); }
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
  if (currentTab().id === 'animations') {
    drawLibTabs(); $('#libFilters').innerHTML = ''; renderBulk();
    renderAnimationsInto($('#libScroll'));
    return;
  }
  if (currentTab().id === 'plugins') {
    drawLibTabs(); $('#libFilters').innerHTML = ''; renderBulk();
    renderPluginsInto($('#libScroll'));
    return;
  }
  if (currentTab().id === 'apps') {
    drawLibTabs(); $('#libFilters').innerHTML = ''; renderBulk();
    renderAppsInto($('#libScroll'));
    return;
  }
  if (currentTab().id === 'graphics') {
    // Graphics mods live in the game folder, not mods/ — shown as their own list
    drawLibTabs(); $('#libFilters').innerHTML = ''; renderBulk();
    renderGraphicsInto($('#libScroll'));
    return;
  }
  const xs = filterItems();
  drawLibTabs();
  drawLibSummary();
  drawLibFilters(xs.length);
  const sc = $('#libScroll');
  if (!S.scanned) { sc.innerHTML = `<div class="grid">${Array.from({ length: 12 }, () => '<div class="card"><div class="thumb skeleton"></div><div class="card-body"><div class="skeleton" style="height:12px;border-radius:4px;width:70%"></div></div></div>').join('')}</div>`; return; }
  if (!xs.length) {
    const filtered = S.lib.query || S.lib.quick !== 'all' || Object.values(S.lib.f).some(Boolean);
    sc.innerHTML = `<div class="empty"><div>${icon(filtered ? 'search' : 'box')}<h3>${filtered ? 'No matches' : 'Nothing here yet'}</h3><div>${filtered ? 'Try clearing a filter.' : currentTab().id === 'synced' ? 'Gear downloaded from friends and riders on your server appears here.' : 'Get some from <b>Get Mods</b>, or add a file from your PC.'}</div></div></div>`;
    renderBulk(); return;
  }
  const extra = [];
  if (currentTab().id === 'synced') extra.push(`<div class="notice warn">${icon('alert')}<div>Downloaded so you can see other riders' gear in game. These are <b>not complete mods</b>: a synced helmet, boots or rider model only has the paints that rider wears. They are not offered in Rider. To use one yourself, install the mod from <b>Get Mods</b>; it then moves to your own gear.</div></div>`);
  if (S.lib.quick === 'dups') extra.push(`<div class="notice warn">${icon('dup')}<div>These were downloaded twice (names ending in “(1)”). The ones marked Duplicate are identical copies — safe to delete. <button class="btn btn-sm" style="margin-left:6px" data-act="select-dupes">Select all identical copies</button></div></div>`);
  if (currentTab().id === 'bikes' && S.lib.bikePreviewsInitialized && !S.lib.bikePreviewTask) {
    const failed = S.items.filter((item) => item.group === 'bikes' && item.bikePreviewFailed).length;
    if (failed) extra.push(`<div class="notice info">${icon('info')}<div>${failed} bike${failed === 1 ? '' : 's'} could not be rendered in 3D. Their existing pictures are shown. <button class="btn btn-sm" data-act="retry-bike-previews">Retry previews</button></div></div>`);
  }
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
  startBikePreviews();
}

async function renderAppsInto(sc) {
  sc.innerHTML = '<div class="loadmore"><div class="spinner"></div></div>';
  try {
    S.apps = await api.invoke('apps:list');
    if (!sc.isConnected || S.lib.tab !== 'apps') return;
    drawLibTabs();
    sc.innerHTML = `<div class="srv-list" style="max-width:960px">${S.apps.map((item) => `<div class="srv"><div class="srv-ico">${icon(item.files ? 'folder' : 'settings')}</div><div class="srv-txt"><div class="t">${esc(item.title)}</div><div class="m">${item.files ? 'Files for making mods · ' : ''}Saved in Downloads · ${esc((item.folder ? 'CoreMX\\' + item.folder.split(/[\\/]/).pop() : item.path.split(/[\\/]/).pop()))}</div></div><div class="jactions"><button class="btn btn-sm btn-primary" data-run-app="${esc(item.id)}">${icon(item.files ? 'folder' : 'play')}${item.files ? 'Open folder' : 'Run'}</button><button class="btn btn-sm btn-danger" data-remove-app="${esc(item.id)}">${icon('trash')}Remove</button></div></div>`).join('') || '<div class="set-card muted">No downloaded applications yet.</div>'}</div><p class="muted" style="margin-top:12px">Run opens the publisher’s EXE (CoreMX never starts it on its own). Files for making mods, like fonts and paint templates, open in their folder.</p>`;
  } catch (error) { if (sc.isConnected) sc.innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(cleanErr(error))}</div></div>`; }
}
async function renderPluginsInto(sc) {
  sc.innerHTML = '<div class="loadmore"><div class="spinner"></div></div>';
  try {
    S.plugins = await api.invoke('plugins:scan');
    if (!sc.isConnected || S.lib.tab !== 'plugins') return;
    drawLibTabs();
    sc.innerHTML = `<div class="srv-list" style="max-width:960px">${S.plugins.map((item) => `<div class="srv"><div class="srv-ico">${icon('box')}</div><div class="srv-txt"><div class="t">${esc(item.title)}</div><div class="m">${item.enabled ? 'Enabled' : 'Disabled'} · ${esc(item.name)}${item.managed ? ' · Installed with CoreMX' : ''}</div></div><div class="jactions"><button class="btn btn-sm" data-reveal-plugin="${esc(item.name)}">${icon('folder')}Open folder</button><button class="btn btn-sm" data-toggle-plugin="${esc(item.name)}" data-enable="${item.enabled ? 'false' : 'true'}">${icon(item.enabled ? 'power' : 'check')}${item.enabled ? 'Disable' : 'Enable'}</button>${item.recordKey && item.enabled ? `<button class="btn btn-sm btn-danger" data-remove-plugin="${esc(item.recordKey)}">${icon('trash')}Remove</button>` : ''}</div></div>`).join('') || '<div class="set-card muted">No game plugins found.</div>'}</div>`;
  } catch (error) { if (sc.isConnected) sc.innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(cleanErr(error))}</div></div>`; }
}
async function renderAnimationsInto(sc) {
  sc.innerHTML = '<div class="loadmore"><div class="spinner"></div></div>';
  try {
    S.animations = await api.invoke('animations:scan');
    if (!sc.isConnected || S.lib.tab !== 'animations') return;
    drawLibTabs();
    sc.innerHTML = `<div class="srv-list" style="max-width:960px">${S.animations.map((item) => `<div class="srv"><div class="srv-ico">${icon('rider')}</div><div class="srv-txt"><div class="t">${esc(item.title)}</div><div class="m">${item.enabled ? 'Enabled' : 'Disabled'} · ${item.location === 'game' ? 'MX Bikes install folder' : 'MX Bikes mods folder'} · ${esc(item.name)}</div></div><div class="jactions"><button class="btn btn-sm" data-reveal-animation="${esc(item.id)}">${icon('folder')}Open folder</button><button class="btn btn-sm" data-toggle-animation="${esc(item.id)}" data-enable="${item.enabled ? 'false' : 'true'}">${icon(item.enabled ? 'power' : 'check')}${item.enabled ? 'Disable' : 'Enable'}</button>${item.recordKey ? `<button class="btn btn-sm btn-danger" data-remove-animation="${esc(item.recordKey)}">${icon('trash')}Remove</button>` : ''}</div></div>`).join('') || '<div class="set-card muted">No rider animations found in the game or mods folder.</div>'}</div>`;
  } catch (error) { if (sc.isConnected) sc.innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(cleanErr(error))}</div></div>`; }
}
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-toggle-animation]'); if (!button || button.disabled) return;
  button.disabled = true;
  try { const enabled = button.dataset.enable === 'true'; await api.invoke('animations:setEnabled', button.dataset.toggleAnimation, enabled); await renderAnimationsInto($('#libScroll')); toast(`Animation ${enabled ? 'enabled' : 'disabled'}. Restart MX Bikes to use the change.`, 'ok', 4000); }
  catch (error) { button.disabled = false; toast(esc(cleanErr(error)), 'err', 6000); }
});
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-reveal-animation]'); if (!button) return;
  try { await api.invoke('animations:reveal', button.dataset.revealAnimation); }
  catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
});
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-remove-animation]'); if (!button || !await confirmBox('Remove rider animation', 'Move unchanged files installed by CoreMX to the Recycle Bin?', 'Remove', true)) return;
  try { const result = await api.invoke('installs:uninstall', button.dataset.removeAnimation); await renderAnimationsInto($('#libScroll')); toast(result?.kept ? `${result.kept} changed file${result.kept === 1 ? '' : 's'} kept` : 'Animation moved to the Recycle Bin', result?.kept ? 'info' : 'ok', 5000); }
  catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
});
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-toggle-plugin]'); if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const enabled = button.dataset.enable === 'true';
    await api.invoke('plugins:setEnabled', button.dataset.togglePlugin, enabled);
    await renderPluginsInto($('#libScroll'));
    toast(`Plugin ${enabled ? 'enabled' : 'disabled'}. Restart MX Bikes to use the change.`, 'ok', 4000);
  } catch (error) { button.disabled = false; toast(esc(cleanErr(error)), 'err', 6000); }
});
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-reveal-plugin]'); if (!button) return;
  try { await api.invoke('plugins:reveal', button.dataset.revealPlugin); }
  catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
});
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-remove-plugin]'); if (!button) return;
  if (!await confirmBox('Remove game plugin', 'Move only the unchanged files CoreMX installed to the Recycle Bin? Edited or shared files are kept.', 'Remove', true)) return;
  try {
    const result = await api.invoke('installs:uninstall', button.dataset.removePlugin);
    await renderPluginsInto($('#libScroll'));
    toast(result?.kept ? `${result.kept} changed or unverified file${result.kept === 1 ? '' : 's'} kept` : 'Plugin files moved to the Recycle Bin', result?.kept ? 'info' : 'ok', 5000);
  } catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
});
document.addEventListener('click', async (e) => {
  const run = e.target.closest('[data-run-app]');
  if (run) { try { await api.invoke('apps:run', run.dataset.runApp); } catch (error) { toast(esc(cleanErr(error)), 'err', 6000); } return; }
  const remove = e.target.closest('[data-remove-app]');
  if (remove && await confirmBox('Remove from Downloads', 'Move this download from Downloads to the Recycle Bin?', 'Remove', true)) {
    try { await api.invoke('apps:remove', remove.dataset.removeApp); renderAppsInto($('#libScroll')); } catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
  }
});


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
  const family = id.startsWith('family:') ? filterItems().find((i) => i.id === id && i.family) : null;
  if (family) {
    if (e.target.closest('[data-check]') || e.ctrlKey || e.shiftKey || S.selected.size > 0) {
      for (const it of family.family) S.selected.has(it.id) ? S.selected.delete(it.id) : S.selected.add(it.id);
      renderLibItems();
    } else openGearFamily(family);
    return;
  }
  const clickedItem = S.items.find((i) => i.id === id);
  if (clickedItem && clickedItem.stock) { openItem(id); return; } // built-in tracks can't be selected for bulk actions
  if (e.target.closest('[data-check]') || e.ctrlKey || e.shiftKey || S.selected.size > 0) toggleSelect(id);
  else openItem(id);
});

function openGearFamily(family) {
  const m = modal({
    title: esc(family.title), size: 'md',
    body: `<p class="muted" style="margin-top:0">${family.variantCount} installed colourways. Choose one to view its files, image, or delete it.</p><div class="gear-family-grid">${family.family.map((it) => `<button class="gear-family-choice" data-family-item="${esc(it.id)}"><span class="gear-family-thumb">${thumbHtml(it)}</span><span><b>${esc(it.title)}</b><small>${esc(it.label)}</small></span>${icon('chevron')}</button>`).join('')}</div>`,
  });
  $('.modal-body', m).addEventListener('click', (e) => {
    const b = e.target.closest('[data-family-item]');
    if (!b) return;
    m.close(); openItem(b.dataset.familyItem);
  });
}

async function rescan(quiet) {
  const r = await api.invoke('library:scan');
  S.items = r.items;
  S.scanned = true;
  S.lib.bikePreviewsInitialized = r.bikePreviewsInitialized;
  buildNameIndex();
  for (const id of [...S.selected]) if (!S.items.some((i) => i.id === id)) S.selected.delete(id);
  if (S.view === 'library' || (S.view === 'rider' && S.riderTab === 'gear')) renderLibrary($('#content'));
  if (S.drawerId) {
    const cur = S.items.find((i) => i.id === S.drawerId) || S.items.find((i) => i.key === (S.drawerKey || ''));
    if (cur) openItem(cur.id, true); else closeDrawer();
  }
  if (!quiet) toast(`Scanned ${r.items.length} mods in ${r.ms} ms`, 'ok', 2200);
  startBikePreviews();
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
  const modelPreview = it.group === 'bikePaints' || (it.group === 'rider' && it.sub === 'riders');
  const bikeRender = it.group === 'bikes' && src === it.bikePreview;
  d.innerHTML = `<div class="drawer-hero ${modelPreview || it.group === 'bikes' ? 'drawer-bike-hero' : ''}">${modelPreview ? '<div id="drawerBikeModel" class="drawer-bike-model"><div class="spinner"></div></div>' : placeholder(it) + (src ? `<img ${bikeRender ? 'class="drawer-bike-render"' : ''} src="${esc(src)}" alt="">` : '')}<button class="btn btn-icon close" data-act="close-drawer">${icon('x')}</button></div>
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
      <div class="section-title">${bikeRender ? 'Saved 3D image' : 'Image'}</div>
      ${bikeRender ? '<p class="muted" style="font-size:12px;margin:0 0 16px">This render is stored on your PC and refreshes when the bike changes.</p>' : `<div class="actions">
        <button class="btn btn-sm" data-act="find-image">${icon('search')}Find image</button>
        <button class="btn btn-sm" data-act="pick-image">${icon('upload')}Choose file…</button>
        ${it.customImage ? `<button class="btn btn-sm btn-ghost" data-act="clear-image">${icon('x')}Reset</button>` : ''}
      </div>`}
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
  // Animate out, then remove. The wrapper stops taking clicks straight away.
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 190);
    onClose && onClose();
  };
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

// Removing a row from Downloads is deliberately separate from removing the
// mod.  This prevents an accidental X from uninstalling something the player
// has just added, while still giving them a one-click way to clean it up.
function dismissDownloadPrompt(job) {
  return new Promise((resolve) => {
    let answer = null;
    const hasFiles = !job.filesDeleted;
    const m = modal({
      title: 'Remove from Downloads', size: 'sm',
      body: `<div style="color:var(--text-2)">Remove <b>${esc(job.title)}</b> from this list?${hasFiles ? '<p class="muted" style="margin:10px 0 0">Keeping files only removes the completed-download history. Deleting files moves installed or downloaded files to the Recycle Bin.</p>' : ''}</div>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn" data-dismiss-keep>Keep files</button>${hasFiles ? '<button class="btn btn-danger" data-dismiss-delete>Delete files</button>' : ''}`,
      onClose: () => resolve(answer),
    });
    $('[data-dismiss-keep]', m).addEventListener('click', () => { answer = 'keep'; m.close(); });
    const remove = $('[data-dismiss-delete]', m);
    if (remove) remove.addEventListener('click', () => { answer = 'delete'; m.close(); });
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
const AUTO_HOSTS = /^(coremx\.app|mxb-mods\.com|drive\.google\.com|docs\.google\.com|mediafire\.com|mega\.nz|dropbox\.com)$/;
function hostMode(d) {
  if (/\/folder\/|#F!|\/drive\/folders\/|\/scl\/fo\//.test(d.url)) return 'folder';
  if (AUTO_HOSTS.test(d.host)) return 'auto';
  if (/\.(pkz|zip|rar|7z|pnt)(\?|$)/i.test(d.url)) return 'auto';
  return 'browser';
}

// ---------- Get Mods: free (mxb-mods.com) + both shops behind one switch ----------
S.getSrc = 'free';
// Keep one complete merged source page for each filter, with an overall size cap.
// MXB Mods and CoreMX can each contribute 30 cards to that page. Later pages
// load live so returning to a filter never silently skips uncached results.
const BROWSE_CACHE_KEY = 'coremx:browse:v2';
function browseKey() { const b = S.browse; return JSON.stringify([S.getSrc, b.tab, b.kind || 'all', b.brand || '', b.sort, b.query]); }
function browseCacheRead(key) {
  try {
    const all = JSON.parse(localStorage.getItem(BROWSE_CACHE_KEY) || '{}');
    const hit = all[key];
    if (hit && Array.isArray(hit.posts) && hit.page > 0 && Date.now() - hit.at < 30 * 86400000) return hit;
  } catch {}
  return null;
}
function browseCacheWrite(key, b) {
  const first = b.firstPage;
  if (!first || first.page !== 1) return;
  try {
    const all = JSON.parse(localStorage.getItem(BROWSE_CACHE_KEY) || '{}');
    if (first.posts.length) all[key] = { ...first, posts: first.posts.slice(0, 60) };
    else delete all[key];
    const recent = Object.keys(all).sort((a, c) => all[c].at - all[a].at);
    for (const old of recent.slice(24)) delete all[old];
    while (JSON.stringify(all).length > 1500000 && Object.keys(all).length > 1) {
      const oldest = Object.keys(all).sort((a, c) => all[a].at - all[c].at)[0];
      delete all[oldest];
    }
    localStorage.setItem(BROWSE_CACHE_KEY, JSON.stringify(all));
  } catch { /* Full or disabled browser storage must not block browsing. */ }
}
function browseCachedStart() {
  const b = S.browse, key = browseKey(), hit = browseCacheRead(key);
  try { localStorage.removeItem('coremx:browse:v1'); } catch {}
  b.cacheKey = key; b.error = null; b.loading = false; b.autoScanning = false; b.emptyPages = 0;
  b.page = hit?.page || 0; b.totalPages = hit?.totalPages || 1;
  b.total = hit?.total || 0; b.cursor = hit?.cursor || null; b.posts = hit?.posts || []; b.firstPage = hit || null;
  if (hit) browseRefresh(key, b.reqId);
  else browseLoad();
  if (hit) renderBrowseGrid();
}
async function browseRefresh(key, reqId) {
  const b = S.browse;
  if (b.refreshing?.key === key && b.refreshing.reqId === reqId) return;
  b.refreshing = { key, reqId };
  try {
    const request = { query: b.query, tab: b.tab, kind: b.kind || 'all', brand: b.brand || '', scope: S.getSrc, perPage: 30, orderby: b.sort };
    const r = await api.invoke('site:search', { ...request, page: 1, cursor: null });
    if (r.communityError && !r.posts.length) throw new Error(r.communityError);
    if (reqId !== b.reqId || key !== browseKey() || b.page !== 1 || b.loading || b.autoScanning) return;
    // A source failure must not replace a complete cached section with a partial one.
    if (!r.posts.length && b.posts.length) return;
    const samePosts = JSON.stringify(b.posts) === JSON.stringify(r.posts);
    b.firstPage = { at: Date.now(), page: 1, totalPages: r.totalPages, total: r.total, cursor: r.nextCursor || null, posts: r.posts.slice(0, 60) };
    b.posts = r.posts; b.page = 1; b.totalPages = r.totalPages;
    b.total = r.total; b.cursor = r.nextCursor || null;
    browseCacheWrite(key, b);
    if (samePosts) {
      const count = $('#brCount');
      if (count) count.textContent = b.total ? `${b.total.toLocaleString()} mods` : '';
      return;
    }
    b.reqId++;
    renderBrowseGrid();
  } catch { /* Keep the last complete snapshot and retry on the next visit. */ }
  finally { if (b.refreshing?.key === key && b.refreshing.reqId === reqId) b.refreshing = null; }
}
function isFree() { return (S.view === 'get' && S.getSrc === 'free') || (S.view === 'graphics' && S.gfxTab === 'get'); }
function isShop() { return S.view === 'get' && S.getSrc !== 'free'; }
function renderGet(c) {
  if (S.getSrc === 'addons') S.getSrc = 'free';
  const SOURCES = [
    ['free', 'globe', 'Mods', 'coremx.app + mxb-mods.com'],
    ['hub', 'cart', 'MXB Hub', 'Paid store'],
    ['mxbs', 'cart', 'MX Bikes Shop', 'Paid store'],
  ];
  const src = ([id, ic, label, hint]) => `<button class="src-tile ${S.getSrc === id ? 'active' : ''}" data-src="${id}"><span class="src-ico">${icon(ic)}</span><span class="src-txt"><b>${label}</b><small>${hint}</small></span></button>`;
  c.innerHTML = `<div class="view col"><div class="get-head"><div class="get-title"><h2>Get Mods</h2><span class="sub">Browse, check what you need and install in one click</span></div><div class="src-tiles">${SOURCES.map(src).join('')}</div></div><div class="view" id="getBody"></div></div>`;
  const body = $('#getBody');
  if (S.getSrc === 'free') { renderBrowse(body); return; }
  if (S.shop.id !== S.getSrc) { S.shop.id = S.getSrc; S.shop.cat = 0; S.shop.sort = 'date'; S.shop.query = ''; S.shop.products = []; S.shop.page = 0; S.shop.totalPages = 1; S.shop.total = 0; S.shop.req++; S.shop.loading = false; }
  renderShops(body);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-src]');
  if (b && S.view === 'get') { if (S.getSrc === b.dataset.src) return; S.getSrc = b.dataset.src; S.browse.posts = []; S.browse.cursor = null; S.browse.kind = 'all'; S.browse.brand = ''; S.browse.page = 0; S.browse.totalPages = 1; S.browse.loading = false; S.browse.reqId = (S.browse.reqId || 0) + 1; renderGet($('#content')); }
});

// ---------- OEM packs ----------
S.packs = null;
async function renderPacks(c, force) {
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>OEM Packs</h2><div class="grow"></div><button class="btn" data-act="packs-refresh">${icon('refresh')}Check again</button></div>
    <div class="scroller"><p class="muted" style="margin:-4px 0 18px;max-width:640px">The official bike packs most servers use. The app compares each pack with your bikes and only downloads what's missing or changed — not the whole pack.</p>
    <div class="pack-summary" id="packSummary"></div><div class="packs" id="packList">${[1, 2, 3, 4].map(() => '<div class="pack"><div class="pack-img skeleton"></div><div class="pack-body"><div class="skeleton" style="height:16px;width:50%;border-radius:6px"></div><div class="skeleton" style="height:10px;width:80%;border-radius:6px"></div></div></div>').join('')}</div></div></div></div>`;
  try { if (!S.packs || force) S.packs = await api.invoke('packs:list', !!force); }
  catch (e) { const list = $('#packList'); if (list) list.innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`; return; }
  S.packsNeed = S.packs.filter((p) => p.summary && p.summary.needCount && p.summary.have).length;
  renderRail();
  if (S.view !== 'packs') return;
  $('#packList').innerHTML = S.packs.map(packCard).join('');
  drawPackSummary();
}

// One line at the top: how many packs are current, and one button to update the rest.
function drawPackSummary() {
  const box = $('#packSummary'); if (!box || !S.packs) return;
  // Only packs you already have count as updates; packs you've never installed are left to you.
  const need = S.packs.filter((p) => p.summary && p.summary.needCount && p.summary.have && !p.error);
  const fresh = S.packs.filter((p) => p.summary && p.summary.needCount && !p.summary.have && !p.error).length;
  const ok = S.packs.filter((p) => p.summary && !p.summary.needCount && !p.error).length;
  const bytes = need.reduce((n, p) => n + (p.summary.needBytes || 0), 0);
  box.innerHTML = `<div class="pack-sum-icon ${need.length ? 'need' : 'ok'}">${icon(need.length ? 'refresh' : 'check')}</div>
    <div class="pack-sum-txt"><b>${need.length ? `${need.length} installed pack${need.length > 1 ? 's' : ''} can be updated` : 'Your installed packs are up to date'}</b><small>${ok} of ${S.packs.length} up to date${need.length ? ` · ${fmtSize(bytes)}, only the files that changed` : ''}${fresh ? ` · ${fresh} not installed yet` : ''}</small></div>
    ${need.length > 1 ? `<button class="btn btn-primary" data-act="packs-update-all">${icon('download')}Update all</button>` : ''}`;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-act="packs-update-all"]')) return;
  const ids = new Set(S.packs.filter((p) => p.summary && p.summary.needCount && p.summary.have && !p.error).map((p) => String(p.id)));
  for (const b of $$('#packList [data-pack-update]:not([disabled])')) if (ids.has(b.dataset.packUpdate)) b.click();
});
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
  return `<div class="seg-tabs"><button class="${active === 'downloads' ? 'active' : ''}" data-dltab="downloads">${icon('download')}Downloads</button><button class="${active === 'recent' ? 'active' : ''}" data-dltab="recent">${icon('clock')}Recent installs</button><button class="${active === 'updates' ? 'active' : ''}" data-dltab="updates">${icon('refresh')}Updates${n ? ` (${n})` : ''}</button></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-dltab]');
  if (b) { S.dlTab = b.dataset.dltab; render(); }
});

function renderBrowse(c) {
  if (!$('#browseView')) {
    c.innerHTML = `<div class="view" id="browseView"><div class="main">
      <div class="toolbar browse-bar">
        <div class="search spotlight">${icon('search')}<input id="brSearch" placeholder="Search bikes, tracks, gear, liveries…" spellcheck="false"></div>
        <select id="brSort"><option value="relevance">Best match</option><option value="popular-week">🔥 Popular this week</option><option value="popular-month">🔥 Popular this month</option><option value="popular-today">🔥 Popular today</option><option value="popular-all">🔥 Popular all time</option><option value="date">Newest</option><option value="modified">Recently updated</option><option value="title">Title A–Z</option></select>
        <span class="sub" id="brCount"></span><div class="grow"></div>
        ${S.view === 'get' && S.getSrc === 'free' ? `<button class="btn" data-open="https://coremx.app/#/new">${icon('upload')}Upload mod</button>` : ''}
        <button class="btn btn-icon" data-act="open-site" title="Open coremx.app">${icon('external')}</button>
      </div>
      <div class="chips" id="brTabs"></div>
      <div class="chips browse-brands" id="brBrands"></div>
      <div class="chips browse-kind" id="brKind"></div>
      <div class="scroller" id="brScroll"></div>
    </div></div>`;
    $('#brSearch').value = S.browse.query;
    $('#brSearch').addEventListener('input', debounce((e) => {
      if (!e.target.isConnected) return;
      S.browse.query = e.target.value.trim();
      browseReset();
    }, 380));
    $('#brSort').addEventListener('change', (e) => { S.browse.sort = e.target.value; browseReset(); });
    $('#brTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { S.browse.tab = b.dataset.tab; S.browse.kind = 'all'; S.browse.brand = ''; drawBrowseBrands(); drawBrowseKind(); browseReset(); } });
    $('#brBrands').addEventListener('click', (e) => { const b = e.target.closest('[data-livery-brand]'); if (b) { S.browse.brand = b.dataset.liveryBrand; if (S.browse.brand) S.browse.sort = 'date'; $('#brSort').value = S.browse.sort; drawBrowseBrands(); browseReset(); } });
    $('#brKind').addEventListener('click', (e) => { const b = e.target.closest('[data-browse-kind]'); if (b) { S.browse.kind = b.dataset.browseKind; drawBrowseKind(); browseReset(); } });
  }
  $('#brSort').value = S.browse.sort;
  $('#brTabs').innerHTML = S.tabs.map((t) => `<button class="chip ${S.browse.tab === t.id ? 'active' : ''}" data-tab="${t.id}">${icon(TAB_ICONS[t.id] || 'grid')}${esc(t.label)}</button>`).join('');
  drawBrowseBrands();
  drawBrowseKind();
  if (S.browse.cacheKey !== browseKey()) browseReset();
  else { renderBrowseGrid(); if (S.browse.posts.length && S.browse.page === 1) browseRefresh(browseKey(), S.browse.reqId); else if (!S.browse.posts.length && !S.browse.loading) browseLoad(); }
}

const TAB_ICONS = { all: 'grid', tracks: 'track', bikes: 'bike', liveries: 'paint', riderkit: 'shirt', riders: 'rider', helmets: 'helmet', boots: 'boot', gloves: 'glove', protection: 'shield', goggles: 'goggles', sounds: 'power', animations: 'rider', wheels: 'tyre', graphics: 'sparkle', modpacks: 'box', other: 'settings', paid: 'cart' };
const LIVERY_BRANDS = ['Virtual Team Bike Liveries', 'MSM', 'Alta', 'Beta', 'Fantic', 'GasGas', 'Honda', 'Husaberg', 'Husqvarna', 'KTM', 'Kawasaki', 'Suzuki', 'TM', 'Triumph', 'Yamaha'];
function drawBrowseBrands() {
  const box = $('#brBrands'); if (!box) return;
  box.hidden = !(S.view === 'get' && S.getSrc === 'free' && S.browse.tab === 'liveries');
  box.innerHTML = box.hidden ? '' : [['', 'All liveries'], ...LIVERY_BRANDS.map((name) => [name, name])].map(([brand, label]) => `<button class="chip ${S.browse.brand === brand || !S.browse.brand && !brand ? 'active' : ''}" data-livery-brand="${esc(brand)}">${esc(label)}</button>`).join('');
  const sort = $('#brSort'); if (sort) { sort.disabled = !box.hidden && !!S.browse.brand; sort.title = sort.disabled ? 'Brand pages use the order shown on MXB Mods' : ''; }
}
function drawBrowseKind() {
  const box = $('#brKind'); if (!box) return;
  const labels = { helmets: ['Helmet models', 'Helmet paints'], boots: ['Boot models', 'Boot paints'], protection: ['Protection models', 'Protection paints'] }[S.browse.tab];
  box.hidden = !labels;
  if (!labels) { box.innerHTML = ''; return; }
  const choices = [['all', 'All'], ['models', labels[0]], ['paints', labels[1]]];
  if (S.browse.tab === 'helmets') choices.push(['addons', 'Helmet add-ons']);
  box.innerHTML = choices.map(([kind, label]) => `<button class="chip ${(S.browse.kind || 'all') === kind ? 'active' : ''}" data-browse-kind="${kind}">${label}</button>`).join('');
}

function browseReset() {
  S.browse.reqId = (S.browse.reqId || 0) + 1;
  $$('#brTabs .chip').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.browse.tab));
  const scroll = $('#brScroll'); if (scroll) scroll.scrollTop = 0;
  browseCachedStart();
}

async function browseLoad() {
  const b = S.browse;
  if (b.loading || b.page >= b.totalPages) return;
  b.loading = true; b.error = null;
  const reqId = b.reqId;
  const nextPage = b.page + 1;
  let autoAdvance = false;
  renderBrowseGrid();
  try {
    let timeout;
    const request = api.invoke('site:search', { query: b.query, tab: b.tab, kind: b.kind || 'all', brand: b.brand || '', scope: S.view === 'get' ? S.getSrc : 'all', page: nextPage, perPage: 30, orderby: b.sort, cursor: b.cursor });
    const r = await Promise.race([request, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('MXB Mods took too long to respond. Try again.')), 30000); })]).finally(() => clearTimeout(timeout));
    if (reqId !== b.reqId) return;
    if (!Array.isArray(r.posts) || r.page !== nextPage) throw new Error('The mod listing returned an invalid page. Try again.');
    if (r.communityError && !r.posts.length) throw new Error(r.communityError);
    b.page = r.page; b.totalPages = r.totalPages; b.total = r.total; b.cursor = r.nextCursor || null;
    const seen = new Set(b.posts.map((p) => String(p.id)));
    const added = r.posts.filter((p) => !seen.has(String(p.id)));
    b.posts.push(...added);
    if (nextPage === 1) b.firstPage = { at: Date.now(), page: 1, totalPages: r.totalPages, total: r.total, cursor: r.nextCursor || null, posts: r.posts.slice(0, 60) };
    b.emptyPages = added.length ? 0 : (b.emptyPages || 0) + 1;
    autoAdvance = !added.length && b.page < b.totalPages && b.emptyPages < 5;
    browseCacheWrite(b.cacheKey || browseKey(), b);
  } catch (e) {
    if (reqId === b.reqId) b.error = e.message;
  } finally {
    if (reqId === b.reqId) b.loading = false;
    if (reqId === b.reqId && isFree()) {
      b.autoScanning = autoAdvance && !b.error;
      renderBrowseGrid();
      if (b.autoScanning) setTimeout(() => {
        if (reqId !== b.reqId || !isFree() || !$('#brScroll')) { b.autoScanning = false; return; }
        b.autoScanning = false;
        browseLoad();
      }, 0);
    }
  }
}

function siteCard(p) {
  const installed = haveMod({ postId: p.id, title: p.title });
  const cat = p.categoryNames.filter((n) => !/^(Bikes|Rider|Other|Paid Mods)$/.test(n)).slice(-1)[0] || p.categoryNames[0] || '';
  // A website paint category does not necessarily mean a dependency: many
  // standalone kit packs are tagged under every gear type.  Only label a card
  // as requiring a model after its creator instructions confirm that fact.
  const dependencyLabel = p.needsModelNotice ? 'Requires another model' : paintRequirement(p) ? `Requires matching ${paintRequirement(p)}` : '';
  return `<div class="card" data-post="${esc(p.id)}">
    <div class="thumb"><div class="ph" style="--ph1:#2b303c;--ph2:#15171c"><div class="ph-icon">${icon('globe')}</div><div class="ph-brand" style="font-size:16px">${esc(p.title.slice(0, 28))}</div></div>
      ${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="">` : ''}
      <div class="badges">${p.coremxId ? '<span class="badge accent">CoreMX</span>' : ''}${p.rank ? `<span class="badge accent">#${p.rank}</span>` : ''}${installed ? `<span class="badge ok">${icon('check')}Installed</span>` : ''}${p.paid ? '<span class="badge warn">Paid</span>' : ''}</div></div>
    <div class="card-body"><div class="card-title" title="${esc(p.title)}">${esc(p.title)}</div>${dependencyLabel ? `<div class="mod-content-kind">${dependencyLabel}</div>` : ''}
      <div class="card-meta">${esc(cat)}<span class="dot"></span>${Number.isFinite(p.views) ? `${p.views.toLocaleString()} views` : timeAgo(p.date)}</div></div></div>`;
}

function paintRequirement(p) {
  const categories = p.categories || [];
  if (categories.includes(127) && !categories.includes(313)) return 'helmet model';
  if (categories.includes(126) && !categories.includes(343)) return 'boot model';
  if (categories.includes(135) && !categories.includes(344)) return 'protector model';
  return '';
}

function heroCard(p) {
  const cat = p.categoryNames.filter((n) => !/^(Bikes|Rider|Other|Paid Mods)$/.test(n)).slice(-1)[0] || '';
  const installed = haveMod({ postId: p.id, title: p.title });
  const sortLabel = { 'popular-week': 'this week', 'popular-today': 'today', 'popular-all': 'of all time' }[S.browse.sort] || 'this month';
  return `<div class="feature-hero" data-post="${esc(p.id)}"><img src="${esc(p.image)}" alt=""><div class="fh-shade"></div>
    <div class="fh-body"><span class="fh-kicker">${p.rank ? `#${p.rank} most popular ${sortLabel}` : 'Featured'}${cat ? ` · ${esc(cat)}` : ''}</span><h3>${esc(p.title)}</h3>${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
    <span class="fh-actions"><span class="btn btn-primary">${icon(installed ? 'check' : 'download')}${installed ? 'Installed · view' : 'View & install'}</span>${Number.isFinite(p.views) ? `<span class="fh-views">${p.views.toLocaleString()} views</span>` : ''}</span></div></div>`;
}
let brObserver = null;
function renderBrowseGrid() {
  const sc = $('#brScroll');
  if (!sc) return;
  const b = S.browse;
  $('#brCount').textContent = b.total ? `${b.total.toLocaleString()} mods` : '';
  let html = '';
  // Front page of free mods: the top mod gets a large banner above the grid.
  const hero = S.view === 'get' && S.getSrc === 'free' && !b.query && b.tab === 'all' && b.posts.length >= 4 && b.posts[0].image ? b.posts[0] : null;
  if (hero) html += heroCard(hero);
  if (b.posts.length) html += `<div class="grid big" data-browse-grid="${b.reqId}">${b.posts.filter((p) => p !== hero).map(siteCard).join('')}</div>`;
  else if (b.loading || b.autoScanning) html += `<div class="grid big">${Array.from({ length: 12 }, () => '<div class="card"><div class="thumb skeleton"></div><div class="card-body"><div class="skeleton" style="height:12px;border-radius:4px;width:70%"></div></div></div>').join('')}</div>`;
  else if (b.error) html += `<div class="empty"><div>${icon('alert')}<h3>Couldn't load free mods</h3><div>${esc(b.error)}</div><div style="margin-top:12px"><button class="btn" data-act="browse-retry">${icon('refresh')}Retry</button></div></div></div>`;
  else html += `<div class="empty"><div>${icon('search')}<h3>No mods found${b.page < b.totalPages ? ' on this page' : ''}</h3><div>Try another search or category.</div>${b.page < b.totalPages ? '<button class="btn" data-act="browse-more">Check next page</button>' : ''}</div></div>`;
  const moreHtml = `<div class="loadmore" id="brMore">${b.error ? `<span class="muted">${esc(b.error)}</span><button class="btn" data-act="browse-retry">Retry</button>` : b.loading || b.autoScanning ? '<div class="spinner"></div>' : '<button class="btn" data-act="browse-more">Load more</button>'}</div>`;
  if (b.page < b.totalPages && b.posts.length) html += moreHtml;
  const top = sc.scrollTop;
  const existing = sc.querySelector(`[data-browse-grid="${b.reqId}"]`);
  if (existing && b.posts.length) {
    const ids = new Set([...existing.querySelectorAll('[data-post]')].map((el) => el.dataset.post));
    const heroId = sc.querySelector('.feature-hero')?.dataset.post;
    existing.insertAdjacentHTML('beforeend', b.posts.filter((p) => !ids.has(String(p.id)) && String(p.id) !== heroId).map(siteCard).join(''));
    for (const card of existing.querySelectorAll('[data-post]')) {
      const post = b.posts.find((p) => String(p.id) === card.dataset.post);
      const badge = [...card.querySelectorAll('.badge.ok')].find((el) => el.textContent.includes('Installed'));
      const installed = post && haveMod({ postId: post.id, title: post.title });
      if (!installed) badge?.remove();
      else if (!badge) card.querySelector('.badges')?.insertAdjacentHTML('beforeend', `<span class="badge ok">${icon('check')}Installed</span>`);
    }
    $('#brMore', sc)?.remove();
    if (b.page < b.totalPages) sc.insertAdjacentHTML('beforeend', moreHtml);
  } else sc.innerHTML = html;
  sc.scrollTop = top;
  if (brObserver) brObserver.disconnect();
  const more = $('#brMore');
  if (more && !b.error && !b.loading && !b.autoScanning) {
    brObserver = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) browseLoad(); }, { root: sc, rootMargin: '700px' });
    brObserver.observe(more);
  }
  // IntersectionObserver is occasionally suppressed while Electron is
  // repainting image-heavy cards. Keep the observer, but also load when the
  // user actually reaches the end of the browse scroller.
  sc.onscroll = () => {
    if (b.loading || b.autoScanning || b.error || b.page >= b.totalPages) return;
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 700) browseLoad();
  };
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-post]');
  if (c && c.closest('#brScroll')) {
    const p = S.browse.posts.find((x) => String(x.id) === c.dataset.post);
    if (p) openPost(p);
  }
});

const openPostRefreshers = new Set();
let notificationRefresh = null;
// Announcements deleted on this PC stay deleted here, whatever the service answers later.
const deletedHere = () => { try { return new Set(JSON.parse(localStorage.getItem('coremx:deletedAnnouncements') || '[]')); } catch { return new Set(); } };
function rememberDeleted(id) { const all = deletedHere(); all.add(id); try { localStorage.setItem('coremx:deletedAnnouncements', JSON.stringify([...all].slice(-200))); } catch {} }
function withoutDeleted(inbox) {
  if (!inbox || !Array.isArray(inbox.notifications)) return inbox;
  // Announcements last a day: older ones aren't shown at all (not in Notifications, no pop-up).
  const gone = deletedHere(), notifications = inbox.notifications.filter((n) => !(n.kind === 'announcement' && (gone.has(n.id) || Date.now() - (Number(n.at) || 0) > 86400000)));
  return { ...inbox, notifications, unread: notifications.filter((n) => !n.read).length };
}
async function refreshNotifications() {
  if (notificationRefresh) return notificationRefresh;
  notificationRefresh = (async () => { try {
    S.notifications = withoutDeleted(await api.invoke('online:notifications')); renderRail();
    showSharePopups(S.notifications.notifications || []);
    // An announcement pops up once: the service records it, and this PC remembers it too (in case
    // the service didn't get the note, or another CoreMX window showed it at the same time).
    let shownHere = [];
    try { shownHere = JSON.parse(localStorage.getItem('coremx:shownAnnouncements') || '[]'); } catch {}
    // Only an announcement under a day old pops up (older ones aren't listed at all, see withoutDeleted).
    const fresh = (n) => Date.now() - (Number(n.at) || 0) < 86400000;
    const unseen = (S.notifications.notifications || []).filter((n) => n.kind === 'announcement' && !n.seenPopup && !shownHere.includes(n.id) && fresh(n));
    const quiet = (S.notifications.notifications || []).filter((n) => n.kind === 'announcement' && !n.seenPopup && (shownHere.includes(n.id) || !fresh(n)));
    if (quiet.length) api.invoke('online:seenAnnouncements', quiet.map((n) => n.id)).catch(() => {});
    if (unseen.length) {
      try { localStorage.setItem('coremx:shownAnnouncements', JSON.stringify([...shownHere, ...unseen.map((n) => n.id)].slice(-200))); } catch {}
      await api.invoke('online:seenAnnouncements', unseen.map((n) => n.id));
      unseen.forEach((n) => { n.seenPopup = true; });
      const latest = unseen[0];
      modal({ title: esc(latest.title), size: 'sm', body: `<div class="announcement-message">${esc(latest.message).replace(/\n/g, '<br>')}</div><p class="muted">You can find this later in Notifications.</p>` });
    }
  }
  catch { /* Offline users keep the last inbox until the service is reachable. */ }
  })().finally(() => { notificationRefresh = null; });
  return notificationRefresh;
}
// A friend shared a mod: a banner at the top for 5 seconds, then it fades. Click to open the mod.
// Each share pops up once (remembered across restarts); shares already older than 10 minutes on
// first sight just stay in the inbox.
function openSharedMod(n) {
  api.invoke('online:deleteNotification', n.id).then(() => refreshNotifications()).catch(() => {});
  const id = /^coremx:/.test(n.postId) ? n.postId : Number(n.postId);
  openPost({ id, title: n.title, image: null, link: /^coremx:/.test(n.postId) ? `https://coremx.app/#/mod/${encodeURIComponent(n.postId.slice(7))}` : 'https://mxb-mods.com/', coremxId: /^coremx:/.test(n.postId) ? n.postId.slice(7) : null });
}
function showSharePopups(list) {
  let seen; try { seen = new Set(JSON.parse(localStorage.getItem('coremx.sharePopups') || '[]')); } catch { seen = new Set(); }
  const fresh = list.filter((n) => n.kind !== 'announcement' && !n.read && !seen.has(n.id));
  if (!fresh.length) return;
  for (const n of fresh) seen.add(n.id);
  try { localStorage.setItem('coremx.sharePopups', JSON.stringify([...seen].slice(-300))); } catch {}
  let stack = document.getElementById('sharePopups');
  if (!stack) { stack = document.createElement('div'); stack.id = 'sharePopups'; stack.className = 'share-popups'; document.body.appendChild(stack); }
  fresh.filter((n) => Date.now() - (n.at || 0) < 10 * 60 * 1000).slice(0, 3).forEach((n, i) => {
    const el = document.createElement('button');
    el.className = 'share-popup';
    el.innerHTML = `<span class="share-popup-ico">${icon('download')}</span><span class="share-popup-txt"><b>${esc(n.fromName || 'A friend')} shared a mod</b><span>${esc(n.title || 'Untitled mod')}</span></span><span class="share-popup-go">View ${icon('chevron')}</span>`;
    el.addEventListener('click', () => { el.remove(); openSharedMod(n); });
    stack.appendChild(el);
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 600); }, 5000 + i * 400);
  });
}
async function reportCoremxMod(post) {
  const m = modal({ title: `Report ${esc(post.title)}`, size: 'sm', body: '<div class="loadmore"><div class="spinner"></div></div>' });
  const form = async () => {
    const status = await api.invoke('coremx:session');
    if (!m.isConnected) return;
    $('.modal-body', m).innerHTML = `${status.signedIn ? '' : '<p class="muted">Sign in with your CoreMX website account to send a report to the site admins.</p><div class="field"><label>Website username</label><input class="input" data-report-name autocomplete="username"></div><div class="field"><label>Password</label><input class="input" type="password" data-report-password autocomplete="current-password"></div><button class="btn" data-report-login>Sign in</button>'}<div class="field"><label>Reason · Other</label><textarea class="input" data-report-details rows="5" placeholder="Describe the problem with this mod"></textarea></div><button class="btn btn-primary" data-report-send ${status.signedIn ? '' : 'disabled'}>Send report</button>`;
  };
  await form();
  m.addEventListener('click', async (e) => {
    const login = e.target.closest('[data-report-login]');
    if (login) {
      login.disabled = true;
      try { await api.invoke('coremx:login', $('[data-report-name]', m).value, $('[data-report-password]', m).value); await form(); }
      catch (error) { login.disabled = false; toast(esc(cleanErr(error)), 'err', 6000); }
      return;
    }
    const send = e.target.closest('[data-report-send]'); if (!send) return;
    send.disabled = true;
    try { await api.invoke('coremx:report', post.coremxId, $('[data-report-details]', m).value); m.close(); toast('Report sent to CoreMX', 'ok'); }
    catch (error) { send.disabled = false; toast(esc(cleanErr(error)), 'err', 6000); }
  });
}
async function openNotifications() {
  const m = modal({ title: 'Notifications', body: '<div class="loadmore"><div class="spinner"></div></div>', size: 'sm' });
  try {
    const [shares, site] = await Promise.allSettled([api.invoke('online:notifications'), api.invoke('coremx:notifications')]);
    if (!m.isConnected) return;
    if (shares.status === 'fulfilled') { S.notifications = withoutDeleted(shares.value); renderRail(); }
    let items = S.notifications.notifications || [];
    const website = site.status === 'fulfilled' ? site.value : { notifications: [] };
    const expanded = { announcement: false, share: false, website: false };
    const section = (kind, title, list, empty, content) => `<div class="notification-heading"><h3>${title}</h3><span>${list.length}</span></div>${list.length ? `<div class="notification-list">${(expanded[kind] ? list : list.slice(0, 5)).map(content).join('')}</div>${list.length > 5 ? `<button class="btn btn-sm notification-more" data-notification-more="${kind}">${expanded[kind] ? 'Show less' : `View all ${list.length}`}</button>` : ''}` : `<p class="muted">${empty}</p>`}`;
    const renderInbox = () => {
      const announcements = items.filter((n) => n.kind === 'announcement');
      const friendShares = items.filter((n) => n.kind !== 'announcement');
      const row = (n, label, detail) => `<div class="notification-row ${n.read ? '' : 'unread'}"><button class="notification-open" data-notification-open="${esc(n.id)}"><b>${esc(label)}</b><span>${esc(detail)}</span><small>${timeAgo(n.at)}</small></button><button class="notification-delete" data-notification-delete="${esc(n.id)}" title="Delete notification" aria-label="Delete notification">${icon('trash')}</button></div>`;
      $('.modal-body', m).innerHTML = section('announcement', 'Announcements', announcements, 'No announcements yet.', (n) => row(n, n.title, n.message.length > 110 ? n.message.slice(0, 110) + '…' : n.message))
        + section('share', 'Friend shares', friendShares, 'No mod shares yet.', (n) => row(n, `${n.fromName || 'A friend'} shared a mod`, n.title))
        + (website.signedIn ? section('website', 'CoreMX website', website.notifications || [], 'No website notifications.', (n) => `<div class="notification-row"><div class="notification-open"><b>${esc(n.title || n.type || 'Website notification')}</b><span>${esc(n.message || n.text || '')}</span></div></div>`) : '');
    };
    renderInbox();
    m.addEventListener('click', async (e) => {
      const more = e.target.closest('[data-notification-more]');
      if (more) { expanded[more.dataset.notificationMore] = !expanded[more.dataset.notificationMore]; renderInbox(); return; }
      const del = e.target.closest('[data-notification-delete]');
      if (del) {
        del.disabled = true;
        const id = del.dataset.notificationDelete;
        if (items.some((n) => n.id === id && n.kind === 'announcement')) rememberDeleted(id);
        try { await api.invoke('online:deleteNotification', id); }
        catch (error) { if (!deletedHere().has(id)) { del.disabled = false; toast(esc(cleanErr(error)), 'err'); return; } }
        items = items.filter((n) => n.id !== id); renderInbox(); refreshNotifications();
        return;
      }
      const open = e.target.closest('[data-notification-open]'); if (!open) return;
      const n = items.find((item) => item.id === open.dataset.notificationOpen); if (!n) return;
      try {
        if (n.kind === 'announcement') {
          await api.invoke('online:seenAnnouncements', [n.id]);
          await api.invoke('online:readNotification', n.id);
        }
        else await api.invoke('online:deleteNotification', n.id);
        refreshNotifications();
      } catch (error) { toast(esc(cleanErr(error)), 'err'); return; }
      m.close();
      if (n.kind === 'announcement') modal({ title: esc(n.title), size: 'sm', body: `<div class="announcement-message">${esc(n.message).replace(/\n/g, '<br>')}</div>` });
      else {
        const id = /^coremx:/.test(n.postId) ? n.postId : Number(n.postId);
        openPost({ id, title: n.title, image: null, link: /^coremx:/.test(n.postId) ? `https://coremx.app/#/mod/${encodeURIComponent(n.postId.slice(7))}` : `https://mxb-mods.com/`, coremxId: /^coremx:/.test(n.postId) ? n.postId.slice(7) : null });
      }
    });
  } catch (error) { $('.modal-body', m).innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(cleanErr(error))}</div></div>`; }
}
async function shareModDialog(post) {
  const m = modal({ title: `Share ${esc(post.title)}`, body: '<div class="loadmore"><div class="spinner"></div></div>', size: 'sm', foot: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="shareSend" disabled>Share mod</button>' });
  try {
    const friends = (await api.invoke('online:friends')).filter((f) => f.status === 'ok');
    if (!m.isConnected) return;
    $('.modal-body', m).innerHTML = friends.length ? `<p class="muted">Send this mod page to a mutual CoreMX friend.</p><div class="share-friend-field"><span>Friend</span><button class="share-friend-trigger" id="shareFriendTrigger" aria-expanded="false">Choose a friend… <span>▾</span></button><div class="share-friend-menu" id="shareFriendMenu" hidden>${friends.map((f) => `<button data-share-friend="${esc(f.id)}"><span>${esc(f.name || f.id)}</span><small>${f.online ? 'Online' : 'Offline'}</small></button>`).join('')}</div></div>` : '<p class="muted">No mutual CoreMX friends are available. Add each other in Friends first.</p>';
    let selected = '';
    const trigger = $('#shareFriendTrigger', m), menu = $('#shareFriendMenu', m), send = $('#shareSend', m);
    trigger?.addEventListener('click', () => { menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden)); });
    menu?.addEventListener('click', (e) => {
      const choice = e.target.closest('[data-share-friend]'); if (!choice) return;
      selected = choice.dataset.shareFriend;
      trigger.innerHTML = `${esc(friends.find((f) => String(f.id) === selected)?.name || selected)} <span>▾</span>`;
      menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); send.disabled = false;
    });
    send.addEventListener('click', async () => {
      if (!selected || !friends.some((f) => String(f.id) === selected)) return;
      send.disabled = true;
      try { await api.invoke('online:shareMod', selected, String(post.id), post.title); m.close(); toast('Mod shared with your friend', 'ok'); }
      catch (error) { send.disabled = false; toast(esc(cleanErr(error)), 'err', 6000); }
    });
  } catch (error) { $('.modal-body', m).innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(cleanErr(error))}</div></div>`; }
}
function isMxbModelPage(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && /^(www\.)?mxb-mods\.com$/i.test(u.hostname) && /^\/[^/]+\/?$/.test(u.pathname); } catch { return false; }
}
function dependencyButton(d, label) {
  const internal = isMxbModelPage(d.url);
  const shop = dependencyShop(d.url);
  return `<button class="btn btn-sm" ${internal || shop ? 'data-install-required' : 'data-open'}="${esc(d.url)}">${icon(internal ? 'download' : shop ? 'cart' : 'external')}${esc(label || (internal ? 'Install model' : shop ? 'Buy / download model' : 'Open model page'))}</button>`;
}
function dependencyShop(url) {
  try { const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); return host === 'mxbikes-shop.com' ? 'mxbs' : host === 'shop.mxb-hub.com' ? 'hub' : null; } catch { return null; }
}
async function installDependency(url) {
  const shop = dependencyShop(url);
  if (shop) return api.invoke('shops:open', shop, url);
  if (!isMxbModelPage(url)) return api.invoke('open:external', url);
  const summary = await api.invoke('site:resolvePost', url);
  return openPost(summary, { install: true });
}
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-install-required]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try { await installDependency(button.dataset.installRequired); }
  catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
  finally { if (button.isConnected) button.disabled = false; }
});
async function openPost(summary, { install = false, file = null } = {}) {
  let refresh, postTab = 'desc';
  const m = modal({
    title: esc(summary.title),
    body: `<div class="post"><div><div class="gallery-main">${summary.image ? `<img src="${esc(summary.image)}" data-keep="1">` : ''}</div></div><div><div class="loadmore"><div class="spinner"></div></div></div></div>`,
    foot: `<span class="grow">${summary.coremxId ? 'coremx.app' : 'mxb-mods.com'}</span>${summary.coremxId ? `<button class="btn" data-report-mod>${icon('alert')}Report</button>` : ''}<button class="btn" data-share-mod>${icon('share')}Share</button><button class="btn" data-open="${esc(summary.link)}">${icon('external')}Open page</button>`,
    onClose: () => { openPostRefreshers.delete(refresh); popAmbient(); },
  });
  pushAmbient(summary.image);
  let p;
  try { p = await api.invoke('site:post', summary.id); }
  catch (e) { $('.post > div:last-child', m).innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
  if (p.views == null && Number.isFinite(summary.views)) p.views = summary.views;
  if (!m.isConnected) return;
  const draw = () => {
  const scroll = $('.modal-body', m).scrollTop;
  const installed = haveMod({ postId: p.id, title: p.title, urls: p.downloads.map((d) => d.url) });
  const hasUpdate = installed && updateFor(p.id, p.modified);
  const dls = p.downloads.length ? p.downloads.map((d, i) => {
    const mode = p.paid ? 'browser' : hostMode(d);
    const action = d.shop ? (d.modelInstalled ? `<span class="have">${icon('check')}Model installed</span>` : `<button class="btn btn-primary" data-install-required="${esc(d.url)}">${icon('cart')}Buy / download</button>`)
      : p.paid ? `<button class="btn" data-open="${esc(d.url)}">${icon('external')}Open</button>`
      : hasUpdate ? `<button class="btn btn-primary" data-dl="${i}">${icon('refresh')}Update</button>`
      : (d.installed ?? installed) ? `<span class="have">${icon('check')}${p.missingModelTextures?.length ? 'Paint files installed' : 'Installed'}</span>`
      : `<button class="btn ${isServerDownload(d) ? '' : 'btn-primary'}" data-dl="${i}">${icon('download')}${mode === 'folder' ? 'Choose file' : isServerDownload(d) ? 'Install server copy' : 'Install'}</button>`;
    return `<div class="dl" data-download-url="${esc(d.url)}"><div class="info">${d.flag ? `<div class="flag">${esc(d.flag)}</div>` : ''}${isServerDownload(d) ? '<div class="dl-server-note">For running a dedicated server, not for riding</div>' : ''}<div class="label">${esc(d.label || (d.host === 'mxb-mods.com' ? decodeURIComponent(d.url.split('/').pop()) : d.host) || 'Download')}</div>
      <div class="host">${esc(d.host)}<span class="host-pill ${mode}">${d.shop ? 'Shop' : mode === 'auto' ? 'Auto-install' : mode === 'folder' ? 'Choose file' : 'Via browser'}</span></div>${mode === 'folder' && /mediafire\.com/i.test(d.host) ? '<small class="muted">MediaFire requires Premium for whole-folder ZIPs. Open the folder and choose each file individually.</small>' : ''}</div>
      ${action}${d.modelDependencies?.length ? `<div class="download-requirements">${d.modelDependencies.map((dep) => `<div><b>${esc(dep.label)}</b><span class="${dep.installed ? 'ok-text' : 'muted'}">${dep.installed ? 'Installed' : 'Required model not installed'}</span>${dep.installed || !dep.url ? '' : dependencyButton(dep)}</div>`).join('')}</div>` : ''}<div class="download-inline" data-download-progress hidden></div></div>`;
  }).join('') : `<div class="notice warn">${icon('alert')}<div>No download links found on this page. Open it on the site to check.</div></div>`;

  $('.modal-body', m).innerHTML = `<div class="post">
    <div>
      <div class="gallery-main"><img id="galMain" src="${esc(p.images[0] || p.image || '')}" data-keep="1" alt=""></div>
      ${p.images.length > 1 ? `<div class="gallery-strip">${p.images.map((u, i) => `<img src="${esc(u)}" data-gal="${i}" class="${i === 0 ? 'active' : ''}" data-keep="1" loading="lazy">`).join('')}</div>` : ''}
      ${p.instructions ? `<div class="seg-tabs post-tabs"><button class="${postTab === 'desc' ? 'active' : ''}" data-post-tab="desc">${icon('info')}Description</button><button class="${postTab === 'install' ? 'active' : ''}" data-post-tab="install">${icon('download')}Installation</button></div>` : ''}
      <div class="desc" ${p.instructions && postTab === 'install' ? 'hidden' : ''}>${p.description || '<p class="muted">No description.</p>'}</div>
      ${p.instructions ? `<div class="desc post-install" ${postTab === 'install' ? '' : 'hidden'}>${p.instructions}<p class="muted" style="margin-top:14px">CoreMX installs this for you when you press Install. These are the creator's steps for installing it by hand.</p></div>` : ''}
    </div>
    <div>
      <h2>${esc(p.title)}</h2>
      <div class="post-meta">${p.author ? `<span>${icon('user')}${esc(p.author)}</span>` : ''}<span>${icon('clock')}${fmtDate(p.date)}</span>${p.modified && p.modified.slice(0, 10) !== p.date.slice(0, 10) ? `<span>${icon('refresh')}Updated ${fmtDate(p.modified)}</span>` : ''}${Number.isFinite(p.views) ? `<span>${icon('eye')}${p.views.toLocaleString()} views</span>` : ''}${Number.isFinite(p.downloadCount) ? `<span>${icon('download')}${p.downloadCount.toLocaleString()} downloads</span>` : ''}</div>
      <div class="tags">${p.categoryNames.map((n) => `<span class="tag">${esc(n)}</span>`).join('')}</div>
      ${p.missingModelTextures?.length ? `<div class="notice warn">${icon('alert')}<div>Paint files installed, but the matching rider model is missing (${esc(p.missingModelTextures.join(', '))}). These files do not include that model.</div></div>` : hasUpdate ? `<div class="notice info">${icon('refresh')}<div>You have this mod, and there's a newer version.</div></div>` : installed ? `<div class="notice ok">${icon('check')}<div>You already have this mod.</div></div>` : ''}
      ${(p.modelDependencies || []).filter((d) => d.kind === 'bikeSwap').length > 1 ? '<p class="muted">Choose the model swap for your bike and downloaded paint variant. The linked versions are alternatives.</p>' : ''}
      ${(p.modelDependencies || []).filter((d) => d.kind === 'bikeSwap' || p.downloads.filter((dl) => !dl.shop).length <= 1).map((d, i) => `<div class="notice ${d.installed === true ? 'ok' : d.installed === false ? 'warn' : 'info'}">${icon(d.installed === true ? 'check' : d.installed === false ? 'alert' : 'info')}<div><b>${d.kind === "bikeSwap" ? "Required bike model swap" : "Base model"}: ${esc(d.label)}</b><div>${d.installed === true ? `Installed${d.matchedName ? ` (${esc(d.matchedName)})` : ''}${d.kind === 'bikeSwap' && !d.active ? ' — select it under Rider → Bike → Appearance before riding.' : ' — ready to use.'}` : d.installed === false ? 'Missing — install the base model before equipping this add-on.' : d.unidentified ? 'The listing does not identify the model. Download for review to check the files before installing.' : 'Couldn’t verify it locally. Check the creator’s required model before installing.'}</div>${d.url ? dependencyButton(d) : `<button class="btn btn-sm" data-find-required="${(p.modelDependencies || []).indexOf(d)}">${icon('search')}Find base model</button>`}</div></div>`).join('')}
      ${p.needsModelNotice && needsModelWarning(p) && !p.modelDependencies?.length ? `<div class="notice info">${icon('info')}<div>The creator specifies another model for these paints. Check the description and install the matching model before equipping them.</div></div>` : ''}
      ${paintRequirement(p) && !p.needsModelNotice && !p.modelDependencies?.length ? `<div class="notice info">${icon('info')}<div>These paint files need the matching ${esc(paintRequirement(p))}. The base model may be included with MX Bikes or linked in the creator's instructions; the paint download does not necessarily include it.</div></div>` : ''}
      ${(p.dependencies || []).some((d) => d.url && !(p.modelDependencies || []).some((m) => m.url === d.url)) ? `<div class="dependency-links"><b>Related model pages</b><div>${p.dependencies.filter((d) => d.url && !(p.modelDependencies || []).some((m) => m.url === d.url)).map((d) => dependencyButton(d, d.label)).join('')}</div></div>` : ''}
      ${p.madeFor ? `<div class="notice info">${icon('info')}<div>${esc(p.madeFor)}</div></div>` : ''}
      ${p.paid ? `<div class="notice warn">${icon('alert')}<div>This is a paid mod — buy it from the creator's store, then drag the downloaded file onto this window to install it.</div></div>` : ''}
      <div class="post-download-heading"><div class="section-title">Downloads</div>${installed ? `<button class="btn btn-danger btn-sm" data-post-remove>${icon('trash')}Delete installed files</button>` : ''}</div>
      <div class="dl-list">${dls}</div>
    </div></div>`;
  refreshInlineDownloads(m);
  $('.modal-body', m).scrollTop = scroll;
  };
  const renderDetails = () => {
    try { draw(); return true; }
    catch (error) {
      console.error('Could not render mod details', error);
      const panel = $('.post > div:last-child', m) || $('.modal-body', m);
      panel.innerHTML = `<div class="notice danger">${icon('alert')}<div>Could not display this mod. ${esc(error?.message || 'Try opening it again.')}</div></div>`;
      return false;
    }
  };
  let revision = 0;
  refresh = async () => {
    const request = ++revision;
    const fresh = await api.invoke('site:post', summary.id);
    if (m.isConnected && request === revision) { p = fresh; renderDetails(); }
  };
  openPostRefreshers.add(refresh);
  if (!renderDetails()) return;
  $('[data-share-mod]', m).addEventListener('click', () => shareModDialog(p));
  $('[data-report-mod]', m)?.addEventListener('click', () => reportCoremxMod(p));
  if (install && !p.paid) installLinkedDownload(p, file);
  $('.modal-body', m).addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-post-tab]');
    if (tab) {
      postTab = tab.dataset.postTab;
      $$('[data-post-tab]', m).forEach((b) => b.classList.toggle('active', b === tab));
      $('.post .desc:not(.post-install)', m).hidden = postTab === 'install';
      $('.post-install', m).hidden = postTab !== 'install';
      return;
    }
    const findRequired = e.target.closest('[data-find-required]');
    if (findRequired) {
      const dependency = (p.modelDependencies || [])[Number(findRequired.dataset.findRequired)];
      if (!dependency) return;
      const label = findRequired.innerHTML; findRequired.disabled = true; findRequired.textContent = 'Finding…';
      try {
        const matches = await api.invoke('site:findDependency', dependency);
        const best = matches[0];
        if (!best) { toast(`Could not find <b>${esc(dependency.label)}</b> in MXB Mods, MXB Hub, or MX Bikes Shop.`, 'err', 5000); return; }
        if (best.source === 'mxb-mods') openPost(best);
        else openProduct(best);
      } catch (err) { toast(esc(cleanErr(err)), 'err', 5000); }
      finally { if (findRequired.isConnected) { findRequired.disabled = false; findRequired.innerHTML = label; } }
      return;
    }
    const review = e.target.closest('[data-inline-review]');
    if (review) { openReview(review.dataset.inlineReview); return; }
    const remove = e.target.closest('[data-post-remove]');
    if (remove) {
      if (!(await confirmBox('Delete installed files', `Move files installed by <b>${esc(p.title)}</b> to the Recycle Bin?`, 'Delete files', true))) return;
      remove.disabled = true;
      try {
        const result = await api.invoke('installs:uninstall', String(p.id));
        await refreshInstalledIds(); await rescan(true);
        if (!result?.kept) m.close(); else refresh().catch(() => {});
        toast(result?.kept ? `Removed ${result.removed} plugin file(s); kept ${result.kept} edited or shared file(s).` : 'Installed files removed', result?.kept ? 'info' : 'ok', 6000);
      }
      catch (error) { remove.disabled = false; toast(esc(cleanErr(error)), 'err', 6000); }
      return;
    }
    const g = e.target.closest('[data-gal]');
    if (g) { $('#galMain', m).src = p.images[Number(g.dataset.gal)]; $$('[data-gal]', m).forEach((x) => x.classList.toggle('active', x === g)); }
    const d = e.target.closest('[data-dl]');
    if (d) {
      const dl = p.downloads[Number(d.dataset.dl)];
      const label = d.innerHTML;
      d.disabled = true; d.textContent = 'Starting…';
      try {
        if (await startDownload(p, dl)) refreshInlineDownloads(m);
        else { d.disabled = false; d.innerHTML = label; }
      } catch (e) { d.disabled = false; d.innerHTML = label; toast(esc(cleanErr(e)), 'err', 6000); }
    }
  });
}

function needsModelWarning(p) {
  if (p.modelDependencies?.some((d) => d.kind === 'bikeSwap' && d.installed !== true)) return true;
  if (p.installKind === 'bikePaint' || p.kind === 'bikePaint' || (p.categories || []).some((c) => [37, 51, 361].includes(Number(c)))) return false;
  if (p.modelDependencies?.length && p.modelDependencies.every((d) => d.installed === true) && !p.missingModelTextures?.length) return false;
  return p.gearKind === 'paint' || !!p.needsModelNotice || !!p.modelDependencies?.length || !!p.missingModelTextures?.length;
}

function warnBeforePaintInstall(p, staged = false) {
  return new Promise((resolve) => {
    let settled = false;
    const dependencies = p.modelDependencies || [];
    const modelPage = dependencies.find((d) => d.installed !== true && d.url)?.url || dependencies.find((d) => d.url)?.url;
    const page = modelPage || p.link;
    const unidentified = dependencies.some((d) => d.unidentified);
    const missing = dependencies.some((d) => d.installed === false) || !!p.missingModelTextures?.length;
    const m = modal({
      title: missing ? 'Required model is missing' : 'Check the required model first', size: 'sm',
      body: `<div class="notice warn">${icon('alert')}<div><b>${unidentified ? 'The compatible rider model is not named on this listing.' : 'These paints need a matching model.'}</b><p>Paint files change how an existing model looks. They will not work properly until you have the matching model installed.</p></div></div>${dependencies.length ? `<div class="friend-gear-list">${dependencies.map((d) => `<div class="friend-gear-row"><div><b>${esc(d.label)}</b><div>${d.installed ? 'Installed' : d.installed === false ? 'Missing' : 'Not yet verified'}</div></div></div>`).join('')}</div>` : '<p class="muted">The matching model has not been confirmed. Check the creator’s instructions before continuing.</p>'}<p class="muted">${staged ? 'The files are downloaded but not installed. Choose the matching model in the next step.' : 'Continue downloads the files for review. It will not install them automatically.'}</p>`,
      foot: `<button class="btn" data-close>Cancel</button>${page ? `<button class="btn" data-required-page>${icon(isMxbModelPage(page) ? 'download' : 'external')}${isMxbModelPage(page) && dependencies.some((d) => d.url) ? 'Install model' : dependencies.some((d) => d.url) ? 'Open model page' : 'Read instructions'}</button>` : ''}<button class="btn btn-primary" data-continue-paint>Continue to review</button>`,
      onClose: () => { if (!settled) resolve(false); },
    });
    const finish = (choice) => { settled = true; m.close(); resolve(choice); };
    $('[data-continue-paint]', m).addEventListener('click', () => finish(true));
    $('[data-required-page]', m)?.addEventListener('click', async () => {
      try { finish(false); if (modelPage) await installDependency(page); else await api.invoke('open:external', page); }
      catch (e) { toast(esc(cleanErr(e)), 'err', 5000); }
    });
  });
}

// A track's "Server Version" download: a cut-down copy for running a dedicated server (little or no
// scenery). Ridden, the track looks empty or black, and when it has the player file's name it
// replaces the player track. It is labelled, asked about, and never replaces an installed track.
function isServerDownload(d) {
  const flag = String(d?.flag || ''), label = String(d?.label || '');
  // The download's flag (Default, Recommended, Server Version…) decides; the label only when there
  // is no flag ("Default: … Server versions for both in the zip too" is the normal download).
  if (flag.trim()) return /\bserver\b/i.test(flag) && !/\bplayer\b/i.test(flag);
  return /\bserver\b/i.test(label) && !/\bplayer\b/i.test(label);
}

// A download started from Missing gear or a friend's gear list (within 15 minutes of opening it from
// there): gear for another rider, so it isn't offered for your own rider when it finishes.
function othersGear() {
  const pick = S.othersGearPick;
  if (!pick || Date.now() - pick.at > 15 * 60 * 1000) { S.othersGearPick = null; return {}; }
  S.othersGearPick = null;   // one download
  return { forOthers: true, friendName: pick.who || '' };
}
async function startDownload(p, dl) {
  const serverVersion = isServerDownload(dl);
  if (serverVersion && !await confirmBox('Install the server version?', '<p>This is the <b>server version</b> of the track: a cut-down copy for running a dedicated server, with little or no scenery. If you ride it, the track looks empty or black.</p><p>To ride, install the player version (Recommended / Default) instead. CoreMX never lets the server version replace a player track you have installed.</p>', 'Install server version')) return false;
  p = { ...p, modelDependencies: dl.modelDependencies ?? p.modelDependencies, dependencies: dl.modelDependencies?.length ? dl.modelDependencies : p.dependencies };
  const modelWarning = needsModelWarning(p);
  if (modelWarning && !await warnBeforePaintInstall(p)) return false;
  const animation = (p.categories || []).some((id) => Number(id) === 519);
  const animationLocation = animation ? p.animationLocation : null;
  const requireReview = modelWarning || animation;
  const id = await api.invoke('jobs:start', {
    title: p.title, postId: p.id, url: dl.url, image: p.image, link: p.link, modified: p.modified,
    categories: p.categories, categoryNames: p.categoryNames, dependencies: p.dependencies, ...othersGear(), requireReview: requireReview || serverVersion, modelWarningAccepted: modelWarning, animationLocation, serverVersion,
  });
  if (id && !S.jobs.has(id)) S.jobs.set(id, { id, title: p.title, url: dl.url, status: 'queued', createdAt: Date.now() });
  refreshInlineDownloads();
  toast(`Downloading <b>${esc(p.title)}</b>…`, 'info', 2500);
  return true;
}

// ---------- downloads ----------
const STATUS_LABEL = { queued: 'Queued', downloading: 'Downloading', extracting: 'Unpacking', review: 'Needs review', installing: 'Installing', done: 'Installed', error: 'Failed', browser: 'Waiting for browser' };

function inlineDownloadHtml(j) {
  const known = j.status === 'downloading' && j.total > 0;
  const pct = known ? Math.max(0, Math.min(100, Math.floor((j.received || 0) / j.total * 100))) : 0;
  const complete = j.status === 'review' || j.status === 'done';
  const hints = {
    queued: 'Waiting to start. Keep this page open or check Downloads.',
    downloading: 'Download and extraction must finish before installation can continue.',
    browser: 'Complete the download in the browser window. Progress will appear here when the file starts downloading.',
    extracting: 'Extracting the files. You will be asked to choose a destination if one cannot be matched automatically.',
    review: 'Ready for review. Confirm the install popup, or click Review & install to reopen it.',
    installing: 'Installing the mod. Please wait until this says Installed.',
    done: 'Installation complete.', error: j.error || 'Download failed. You can try again.',
  };
  return `<div class="download-inline-status ${j.status === 'error' ? 'sync-warning' : ''}"><b>${esc(STATUS_LABEL[j.status] || j.status)}</b><span>${known ? `${pct}% · ${fmtSize(j.received)} / ${fmtSize(j.total)}` : ''}</span></div>${j.status === 'error' ? '' : `<progress max="100" ${known || complete ? `value="${complete ? 100 : pct}"` : ''} aria-label="Mod download and installation progress"></progress>`}<div class="muted">${esc(hints[j.status] || j.note || '')}</div>`;
}

function refreshInlineDownloads(root = document) {
  const jobs = [...S.jobs.values()].reverse();
  for (const row of $$('[data-download-url]', root)) {
    const job = jobs.find((j) => j.url && j.url === row.dataset.downloadUrl);
    const box = $('[data-download-progress]', row);
    if (!box) continue;
    if (!job || job.filesDeleted || job.status === 'done') {
      box.hidden = true; box.replaceChildren();
      const button = $('[data-dl], [data-own-file]', row);
      if (button && job) {
        button.disabled = !job.filesDeleted;
        button.textContent = job.filesDeleted ? 'Install' : 'Installed';
        delete button.dataset.inlineReview;
      }
      continue;
    }
    box.hidden = false; box.innerHTML = inlineDownloadHtml(job);
    const button = $('[data-dl], [data-own-file]', row);
    if (button) {
      button.disabled = !['error', 'review'].includes(job.status);
      button.textContent = job.status === 'review' ? 'Review & install' : job.status === 'error' ? job.error === 'Cancelled' ? 'Install' : 'Try again' : STATUS_LABEL[job.status] || 'Please wait…';
      if (job.status === 'review') button.dataset.inlineReview = job.id;
      else delete button.dataset.inlineReview;
    }
  }
}

function jobHtml(j) {
  const pct = j.total ? Math.min(100, (j.received / j.total) * 100) : 0;
  const running = ['downloading', 'extracting', 'installing', 'queued'].includes(j.status);
  const prog = running ? `<div class="progress ${!j.total || j.status !== 'downloading' ? 'indet' : ''}"><div style="width:${pct}%"></div></div>` : '';
  const sizeTxt = j.status === 'downloading' ? `${fmtSize(j.received)}${j.total ? ' / ' + fmtSize(j.total) : ''}` : j.fileName ? esc(j.fileName) : '';
  const acts = [];
  if (j.status !== 'queued' && j.status !== 'browser') acts.push(`<button class="btn btn-sm btn-ghost btn-icon" data-job-act="reveal" title="Show in folder" aria-label="Show in folder">${icon('folder')}</button>`);
  if (['done', 'error', 'review'].includes(j.status) && !j.filesDeleted) acts.push(`<button class="btn btn-sm btn-ghost btn-icon" data-job-act="delete-files" title="${j.status === 'done' ? 'Delete installed files' : 'Delete downloaded file'}" aria-label="Delete files">${icon('trash')}</button>`);
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

// Counts at the top of Downloads so it's clear what needs you.
function downloadSummaryHtml(list) {
  const n = { active: 0, review: 0, done: 0, error: 0 };
  for (const j of list) {
    if (j.status === 'review' || j.status === 'browser') n.review++;
    else if (j.status === 'done') n.done++;
    else if (j.status === 'error') n.error++;
    else n.active++;
  }
  const tile = (ic, value, label, tone) => `<div class="sum-tile static ${value ? tone : ''}"><span class="sum-ico">${icon(ic)}</span><span class="sum-txt"><b>${value}</b><small>${label}</small></span></div>`;
  return `<div class="lib-summary dl-summary">${tile('download', n.active, 'Downloading', 'accent')}${tile('alert', n.review, 'Needs your OK', 'warn')}${tile('check', n.done, 'Installed', 'ok')}${tile('x', n.error, 'Failed or removed', 'bad')}</div>`;
}
function renderDownloads(c) {
  if (S.dlTab === 'recent') { renderRecentInstalls(c); return; }
  const list = [...S.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>Downloads</h2>${dlTabs("downloads")}<div class="grow"></div>
      <button class="btn" data-act="pick-files">${icon('upload')}Install from file…</button>
      ${list.some((j) => ['done', 'error'].includes(j.status)) ? `<button class="btn btn-ghost" data-act="clear-jobs" title="Clear completed history; installed files and active downloads are kept">Clear all completed</button>` : ''}</div>
    <div class="scroller">${list.length ? downloadSummaryHtml(list) : ''}<div class="jobs" id="jobsList">${list.length ? list.map(jobHtml).join('') : `<div class="empty"><div>${icon('download')}<h3>No downloads yet</h3><div>Install mods from Get Mods, or drag .pkz, .zip or .rar files onto this window.</div></div></div>`}</div></div>
  </div></div>`;
}

async function renderRecentInstalls(c) {
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Downloads</h2>${dlTabs('recent')}</div><div class="scroller" id="recentInstalls"><div class="loadmore"><div class="spinner"></div></div></div></div></div>`;
  try {
    const all = await api.invoke('installs:list'); S.installs = all;
    const rows = Object.entries(all).sort((a, b) => b[1].installedAt - a[1].installedAt).slice(0, 10);
    const box = $('#recentInstalls'); if (!box) return;
    box.innerHTML = `<p class="muted">Your last 10 installs. Change a location to move installed files; nothing is downloaded again.</p><div class="srv-list">${rows.map(([key, rec]) => `<div class="srv"><div class="srv-ico">${icon('download')}</div><div class="srv-txt"><div class="t">${esc(rec.title)}</div><div class="m">${esc(rec.kind || 'Mod')} · ${esc(timeAgo(rec.installedAt))}</div><div class="m recent-path">${esc(rec.files.slice(0, 2).join(' · '))}${rec.files.length > 2 ? ` · +${rec.files.length - 2} more` : ''}</div></div><div class="jactions">${rec.link ? `<button class="btn btn-sm" data-open="${esc(rec.link)}">${icon('external')}Source page</button>` : ''}${!rec.files.some((f) => /^(game|user):/.test(f)) ? `<button class="btn btn-sm" data-edit-install="${esc(key)}">Change install location</button>` : rec.files.some((f) => f.startsWith('user:')) ? '<span class="muted">MX Bikes documents folder</span>' : '<span class="muted">MX Bikes install folder</span>'}</div></div>`).join('') || '<div class="set-card muted">No recorded installs yet.</div>'}</div>`;
  } catch (e) { const box = $('#recentInstalls'); if (box) box.textContent = cleanErr(e); }
}
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-edit-install]'); if (!button) return;
  button.disabled = true;
  try { const job = await api.invoke('installs:editLocation', button.dataset.editInstall); S.jobs.set(job.id, job); openReview(job.id); }
  catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
  finally { button.disabled = false; }
});

function updateJobInPlace(j) {
  const el = $(`[data-job="${j.id}"]`);
  if (el) { const t = document.createElement('div'); t.innerHTML = jobHtml(j); el.replaceWith(t.firstElementChild); }
  else if (S.view === 'downloads') renderDownloads($('#content'));
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-job-act]');
  if (!b) return;
  if (b.dataset.jobAct === 'delete-files') {
    const id = b.closest('[data-job]').dataset.job, j = S.jobs.get(id);
    if (!(await confirmBox('Delete files', j.status === 'done' ? `Move the files installed by <b>${esc(j.title)}</b> to the Recycle Bin?` : `Move the downloaded file for <b>${esc(j.title)}</b> to the Recycle Bin?`, 'Delete files', true))) return;
    try { const result = await api.invoke('jobs:deleteFiles', id); toast(result?.kept ? `Removed ${result.removed} plugin file(s); kept ${result.kept} edited or shared file(s).` : 'Files deleted', result?.kept ? 'info' : 'ok', 6000); }
    catch (e) { toast(esc(cleanErr(e)), 'err', 6000); }
    return;
  }
  if (b.dataset.jobAct === 'reveal') {
    try { await api.invoke('jobs:reveal', b.closest('[data-job]').dataset.job); }
    catch (e) { toast(esc(cleanErr(e)), 'err', 4500); }
    return;
  }
  const id = b.closest('[data-job]').dataset.job;
  const act = b.dataset.jobAct;
  if (act === 'review') openReview(id);
  else if (act === 'retry') api.invoke('jobs:retry', id);
  else if (act === 'browser') api.invoke('jobs:openBrowser', id);
  else if (act === 'cancel') api.invoke('jobs:cancel', id);
  else if (act === 'library') { S.lib.quick = 'app'; go('library'); }
  else if (act === 'dismiss') {
    const job = S.jobs.get(id);
    const choice = await dismissDownloadPrompt(job);
    if (!choice) return;
    try {
      if (choice === 'delete' && !job.filesDeleted) await api.invoke('jobs:deleteFiles', id);
      await api.invoke('jobs:dismiss', id);
      S.jobs.delete(id); renderDownloads($('#content')); renderRail();
      toast(choice === 'delete' ? 'Files moved to the Recycle Bin' : 'Removed from Downloads. Files were kept.', 'ok');
    } catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
  }
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
  { id: 'tyre', label: 'Tyres / wheels', icon: 'tyre' },
  { id: 'bikeFont', label: 'Number font', icon: 'paint', hint: 'plate numbers' },
  { id: 'riderFont', label: 'Rider font', icon: 'shirt', hint: 'name & number' },
  { id: 'setup', label: 'Bike setup', icon: 'settings', hint: '.stp file' },
  { id: 'stand', label: 'Bike stand', icon: 'bike' },
  { id: 'pitboard', label: 'Pitboard', icon: 'image' },
  { id: 'translation', label: 'Translation', icon: 'globe', hint: '.str language file' },
  { id: 'plugin', label: 'Game plugin', icon: 'box', hint: '.dlo and its companion folder' },
  { id: 'custom', label: 'Something else', icon: 'folder', hint: 'choose the folder' },
];
let reviewOpen = null;
const reviewWarnings = new Set(), pendingReviews = new Set();
async function openReview(id) {
  const j = S.jobs.get(id);
  if (!j || !j.plan || pendingReviews.has(id)) return;
  if (j.plan.requiresModelWarning && !j.modelWarningAccepted && !reviewWarnings.has(id)) {
    pendingReviews.add(id);
    try {
      const dependencies = (j.plan.requiredModels || []).filter((r) => !r.included).map((r) => ({ label: r.name, installed: r.installed }));
      if (!await warnBeforePaintInstall({ link: j.link || j.url, modelDependencies: dependencies }, true)) return;
      reviewWarnings.add(id);
    } finally { pendingReviews.delete(id); }
    if (S.jobs.get(id)?.status !== 'review') return;
  }
  if (reviewOpen) reviewOpen.close();
  let opts = { ...(j.plan.options || {}), kind: j.plan.kind };
  let paintModelInfo = j.plan.paintModelInfo || [];
  const targetBike = (name) => bikeItem(name) || paintModelInfo.find((i) => i.name === name);
  const targetFilters = { brand: '', cc: '', query: '' };
  const targetMatches = (name) => {
    const bike = targetBike(name);
    return (!targetFilters.brand || (bike && bike.brand === targetFilters.brand)) && (!targetFilters.cc || (bike && String(bike.cc) === targetFilters.cc));
  };
  const m = modal({
    title: `${j.relocateKey ? 'Change install location' : 'Install'} — ${esc(j.title)}`, size: 'md', body: '<div id="rv"></div>',
    foot: `${j.link ? `<button class="btn btn-ghost btn-sm" data-open="${esc(j.link)}">${icon('external')}Source page</button>` : ''}<span class="grow" id="rvSummary"></span><button class="btn" data-close>${j.relocateKey ? 'Cancel' : 'Later'}</button><button class="btn btn-primary" id="rvInstall">${icon('download')}Install</button>`,
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
    const ctl = [], targets = [];
    const bikeTarget = p.kind === 'bikePaint' || p.paintModelsBase === 'bikes';
    const typeControl = `<div class="field"><label>Content type</label><select data-opt="kind">${p.kinds.map((k) => `<option value="${k.id}" ${k.id === p.kind ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></div>`;
    if (p.kind === 'track') ctl.push(`<div class="field"><label>Track type</label><select data-opt="trackType">${p.trackTypes.map((t) => `<option ${t === p.options.trackType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`);
    if (p.kind === 'sound' && (p.needsSoundBike || p.options.soundBike)) ctl.push(`<div class="field"><label>Install sound on bike</label><select data-opt="soundBike"><option value="">Choose an installed bike…</option>${(p.soundBikes || []).map((n) => `<option value="${esc(n)}" ${n === p.options.soundBike ? 'selected' : ''}>${esc(bikeTitle(n))}</option>`).join('')}</select><small class="muted">Sound files replace the selected bike's current sounds. Close MX Bikes before installing.</small></div>`);
    if (p.riderModels?.length) {
      const choices = p.riderModels.filter((r) => r.compatible || r.unverified);
      ctl.push(choices.length
        ? `<div class="field"><label>Rider body required by these paints</label><select data-opt="riderTarget"><option value="">— choose the matching installed body —</option>${choices.map((r) => `<option value="${esc(r.name)}" ${r.name === p.options.riderTarget ? 'selected' : ''}>${esc(r.name)}${r.unverified ? ' · compatibility unverified' : ''}</option>`).join('')}</select></div>`
        : '<div class="notice warn">No matching rider body is installed. Install the model linked by the creator, then reopen this review. The default rider cannot use these paint textures.</div>');
    }
    if (p.paintModelsBase && !p.bikeCompatibility?.multiple) {
      const candidates = p.paintModels.filter((n) => !bikeTarget || targetMatches(n) && (n === p.options.paintTarget || !targetFilters.query || bikeTitle(n).toLowerCase().includes(targetFilters.query.toLowerCase())));
      if (bikeTarget) {
        targets.push(`<div class="search review-search">${icon('search')}<input data-target-query placeholder="Search installed bikes…" aria-label="Search target bikes" value="${esc(targetFilters.query)}"></div>`);
        const targetBikes = p.paintModels.map(targetBike).filter(Boolean);
        for (const fc of FACETS.bikes.filter((f) => f.key !== 'cls')) {
          const values = [...new Set(targetBikes.map(fc.get).filter(Boolean))].sort(fc.order || ((a, b) => String(a).localeCompare(String(b))));
          targets.push(`<div class="field"><label>${fc.key === 'cc' ? 'Engine size' : esc(fc.label)}</label><select data-target-filter="${fc.key}"><option value="">${esc(FACET_ALL[fc.key])}</option>${values.map((v) => `<option value="${esc(v)}" ${String(v) === targetFilters[fc.key] ? 'selected' : ''}>${esc(fc.fmt(v))}</option>`).join('')}</select></div>`);
        }
      }
      targets.push(`<div class="field review-target"><label>${bikeTarget ? `Bike · ${candidates.length} listed` : 'Model for these paints'}</label><select data-opt="paintTarget"><option value="">${bikeTarget ? 'Choose a bike…' : 'Choose the matching model…'}</option>${candidates.map((n) => { const check = bikeTarget && p.bikeCompatibility?.targets.find((t) => t.name === n); return `<option value="${esc(n)}" ${n === p.options.paintTarget ? 'selected' : ''} ${check?.status === 'incompatible' ? 'disabled' : ''}>${esc(bikeTarget ? bikeTitle(n) : n)}${check?.status === 'incompatible' ? ' · Incompatible' : check?.status === 'unknown' ? ' · Check year/version' : ''}</option>`; }).join('')}</select>${!candidates.length ? `<small class="muted">${p.paintModels.length ? 'No bikes match these filters.' : 'Install the matching model first, then reopen this review.'}</small>` : ''}</div>`);
    }
    if (p.variants?.length) ctl.push(`<div class="field"><label>Version to install</label><select data-opt="variant"><option value="">Choose one…</option>${p.variants.map((v) => `<option value="${esc(v.id)}" ${v.id === p.options.variant ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select><small class="muted">The game uses one at a time. Install again later to switch.</small></div>`);
    if (p.kind === 'custom') ctl.push(`<div class="field"><label>Folder inside mods/</label><input class="input" data-opt="customDir" list="dirsList" placeholder="e.g. bikes/MY_BIKE/paints" value="${esc(p.options.customDir || '')}"><datalist id="dirsList">${['bikes', 'tracks/motocross', 'tracks/supercross', 'rider/paints', 'rider/helmets', 'rider/boots', 'rider/gloves', 'rider/protections', 'tyres', 'misc'].map((d) => `<option value="${d}">`).join('')}</datalist></div>`);
    const missingModels = (p.requiredModels || []).filter((r) => r.kind !== 'bike' && !r.installed && !r.included);
    const dependencyHelp = missingModels.map((r) => `<button class="btn btn-sm" data-act="paint-get" data-name="${esc(r.name)}">${icon('search')}Find ${esc(r.name)} model</button>`).join('') + (p.dependencies || []).filter((d) => d.url).map((d) => dependencyButton(d, d.label)).join('');
    const bikeHelp = p.bikeCompatibility?.messages.length ? `<div class="notice ${p.bikeCompatibility.blocked ? 'warn' : 'info'}">${icon(p.bikeCompatibility.blocked ? 'alert' : 'info')}<div>${p.bikeCompatibility.messages.map(esc).join('<br>')}</div></div>` : '';
    const swapHelp = (p.dependencies || []).filter((d) => d.kind === 'bikeSwap').map((d) => `<div class="notice ${d.installed ? 'ok' : 'warn'}">${icon(d.installed ? 'check' : 'alert')}<div><b>Required model swap: ${esc(d.label)}</b><div>${d.installed ? 'Installed. Select this appearance on the matching bike before riding.' : 'This paint needs the matching model swap. Buy or install that model before using the paint.'}</div>${d.url ? dependencyButton(d) : ''}</div></div>`).join('');
    const warn = swapHelp + bikeHelp + p.warnings.map((w) => `<div class="notice warn">${icon('alert')}<div>${esc(w)}</div></div>`).join('') + (dependencyHelp ? `<div class="dependency-links"><b>Model pages linked by the creator / required models</b><div>${dependencyHelp}</div></div>` : '');
    const waiting = p.needsPaintTarget || p.needsRiderTarget || p.needsSoundBike || p.needsVariant;
    const rows = p.entries.map((e) => `<div class="plan-row"><div class="src" title="${esc(e.rel)}">${esc(e.rel)}</div>${icon('chevron')}<div class="dst" title="${esc(e.dest || e.bikeMatch?.message || '')}">${e.dest ? (p.root === 'game' ? 'game/' : p.root === 'user' ? 'documents/' : 'mods/') + esc(e.dest) : `<span class="muted">${e.how === 'server-copy' ? 'Server copy — not needed to ride' : e.how === 'multiple-variants' ? 'Multiple variants — install separately' : e.how === 'choose-variant' ? 'Choose a version above' : e.how === 'other-variant' ? 'Other version — not installed' : e.how === 'script' ? 'Script — CoreMX never runs these' : e.how === 'paint-elsewhere' ? 'Trackside paint — not part of this install' : e.bikeMatch?.status === 'missing' ? 'Bike mod not installed' : e.bikeMatch?.status === 'incompatible' ? 'Incompatible bike' : waiting ? 'Choose a target above' : 'Not included'}</span>`}</div><span class="pill ${e.status === 'unresolved' && waiting ? 'pending' : e.status}">${({ new: 'Ready', overwrite: 'Replace', skip: 'Skipped', unresolved: e.how === 'multiple-variants' || e.how === 'choose-variant' ? 'Choose variant' : waiting ? 'Choose target' : 'Unmatched' })[e.status] || esc(e.status)}</span></div>`).join('');
    $('#rv', m).innerHTML = `<div class="review-heading"><span class="slot-ico">${icon(bikeTarget ? 'bike' : 'download')}</span><div><h3>${p.needsVariant ? 'Choose a version' : waiting ? bikeTarget ? 'Choose a bike' : 'Choose a model' : 'Ready to install'}</h3><p>${bikeTarget ? p.options.paintTarget ? `${p.kind === 'setup' ? 'Setup for' : 'Install for'} <b>${esc(bikeTitle(p.options.paintTarget))}</b>.${p.paintGuess === 'title' ? ' Suggested from the mod name—check it is the right bike.' : ''}` : (p.kind === 'setup' ? 'Pick the bike this setup is for.' : 'Pick the base bike this download was made for.') : `${p.totalEntries} file${p.totalEntries === 1 ? '' : 's'} · ${esc(p.kindLabel)}`}</p></div></div>${warn}${targets.length ? `<div class="review-targets">${targets.join('')}</div>` : ''}${ctl.length ? `<div class="plan-controls">${ctl.join('')}</div>` : ''}
      <details class="review-details"><summary>Files & destination <span class="muted">· ${p.totalEntries} file${p.totalEntries === 1 ? '' : 's'}</span></summary><div class="plan-table">${rows}</div>${p.totalEntries > p.entries.length ? `<p class="muted">…and ${p.totalEntries - p.entries.length} more</p>` : ''}</details><details class="review-details"><summary>Change content type</summary><div class="plan-controls">${typeControl}</div></details>`;
    $('#rvSummary', m).textContent = waiting ? `Choose ${p.needsVariant ? 'a version' : p.needsSoundBike ? 'an installed bike' : bikeTarget ? 'a bike' : 'the matching model'} to continue` : `${p.installable} file${p.installable === 1 ? '' : 's'} ready`;
    $('#rvInstall', m).innerHTML = `${icon('download')}${j.relocateKey ? 'Move files' : p.kind === 'bikeSwap' ? 'Install model swap' : p.kind === 'setup' ? 'Install setup' : bikeTarget ? 'Install livery' : 'Install'}`;
    $('#rvInstall', m).disabled = !p.installable || p.needsVariant || p.needsPaintTarget || p.needsRiderTarget || p.needsSoundBike || p.bikeCompatibility?.blocked || (p.paintModelsBase === 'bikes' && p.options.paintTarget && !targetMatches(p.options.paintTarget));
  };
  draw(j);
  if (j.plan.needsRiderTarget || (j.plan.requiredModels || []).some((r) => !r.installed && !r.included)) {
    api.invoke('jobs:plan', id, opts).then((fresh) => {
      if (!m.isConnected || !fresh?.plan) return;
      S.jobs.set(id, fresh); opts = { ...fresh.plan.options, kind: fresh.plan.kind }; draw(fresh);
    }).catch((e) => toast(esc(cleanErr(e)), 'err', 5000));
  }
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
    if (k === 'kind') { delete opts.paintTarget; delete opts.riderTarget; }
    const nj = await api.invoke('jobs:plan', id, opts);
    if (nj) { S.jobs.set(id, nj); opts = { ...nj.plan.options, kind: nj.plan.kind }; draw(nj); }
  });
  $('#rv', m).addEventListener('input', (e) => {
    if (!e.target.hasAttribute('data-target-query')) return;
    const selection = e.target.selectionStart;
    targetFilters.query = e.target.value; draw(S.jobs.get(id) || j);
    const search = $('[data-target-query]', m); search.focus(); search.setSelectionRange(selection, selection);
  });
  $('#rvInstall', m).addEventListener('click', async (e) => {
    const current = S.jobs.get(id) || j;
    const p = current.plan;
    e.target.disabled = true;
    try { await api.invoke('jobs:install', id, opts); m.close(); }
    catch (error) { e.target.disabled = false; toast(esc(cleanErr(error)), 'err', 5000); }
  });
}

// ---------- rider (loadout per bike, stored in the game profile) ----------
S.rider = { profile: null, profiles: [], bikes: null, bike: null, lo: null, drafts: {}, identityDraft: {}, selectionDirty: false };
const riderDraftKey = () => `${S.rider.profile}|${S.rider.bike}`;
const riderChanges = () => ({ ...(S.rider.drafts[riderDraftKey()] || {}), ...S.rider.identityDraft });
const riderDirty = () => S.rider.selectionDirty || Object.keys(riderChanges()).length > 0;
const SLOT_ICONS = { bikePaint: 'paint', rider: 'rider', helmet: 'helmet', helmetPaint: 'paint', gogglesPaint: 'goggles', suitPaint: 'shirt', protection: 'shield', protectionPaint: 'paint', glovesPaint: 'glove', boots: 'boot', bootsPaint: 'paint' };
const PAINT_SLOTS = new Set(['bikePaint', 'helmetPaint', 'gogglesPaint', 'suitPaint', 'protectionPaint', 'glovesPaint', 'bootsPaint']);
// Choosing a new model resets the paints that belonged to the old one.
const RESETS = { bikeAppearance: ['bikePaint'], rider: ['suitPaint', 'glovesPaint'], helmet: ['helmetPaint', 'gogglesPaint'], boots: ['bootsPaint'], protection: ['protectionPaint'] };

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
function gearItem(slotId, value, context = S.rider) {
  if (slotId === 'bikePaint') {
    const paint = S.items.find((i) => i.group === 'bikePaints' && !i.disabled && i.bike === context.bike && i.name === value);
    return paint || (!value || value.toLowerCase() === 'stock' ? bikeItem(context.bike) : null);
  }
  const sub = { helmet: 'helmets', boots: 'boots', protection: 'protections' }[slotId];
  if (!sub || !value) return null;
  return S.items.find((i) => i.group === 'rider' && !i.sub.startsWith('legacy/') && i.sub.endsWith(sub) && i.name === value) || null;
}
function bikeItem(id) { return S.items.find((i) => i.group === 'bikes' && i.name === id); }
function bikeTitle(id) { const it = bikeItem(id); return it ? it.title : id.replace(/_/g, ' '); }
function prettyValue(slot, v) {
  if (slot === 'bikeFont') return !v ? 'None' : v === 'default_black' ? 'Black' : v === 'default_white' ? 'White' : v.replace(/_/g, ' ');
  if (slot === 'protection' && !v) return 'None';
  if (slot === 'tyres' && !v) return 'Bike default';
  if (!v) return PAINT_SLOTS.has(slot) ? 'Default' : '—';
  if (v === 'default' || v === 'default_mx') return 'Default';
  return v.replace(/_/g, ' ');
}

// The plugin's in-game overlay (F8 by default; Settings → Plugins) changes the same outfit and bike livery on track.
const overlayKeyName = () => (/^F([1-9]|1[01])$/.test(S.env?.settings?.overlayKey || '') ? S.env.settings.overlayKey : 'F8');
const f8HintHtml = () => `<span class="f8-hint" title="Needs the CoreMX game plugin (Settings → Plugins, where you can change the key). Paints change at once; a new helmet, boots or protector shows when you go back to the pits. Locked during races."><kbd>${overlayKeyName()}</kbd>in game to change your outfit and bike on track</span>`;
async function renderRider(c) {
  const R = S.rider;
  const request = R.renderRequest = (R.renderRequest || 0) + 1;
  if (S.riderTab === 'gear') {
    for (const key of ['viewer', 'bikeViewer']) if (R[key]) { R[key].dispose(); R[key] = null; }
    R.modelKey = null; R.bikeModelKey = null; R.modelOk = false;
    if (S.lib.scope !== 'rider') { S.lib.scope = 'rider'; S.lib.tab = 'helmets'; S.lib.f = {}; S.lib.query = ''; }
    renderLibrary(c);
    return;
  }
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Rider</h2><span class="sub">Pick your gear for each bike</span></div><div class="scroller"><div class="loadmore"><div class="spinner"></div></div></div></div></div>`;
  try {
    if (!R.profile || !R.profiles.length) { const p = await api.invoke('rider:profiles'); if (request !== R.renderRequest) return; R.profiles = p.profiles; R.profile ||= p.last; R.activeProfile = p.last; }
    if (!R.profile) {
      c.innerHTML = `<div class="view"><div class="empty" style="margin:auto"><div>${icon('rider')}<h3>No rider profile found</h3><div>CoreMX looked for profiles in <code>${esc(S.env?.profilesDir || 'your MX Bikes folder')}</code> and in your Documents folder, and found none. If you've never started MX Bikes, start it once. If your MX Bikes folder is somewhere unusual, choose it below.</div><div style="display:flex;gap:8px;justify-content:center;margin-top:16px"><button class="btn btn-primary" data-act="pick-user">${icon('folder')}Choose folder</button><button class="btn" data-act="redetect">${icon('refresh')}Find it again</button></div></div></div></div>`;
      return;
    }
    if (!R.bikes) { const bikes = await api.invoke('rider:bikes', R.profile); if (request !== R.renderRequest) return; R.bikes = bikes; }
    if (!R.bike) R.bike = (R.bikes.find((b) => b.selected) || R.bikes.find((b) => b.installed) || R.bikes[0] || {}).id;
    const loadout = await api.invoke('rider:loadout', R.profile, R.bike, riderChanges());
    if (request !== R.renderRequest) return;
    R.lo = loadout;
  } catch (e) {
    if (request !== R.renderRequest) return;
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
    <div class="toolbar rider-toolbar"><div class="rider-heading"><h2>Rider</h2>${riderTabsHtml('bike')}${f8HintHtml()}</div>${profileControlsHtml()}</div>
    <div class="scroller"><div class="bike-preview-layout">
      <div><div class="rider-stage bike-stage" id="bikeStage"><div class="stage-status" id="bikeStatus"><div class="spinner"></div></div><div class="stage-hint">Drag to turn · scroll to zoom · double-click to reset</div></div><div class="stage-note muted" id="bikeNote"></div></div>
      <div class="rider-wrap bike-details"><div class="bike-detail-heading"><div><div class="slot-l">Selected bike</div><h2>${esc(bikeTitle(R.bike))}</h2>${lo.selectedInGame && !riderDirty() ? `<span class="bike-current">${icon('check')}Current bike in game</span>` : ''}</div><button class="btn btn-sm" data-act="rider-pick-bike">${icon('bike')}Change bike</button></div>
      <div class="bike-livery-card"><div class="section-title">Livery</div><button class="slot" data-slot="bikeAppearance"><span class="slot-ico">${icon("bike")}</span><span class="slot-txt"><span class="slot-l">Model</span><span class="slot-v">${esc(lo.appearances?.find((o) => o.id === lo.current.bikeAppearance)?.title || "Default bike")}</span></span><span class="slot-n">${lo.options.bikeAppearance?.length || 1} choices ${icon("chevron")}</span></button><button class="slot" data-slot="bikePaint"><span class="slot-ico">${icon('paint')}</span><span class="slot-txt"><span class="slot-l">Livery</span><span class="slot-v">${esc(prettyValue('bikePaint', lo.current.bikePaint))}</span></span><span class="slot-n">${lo.options.bikePaint.length} choices ${icon('chevron')}</span></button><button class="slot" data-slot="bikeFont"><span class="slot-ico">${icon('shirt')}</span><span class="slot-txt"><span class="slot-l">Number font</span><span class="slot-v">${esc(prettyValue('bikeFont', lo.current.bikeFont))}${lo.identity?.riderNumber ? ` · #${esc(lo.identity.riderNumber)}` : ''}</span></span><span class="slot-n">${(lo.options.bikeFont || []).length} choices ${icon('chevron')}</span></button></div>
      <div class="bike-livery-card"><div class="section-title">Tyres & wheels</div><button class="slot" data-slot="tyres"><span class="slot-ico">${icon('tyre')}</span><span class="slot-txt"><span class="slot-l">Tyre model</span><span class="slot-v">${esc(prettyValue('tyres', lo.current.tyres))}</span></span><span class="slot-n">${lo.options.tyres.length} choices ${icon('chevron')}</span></button><p class="muted" style="font-size:12px">Only tyre sets declared by this bike are listed.${lo.invalidTyres ? ' Your previous choice is incompatible. Apply to reset it to the bike default.' : ''}</p></div><p class="bike-save-note">${icon('info')}Close MX Bikes before saving changes.</p></div>
    </div></div></div></div>`;
  mountProfileControls();
  const key = R.profile + '|' + R.bike + '|' + (lo.current.bikeAppearance || '') + '|' + (lo.current.bikePaint || '') + '|' + (lo.current.tyres || '') + '|' + (lo.current.bikeFont || '') + '|' + (lo.identity?.riderNumber || ''); R.bikeModelKey = key;
  const attach = async () => {
    if (R.bikeModelKey !== key || !$('#bikeStage')) return;
    if (!R.bikeViewer) { const host = document.createElement('div'); host.className = 'stage-canvas'; R.bikeViewer = window.RiderViewer.create(host); }
    $('#bikeStage').prepend(R.bikeViewer.el);
    try {
      const model = await api.invoke('bike:model', R.profile, R.bike, lo.current.bikePaint || '', 1024, { ...lo.current, riderNumber: lo.identity?.riderNumber ?? '' });
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
  const groups = [...new Set(lo.slots.filter((s) => s.group !== 'Bike' && s.id !== 'bikeAppearance').map((s) => s.group))];
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
    <div class="toolbar rider-toolbar"><div class="rider-heading"><h2>Rider</h2>${riderTabsHtml('outfit')}${f8HintHtml()}</div>${profileControlsHtml()}
      <span class="sub">Preview your setup, then Apply to save it to the game</span>
      <button class="btn" data-act="rider-copy-all">${icon('copy')}Use this outfit on all bikes</button></div>
    <div class="scroller"><div class="rider-layout">
      <div class="rider-stage-col"><div class="stage-bar"><label class="stage-toggle"><span class="toggle"><input type="checkbox" id="showBikeToggle" ${riderShowBike() ? 'checked' : ''}><span class="sw"></span></span><span>Show bike</span></label></div><div class="rider-stage" id="riderStage">
        <div class="stage-status" id="stageStatus"><div class="spinner"></div></div>
        <div class="stage-hint">Drag to turn · scroll to zoom · double-click to reset</div>
      </div><div class="stage-note muted" id="stageNote"></div></div>
      <div class="rider-wrap">
      <div class="outfit-bike-context"><span class="muted">Outfit for ${esc(bikeTitle(R.bike))}</span><button class="btn btn-sm" data-rider-tab="bike">${icon('bike')}Bike & livery</button></div>
      <div class="section-title">Game identity</div><div class="rider-identity-card"><label class="rider-identity-row"><span><b>Nickname</b><small>The name shown to other riders in MX Bikes.</small></span><input class="input" id="riderNameInput" maxlength="40" value="${esc(lo.identity.nickname)}" autocomplete="off" spellcheck="false"></label><label class="rider-identity-row"><span><b>Race number</b><small>Shown on your plates and kit in MX Bikes (0–999).</small></span><input class="input rider-number-input" id="riderNumberInput" inputmode="numeric" maxlength="3" value="${esc(lo.identity.riderNumber || '')}" placeholder="—" autocomplete="off"></label></div><p class="muted rider-identity-note">Nickname and number changes are previewed here until you click Apply. CoreMX online syncing still uses your Steam account.</p>
      ${groups.map((g) => `<div class="section-title">${esc(g)}</div><div class="slot-grid">${lo.slots.filter((s) => s.group === g && s.id !== 'bikeAppearance').map(tile).join('')}</div>`).join('')}
      <p class="muted" style="margin-top:22px;font-size:12px">${icon('info')} Close MX Bikes before changing gear here. A backup of your profile is kept next to it.</p>
    </div></div></div></div></div>`;
  mountRiderViewer();
  mountProfileControls();
  for (const [id, key] of [['riderNameInput', 'nickname'], ['riderNumberInput', 'riderNumber']]) {
    const input = $('#' + id);
    input?.addEventListener('change', () => {
      const value = input.value.trim();
      const saved = lo.savedIdentity[key] || '';
      const draft = { ...R.identityDraft };
      if (value === saved) delete draft[key]; else draft[key] = value;
      R.identityDraft = draft;
      R.saveState = 'Preview changes';
      renderRider($('#content'));
    });
  }
}

function profileControlsHtml() {
  const R = S.rider;
  return `<div class="profile-controls"><label>Profile<select id="riderProfile">${R.profiles.map((p) => `<option ${p === R.profile ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label><button class="btn btn-sm" data-act="profile-create">${icon('plus')}Create profile</button><button class="btn btn-icon btn-sm" data-act="profile-delete" title="Delete this profile">${icon('trash')}</button><button class="btn btn-icon btn-sm" data-act="rider-refresh" title="Refresh rider and bike from the game">${icon('refresh')}</button>${riderDirty() ? '<span class="badge">Preview changes</span>' : R.lo?.profileActive ? `<span class="badge ok">${icon('check')}Active in game</span>` : '<button class="btn btn-sm" data-act="profile-activate">Use in game</button>'}</div>`;
}
function mountProfileControls() {
  const controls = $('.profile-controls');
  if (controls) controls.insertAdjacentHTML('beforeend', `<span class="rider-save-state">${riderDirty() ? '' : S.rider.saveState || ''}</span><button class="btn btn-sm" data-act="rider-revert" ${riderDirty() ? '' : 'disabled'}>Revert</button><button class="btn btn-primary btn-sm" data-act="rider-apply">Apply</button>`);
  // Unsaved changes get a floating bar at the bottom so Apply is always in reach.
  const view = $('#content .view');
  $('.save-bar')?.remove();
  if (view && riderDirty()) {
    view.classList.add('has-save-bar');
    // Still the same setup that was queued? (Further edits need Apply again.)
    const queued = S.rider.queued?.get(riderDraftKey()) === JSON.stringify(riderChanges());
    view.insertAdjacentHTML('beforeend', queued
      ? `<div class="save-bar queued"><span class="save-dot"></span><div><b>Waiting for MX Bikes to close</b><small>This outfit is saved automatically a few seconds after you exit the game.</small></div><button class="btn" data-act="rider-cancel-queued">Cancel</button></div>`
      : `<div class="save-bar"><span class="save-dot"></span><div><b>Unsaved changes</b><small>You're previewing. Apply saves it to the game.</small></div><button class="btn" data-act="rider-revert">Revert</button><button class="btn btn-primary" data-act="rider-apply">${icon('check')}Apply to game</button></div>`);
  }
  const select = $('#riderProfile');
  if (select) select.addEventListener('change', async (e) => { S.rider.profile = e.target.value; S.rider.selectionDirty = true; S.rider.bikes = null; S.rider.bike = null; await renderRider($('#content')); });
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

// Outfit page: optionally show your current bike next to the rider (remembered between sessions).
function riderShowBike() { try { return localStorage.getItem('coremx.showBike') === '1'; } catch { return false; } }
document.addEventListener('change', (e) => {
  if (e.target.id !== 'showBikeToggle') return;
  try { localStorage.setItem('coremx.showBike', e.target.checked ? '1' : '0'); } catch {}
  loadRiderModel();
});
async function loadRiderModel() {
  const R = S.rider;
  let withBike = false; try { withBike = localStorage.getItem('coremx.showBike') === '1'; } catch {}
  const key = JSON.stringify([R.profile, R.bike, R.lo && R.lo.current, withBike, withBike && R.lo?.identity?.riderNumber]);
  const status = $('#stageStatus'), note = $('#stageNote');
  if (R.modelKey === key && R.modelOk) { if (status) status.hidden = true; if (note) note.innerHTML = R.modelNote || ''; return; }
  R.modelKey = key;
  if (status) { status.hidden = false; status.innerHTML = '<div class="spinner"></div>'; }
  try {
    const [m, bike] = await Promise.all([
      api.invoke('rider:model', R.profile, R.bike, R.lo.current),
      withBike ? api.invoke('bike:model', R.profile, R.bike, R.lo.current.bikePaint || '', 1024, { ...R.lo.current, riderNumber: R.lo.identity?.riderNumber ?? '' }).catch(() => null) : null,
    ]);
    if (R.modelKey !== key) return; // a newer request is on its way
    if (bike && R.viewer.loadScene) R.viewer.loadScene({ rider: m, bike }); else R.viewer.load(m);
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
  const draft = { ...(R.drafts[riderDraftKey()] || {}), ...change };
  for (const [slot, selected] of Object.entries(draft)) if (selected === (R.lo.savedCurrent?.[slot] || '')) delete draft[slot];
  R.drafts[riderDraftKey()] = draft; R.saveState = 'Preview changes';
  renderRider($('#content'));
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-slot]');
  if (!t || S.view !== 'rider') return;
  const lo = S.rider.lo;
  const slot = lo.slots.find((s) => s.id === t.dataset.slot);
  const opts = lo.options[slot.id].map((v) => ({ value: v, label: slot.id === 'bikeAppearance' ? lo.appearances.find((o) => o.id === v)?.title || 'Default bike' : prettyValue(slot.id, v) }));
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
  const model = { bikePaint: lo.bike, helmetPaint: c.helmet, gogglesPaint: c.helmet, bootsPaint: c.boots, protectionPaint: c.protection, suitPaint: c.rider, glovesPaint: c.rider }[slotId] || c.rider || '';
  const context = { model, rider: c.rider, helmetPaint: ['gogglesPaint', 'helmetPaint'].includes(slotId) ? c.helmetPaint : undefined, gogglesPaint: ['gogglesPaint', 'helmetPaint'].includes(slotId) ? c.gogglesPaint : undefined };
  delete context[slotId];
  const ctx = encodeURIComponent(JSON.stringify(context));
  return `${slotId}|${ctx || ''}|${value}`;
}
// A picker should present a colour collection as one useful choice, rather
// than turning every paint in a download into a separate first-level card.
// The installer does not retain a creator-provided collection id, so use only
// strong name signals: "Model - Colour" or a familiar trailing colour word.
// If a name does not clearly belong to a collection, it remains its own card.
function pickerPaintFamily(slotId, value) {
  if (!PAINT_SLOTS.has(slotId) || !value) return '';
  const dash = String(value).match(/^(.+?)\s+[-–—]\s+[^-–—]+$/);
  if (dash && dash[1].trim().length > 2) return dash[1].trim();
  const words = String(value).trim().split(/\s+/);
  let cut = 0;
  while (words.length - cut > 1 && PAINT_VARIANT_WORDS.has(words[words.length - 1 - cut].toLowerCase())) cut++;
  return cut ? words.slice(0, -cut).join(' ') : '';
}
function groupPickerOptions(slot, options, current, noGrouping) {
  if (noGrouping || !PAINT_SLOTS.has(slot.id)) return options.map((option) => ({ option }));
  const families = new Map();
  for (const option of options) {
    const base = pickerPaintFamily(slot.id, option.value);
    if (!base) continue;
    const key = base.toLowerCase();
    if (!families.has(key)) families.set(key, { key, label: base, options: [] });
    families.get(key).options.push(option);
  }
  const grouped = new Map([...families].filter(([, family]) => family.options.length > 1));
  const result = [], emitted = new Set();
  for (const option of options) {
    const key = pickerPaintFamily(slot.id, option.value).toLowerCase();
    const family = grouped.get(key);
    if (!family) { result.push({ option }); continue; }
    if (emitted.has(key)) continue;
    emitted.add(key);
    // Show the equipped paint when it belongs to this collection, otherwise
    // use its first paint as the representative thumbnail.
    result.push({ ...family, option: family.options.find((entry) => entry.value === current) || family.options[0] });
  }
  return result;
}
function gearPicker(slot, opts, lo, config = {}) {
  const R = config.context || S.rider;
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
  let pendingSelection = opts.some((o) => o.value === current) ? current : (opts[0]?.value || '');
  const m = modal({
    title: esc(config.title || slot.label), size: 'lg',
    body: `<div class="search wide" style="margin-bottom:14px">${icon('search')}<input id="gpQ" placeholder="Search ${opts.length} options…" spellcheck="false"></div><div class="picker-filters"><label><span>Brand</span><select id="gpBrand"><option value="">All brands</option>${brands.map((b) => `<option>${esc(b)}</option>`).join('')}</select></label></div><div class="picker-count" id="gearCount"></div><div id="gpGrid" class="gear-grid"></div>`,
    foot: config.confirmSelection ? '<button class="btn" data-close>Skip</button><button class="btn btn-primary" data-confirm-gear>Use in preview</button>' : slot.id === 'rider' ? `<button class="btn" data-model-add>${icon('upload')}Add model</button><button class="btn btn-danger" data-model-delete ${/^(default|default_mx|default_sm)$/i.test(current) || !current ? 'disabled' : ''}>${icon('trash')}Delete selected model</button>` : PAINT_SLOTS.has(slot.id) ? `<span class="muted">Use the trash button beside a paint to delete it.</span>` : '',
    onClose: () => { closed = true; if (io) io.disconnect(); if (!config.picked) config.onClose?.(); },
  });
  $('[data-confirm-gear]', m)?.addEventListener('click', () => { config.picked = true; m.close(); config.onPick(pendingSelection); });
  const tileImg = (key) => {
    const u = S.gearThumbs.get(key);
    if (u && u.pic && !u.locked) return u.pic;
    if (u && u.locked) return `${u.pic ? u.pic : `<span class="gear-noimg">${icon(SLOT_ICONS[slot.id] || 'box')}</span>`}<span class="gear-lock" title="${esc(u.reason || 'Preview unavailable')}">${u.reason ? 'Check required model' : 'Preview unavailable'}</span>`;
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
      const gi = gearItem(slot.id, value, R);
      const pic = gi && gi.hasImage ? thumbHtml(gi) : null;
      if (slot.id === 'bikePaint') {
        // Livery choices use the image recorded with the installed download.
        // The interactive Bike page still renders the selected paint itself.
        url = pic ? { pic, locked: false } : null;
      } else {
      try {
        const model = await api.invoke('rider:thumbModel', R.profile, R.bike, slot.id, value, lo.current);
        if (closed || !m.isConnected) break;
        // Missing, unsupported and protected assets all lack a preview; this
        // alone does not establish that the creator encrypted the file.
        if ((model.unreadable || []).includes(slot.id)) url = { locked: true, pic, reason: (model.warnings || []).find((w) => /requires? .*model|model.*missing/i.test(w)) };
        else url = await window.RiderViewer.thumb(model, GEAR_FRAMING[slot.id] || 'full', 320);
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
  let visibleGroups = new Map();
  const draw = () => {
    io.disconnect();
    queue.length = 0;
    const q = $('#gpQ', m).value.toLowerCase().split(/\s+/).filter(Boolean);
    const brand = $('#gpBrand', m).value;
    const xs = sorted.filter((o) => (!brand || optionBrand(o) === brand) && q.every((t) => `${o.label} ${o.value} ${optionBrand(o)}`.toLowerCase().includes(t)));
    const grouped = groupPickerOptions(slot, xs, current, config.noGrouping);
    visibleGroups = new Map(grouped.filter((entry) => entry.options).map((entry) => [entry.key, entry]));
    $('#gearCount', m).textContent = `${xs.length} of ${opts.length}${grouped.length < xs.length ? ` · ${grouped.length} collections` : ''}`;
    $('#gpGrid', m).innerHTML = xs.length ? grouped.slice(0, 400).map((entry) => {
      const o = entry.option, collection = entry.options;
      const key = gearThumbKey(slot.id, o.value, lo);
      return `<div class="gear-choice"><button class="gear-tile ${o.value === current ? 'selected' : ''}" ${collection ? `data-open-group="${esc(entry.key)}"` : `data-v="${esc(o.value)}"`} data-key="${esc(key)}">
        <span class="gear-img">${tileImg(key)}</span>${o.value === current ? `<span class="badge ok gear-sel">${icon('check')}Wearing</span>` : ''}
        ${collection ? `<span class="gear-collection-count">${collection.length} variants</span>` : ''}<span class="gear-name" title="${esc(collection ? entry.label : o.label)}">${esc(collection ? entry.label : o.label)}</span></button><button class="gear-view btn btn-icon" data-view-gear="${esc(o.value)}" title="View ${esc(o.label)} in 3D" aria-label="View ${esc(o.label)} in 3D">${icon('eye')}</button>${!collection && !config.onPick && PAINT_SLOTS.has(slot.id) && o.value ? `<button class="gear-delete btn btn-icon" data-delete-paint="${esc(o.value)}" title="Delete ${esc(o.label)}" aria-label="Delete ${esc(o.label)}">${icon('trash')}</button>` : ''}</div>`;
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
  $('#gpGrid', m).addEventListener('click', async (e) => {
    const view = e.target.closest('[data-view-gear]');
    if (view) {
      const option = opts.find((o) => o.value === view.dataset.viewGear);
      openGearPreview({ slot, value: view.dataset.viewGear, label: option?.label || prettyValue(slot.id, view.dataset.viewGear), lo, context: R });
      return;
    }
    const remove = e.target.closest('[data-delete-paint]');
    if (remove) {
      const value = remove.dataset.deletePaint;
      if (!(await confirmBox('Delete paint', `Delete <b>${esc(prettyValue(slot.id, value))}</b>? Loose files go to the Recycle Bin. For packaged paints, the original package goes to the Recycle Bin and the other paints are kept. If equipped here, this paint resets to Default.`, 'Delete paint', true))) return;
      remove.disabled = true;
      try { await api.invoke('rider:deletePaint', R.profile, R.bike, slot.id, value); S.gearThumbs.clear(); m.close(); await renderRider($('#content')); toast('Paint deleted', 'ok'); }
      catch (e) { remove.disabled = false; toast(esc(cleanErr(e)), 'err', 6000); }
      return;
    }
    const group = e.target.closest('[data-open-group]');
    if (group) {
      const entry = visibleGroups.get(group.dataset.openGroup);
      if (!entry) return;
      // Keep the collection picker behind the drill-in dialog.  Closing the
      // drill-in simply returns to the grouped list; choosing a paint closes
      // both and preserves the normal save/equip behaviour.
      gearPicker(slot, entry.options, lo, {
        ...config,
        title: `${slot.label} — ${entry.label}`,
        noGrouping: true,
        onClose: () => {},
        onPick: (value) => {
          config.picked = true;
          m.close();
          (config.onPick || ((v) => saveSlot(slot.id, v)))(value);
        },
      });
      return;
    }
    const t = e.target.closest('[data-v]'); if (t) {
      if (config.confirmSelection) { pendingSelection = t.dataset.v; $$('.gear-tile', m).forEach((tile) => tile.classList.toggle('selected', tile === t)); return; }
      config.picked = true; m.close(); (config.onPick || ((v) => saveSlot(slot.id, v)))(t.dataset.v);
    }
  });
  draw();
  setTimeout(() => $('#gpQ', m).focus(), 50);
}

// Opens a larger, rotatable render without changing the draft outfit.  The
// option's parent picker stays open behind it, so View is safe to use while
// comparing colours or models.
async function openGearPreview({ slot, value, label, lo, context }) {
  const R = context || S.rider;
  const m = modal({
    title: `View — ${esc(label)}`, size: 'gear-preview-modal',
    body: `<div class="gear-preview-stage" data-gear-preview><div class="loadmore"><div class="spinner"></div><span>Loading 3D preview…</span></div></div><p class="muted gear-preview-help">Drag to turn · scroll to zoom · double-click to reset. This is only a preview.</p>`,
  });
  let viewer = null;
  try {
    const model = slot.id === 'bikePaint'
      ? await api.invoke('bike:model', R.profile, R.bike, value, 1024, { ...lo.current, riderNumber: lo.identity?.riderNumber ?? '' })
      : await api.invoke('rider:previewSlot', R.profile, R.bike, slot.id, value, lo.current);
    const host = $('[data-gear-preview]', m);
    if (!host || !m.isConnected) return;
    host.replaceChildren();
    if (!window.RiderViewer) throw new Error('3D viewer is still loading');
    viewer = window.RiderViewer.create(host);
    viewer.load(model);
  } catch (e) {
    const host = $('[data-gear-preview]', m);
    if (host && m.isConnected) host.innerHTML = `<div class="stage-err">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`;
  }
  const oldClose = m.close;
  m.close = () => { viewer?.dispose(); oldClose(); };
}

// ---------- accounts (Steam + shops) ----------
S.accounts = { steam: null, shops: [] };
async function refreshAccounts() {
  const [st, sh] = await Promise.all([api.invoke('steam:detect').catch(() => ({ found: false })), api.invoke('shops:list').catch(() => [])]);
  S.accounts = { steam: st, shops: sh };
  renderRail(); return S.accounts;
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
  if (p.price == null) return p.shop === 'mxbs' ? '<span class="price muted" title="Loading the store price">Loading…</span>' : '';
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
let pricing = false, pricingTimer = null;
async function fillPrices() {
  if (pricing) return;
  pricing = true;
  const now = Date.now();
  // MX Bikes Shop's feed has no prices. Fetch only a small batch at a time,
  // and retry a temporarily failed product later instead of permanently
  // marking it as "priced" with an empty badge.
  const queue = () => S.shop.products.filter((p) => p.shop === 'mxbs' && p.price == null && (!p._priceCheckedAt || now - p._priceCheckedAt >= 30000));
  const batch = queue().slice(0, 8);
  let next = 0;
  const worker = async () => {
    for (let p = batch[next++]; p; p = batch[next++]) {
      p._priceCheckedAt = Date.now();
      try {
        const d = await api.invoke('shops:details', 'mxbs', p.link);
        p.price = Number.isFinite(d.price) ? d.price : null; p.creator = d.creator; p.images = d.images;
        const b = $(`[data-price-of="${p.id}"]`);
        if (b && !productInstalled(p) && !ownedGroupFor(p)) b.innerHTML = priceHtml(p);
        const cr = $(`[data-creator-of="${p.id}"]`); if (cr && p.creator) cr.textContent = p.creator;
      } catch {
        // Leave the loading label in place and try again after the cooldown.
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  await Promise.all([worker(), worker()]);
  pricing = false;
  if (S.shop.products.some((p) => p.shop === 'mxbs' && p.price == null)) {
    clearTimeout(pricingTimer);
    pricingTimer = setTimeout(() => { if (isShop() && S.shop.id === 'mxbs' && S.shop.mode === 'store') fillPrices(); }, 31000);
  }
}

function descToHtml(html) {
  // Render shop descriptions as plain text paragraphs (no site HTML is injected).
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const blocks = [...doc.body.querySelectorAll('p, li, h2, h3, h4')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!blocks.length) { const t = doc.body.textContent.trim(); return t ? `<p>${esc(t)}</p>` : ''; }
  return blocks.map((t) => `<p>${esc(t)}</p>`).join('');
}

async function openProduct(p, files) {
  // Dependency search can open a product from either paid source while the
  // current Get Mods tab is MXB Mods (or the other shop).
  const sh = S.accounts.shops.find((shop) => shop.id === p.shop) || currentShop();
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
      return `<div class="dl" data-download-url="${esc(f.url)}"><div class="info"><div class="label">${esc(f.file || f.title)}</div><div class="host">${esc(sh.name)}</div></div>
        ${done ? `<span class="have">${icon('check')}Installed</span>` : `<button class="btn btn-primary" data-own-file="${i}">${icon('download')}Install</button>`}<div class="download-inline" data-download-progress hidden></div></div>`;
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
      ${p.creatorFiles ? `<div class="notice info">${icon('info')}<div><b>Other / Tools: files for livery makers</b><div>A Blender model and PSD template for painting this part into your own livery. It does not install into MX Bikes by itself.</div></div></div>` : ''}
      ${box}
    </div></div>`;
  refreshInlineDownloads(m);
  };
  renderDetails();
  $('.modal-body', m).addEventListener('click', async (e) => {
    const review = e.target.closest('[data-inline-review]');
    if (review) { openReview(review.dataset.inlineReview); return; }
    const g = e.target.closest('[data-pg]');
    if (g) { $('#pgMain', m).src = imgs[Number(g.dataset.pg)]; $$('[data-pg]', m).forEach((x) => x.classList.toggle('active', x === g)); }
    const b = e.target.closest('[data-buy]');
    if (b) api.invoke('shops:open', p.shop, b.dataset.buy);
    const of = e.target.closest('[data-own-file]');
    if (of) {
      const label = of.innerHTML;
      of.disabled = true; of.textContent = 'Starting…';
      try { await installOwned(group.files[Number(of.dataset.ownFile)], p); refreshInlineDownloads(m); }
      catch (err) { of.disabled = false; of.innerHTML = label; toast(esc(cleanErr(err)), 'err', 6000); }
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
  const id = await api.invoke('jobs:start', { title: prod ? prod.title : it.title, url: it.url, shopKey: prod && prod.link ? prod.link : it.url, link: prod?.link || it.product || null, image: prod ? prod.image : null });
  if (id && !S.jobs.has(id)) S.jobs.set(id, { id, title: prod ? prod.title : it.title, url: it.url, status: 'queued', createdAt: Date.now() });
  refreshInlineDownloads();
  toast(`Downloading <b>${esc(prod ? prod.title : it.title)}</b>…`, 'info', 2200);
}

document.addEventListener('click', async (e) => {
  const bo = e.target.closest('[data-buy-open]');
  if (bo) { api.invoke('shops:open', S.shop.id, bo.dataset.buyOpen); return; }
  const g = e.target.closest('[data-owned-group]');
  if (g) { const grp = S.shop.owned[S.shop.id].groups[Number(g.dataset.ownedGroup)]; openProduct(grp.prod, grp.files); }
});

// ---------- first-run setup ----------
// Setup: the welcome, your game folders, a short look at each part of CoreMX (onboarding.js), online
// features, shop accounts and a couple of choices.
const SETUP_STEPS = ['welcome', 'game', 'get', 'library', 'rider', 'play', 'friends', 'online', 'accounts', 'prefs', 'done'];
let setupStep = 0;

async function openSetup(start = 0) {
  setupStep = start;
  try { if (S.live) S.live.status = await api.invoke('online:status'); } catch {}
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
      <h1>Welcome to CoreMX</h1><p>Everything for your MX Bikes mods in one place. Let's get you set up — it takes a minute.</p></div>
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
  } else if (typeof OB_PAGES !== 'undefined' && OB_PAGES[step]) {
    body = obPageHtml(step);
  } else if (step === 'online') {
    body = obOnlineHtml();
  } else if (step === 'accounts') {
    body = `<h2 class="setup-h">Link your accounts</h2><p class="setup-p">Optional — link the shops you buy mods from so your purchases show up ready to install. You can do this later in Settings.</p>
      <div data-accounts>${accountCardsHtml()}</div>`;
  } else if (step === 'prefs') {
    body = `<h2 class="setup-h">A couple of choices</h2><p class="setup-p">You can change these any time in Settings.</p>
      <div class="set-card" style="margin-bottom:10px"><label class="toggle"><input type="checkbox" data-pref="autoInstall" ${s.autoInstall ? 'checked' : ''}><span class="sw"></span><span><b>Install mods automatically</b><br><span class="muted">When the app is sure where a mod goes, it installs it straight away. Otherwise it asks.</span></span></label></div>
      <div class="set-card"><label class="toggle"><input type="checkbox" data-pref="autoImages" ${s.autoImages !== false ? 'checked' : ''}><span class="sw"></span><span><b>Find pictures for my mods</b><br><span class="muted">Fetch pictures for bikes and tracks from mxb-mods.com.</span></span></label></div>`;
  } else {
    body = `<div class="setup-hero">${icon('check').replace('class="ico ', 'style="width:64px;height:64px;color:var(--ok)" class="ico ')}<h1>You're all set</h1><p>Your library is ready. Have fun out there.</p><p class="muted" style="margin-top:14px">Want a 30-second tour of where everything is? You can also click ${icon('info')} at the top any time for help on the page you're on.</p><button class="btn" data-setup="tour" style="margin-top:14px">${icon('sparkle')}Show me around</button></div>`;
    next = 'Open my library';
  }
  el.innerHTML = `<div class="setup-card${typeof OB_PAGES !== 'undefined' && (OB_PAGES[step] || step === 'online') ? ' wide' : ''}"><div class="setup-top">${dots}${setupStep < SETUP_STEPS.length - 1 ? '<button class="btn btn-ghost btn-sm" data-setup="skip">Skip setup</button>' : ''}</div>
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
  // finish or skip (a tour or tip starts on the library afterwards)
  S.env = await api.invoke('settings:set', { setupDone: true, tipsSeen: { ...(S.env.settings.tipsSeen || {}), library: a === 'tour' || (S.env.settings.tipsSeen || {}).library } });
  $('#setup').remove();
  go('library');
  if (a === 'tour' && typeof startTour === 'function') setTimeout(startTour, 400);
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
      const dl = p.downloads.find((d) => /default|recommended/i.test(d.flag) && !isServerDownload(d)) || p.downloads.find((d) => !isServerDownload(d)) || p.downloads[0];
      if (!dl) throw new Error('No download link on the mod page');
      if (!await startDownload(p, dl)) { u.disabled = false; return; }
      S.updates = (S.updates || []).filter((x) => x.id !== p.id);
    } catch (err) { toast(esc(err.message), 'err'); u.disabled = false; }
    return;
  }
  const un = e.target.closest('[data-uninstall]');
  if (un) {
    un.disabled = true;
    try {
      const all = await api.invoke('installs:list'); S.installs = all;
      const rec = all[un.dataset.uninstall];
      if (!rec) throw new Error('This install is no longer listed');
      const graphics = rec.files.some((f) => f.startsWith('game:'));
      if (!(await confirmBox('Uninstall', `Remove <b>${esc(rec.title)}</b> (${rec.files.length} files)? ${graphics ? 'The package goes to the Recycle Bin and backed-up game files are restored.' : 'Installed files go to the Recycle Bin.'}`, 'Uninstall', true))) { un.disabled = false; return; }
      await api.invoke('installs:uninstall', un.dataset.uninstall); await refreshInstalledIds();
      toast('Uninstalled', 'ok');
      if (S.view === 'graphics' || S.view === 'library' && S.lib.tab === 'graphics') refreshGraphicsViews();
      else renderInstalled($('#content'));
      rescan(true);
    } catch (err) { un.disabled = false; toast(esc(cleanErr(err)), 'err', 6000); }
  }
});

// ---------- settings ----------
S.appUpdate = { phase: 'idle' };
function appUpdateHtml() {
  const update = S.appUpdate;
  const text = { idle: 'Checks GitHub releases quietly every 5 minutes while the app is open.', checking: 'Checking GitHub…', current: 'You have the latest version.', downloading: `Downloading ${esc(update.version || '')} · ${Math.round(update.percent || 0)}%`, available: 'An update is available. Choose Install update in the dialog.', ready: 'The update is downloaded and ready to install.', error: esc(update.error || 'Could not check for updates.'), development: 'Startup update checks run in the installed app.' }[update.phase];
  return `<p>${text || ''}</p>${update.phase === 'downloading' ? `<progress max="100" value="${Number(update.percent) || 0}" style="width:100%"></progress>` : ''}<button class="btn" data-act="app-update-check" ${['checking', 'downloading'].includes(update.phase) ? 'disabled' : ''}>${icon('refresh')}Check now</button>${update.phase === 'ready' ? '<button class="btn btn-primary" data-act="app-update-install">Restart to update</button>' : ''}`;
}
let updateDialog = null, skippedUpdate = '', updateAccepted = false, updateRestarting = false;
function drawAppUpdate() {
  const box = $('#appUpdates'); if (box) box.innerHTML = appUpdateHtml();
  $('#appUpdateOverlay')?.remove();
  const u = S.appUpdate;
  if (!['available', 'downloading', 'ready', 'installing', 'error'].includes(u.phase)) return;
  if (!updateDialog && (u.phase === 'error' || skippedUpdate === u.version)) return;
  if (!updateDialog) updateDialog = modal({ title: 'CoreMX update', body: '', foot: '<span></span>', onClose: () => { skippedUpdate = S.appUpdate.version; updateAccepted = false; updateDialog = null; } });
  const raw = Array.isArray(u.notes) ? u.notes.map((n) => n.note || '').join('\n') : u.notes || '';
  // Release notes come from a remote manifest: display text, never execute HTML.
  const notes = new DOMParser().parseFromString(raw, 'text/html').body.textContent;
  const labels = { available: 'An update is available', downloading: 'Downloading update', ready: 'Ready to install', installing: 'Installing update — the app will close and reopen', error: 'Update failed' };
  $('.modal-body', updateDialog).innerHTML = '<h3>' + esc(u.version || '') + ' · ' + labels[u.phase] + '</h3><div style="white-space:pre-wrap;line-height:1.7;margin:16px 0">' + esc(notes || 'Improvements and fixes for CoreMX.') + '</div>' + (u.phase === 'downloading' ? '<progress style="width:100%" max="100" value="' + (Number(u.percent) || 0) + '"></progress><p>' + Math.round(u.percent || 0) + '% downloaded</p>' : '') + (u.error ? '<p class="sync-warning">' + esc(u.error) + '</p>' : '') + (u.phase === 'ready' && riderDirty() ? '<p>Apply or Revert your Rider preview before installing this update.</p>' : '');
  $('.modal-foot', updateDialog).innerHTML = (u.phase === 'installing' ? '' : '<button class="btn" data-close>' + (u.phase === 'available' ? 'Skip' : 'Later') + '</button>') + (u.phase === 'available' ? '<button class="btn btn-primary" data-act="app-update-download">Install update</button>' : u.phase === 'ready' ? '<button class="btn btn-primary" data-act="app-update-install">Install & reopen</button>' : u.phase === 'error' ? '<button class="btn btn-primary" data-act="app-update-check">Retry</button>' : '');
  if (u.phase === 'ready' && updateAccepted && !riderDirty()) restartForUpdate();
}
async function restartForUpdate() {
  if (updateRestarting) return;
  if (riderDirty()) { toast('Apply or Revert your Rider preview before restarting to update.', 'info', 6000); return; }
  updateRestarting = true;
  try { await api.invoke('app:installUpdate'); }
  catch (err) { updateAccepted = false; updateRestarting = false; toast(esc(cleanErr(err)), 'err', 6000); }
}
api.on('app:update', (state) => { S.appUpdate = state; drawAppUpdate(); });
api.on('synced:pruned', ({ removed, days }) => toast(`Removed ${removed} synced file${removed === 1 ? '' : 's'} no one has needed for ${days >= 30 ? Math.round(days / 30) + ' month' + (days >= 60 ? 's' : '') : Math.round(days / 7) + ' week' + (days >= 14 ? 's' : '')} (in the Recycle Bin)`, 'info', 6000));
// FrostMod (MXB App's game plugin) found: CoreMX never touches it, only says it can interfere (once, ever).
api.on('frostmod:found', () => {
  if ($('#frostmodNote')) return;
  const m = modal({ title: 'FrostMod is installed', size: 'sm', body: `<div id="frostmodNote"><p>Your MX Bikes plugins folder has <b>FrostMod</b>, a game plugin from the maker of MXB App.</p><p>CoreMX and FrostMod both add in-game features. If something doesn't work as expected, you can turn either one off in <b>My Mods → Plugins</b>.</p><p class="muted">CoreMX won't change or remove FrostMod.</p></div>`,
    foot: `<button class="btn" data-frostmod="plugins">${icon('box')}Open Plugins</button><span class="grow"></span><button class="btn btn-primary" data-close>OK</button>` });
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-frostmod]'); if (!b) return;
    if (b.dataset.frostmod === 'off') { try { S.env = await api.invoke('settings:set', { frostmodWarningOff: true }); } catch {} }
    else { S.lib.scope = 'mods'; S.lib.tab = 'plugins'; go('library'); }
    m.close();
  });
});
document.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-act]')?.dataset.act;
  if (action === 'app-update-check') { skippedUpdate = ''; S.appUpdate = { ...S.appUpdate, phase: 'checking' }; drawAppUpdate(); try { S.appUpdate = await api.invoke('app:checkUpdates'); drawAppUpdate(); } catch (err) { toast(esc(cleanErr(err)), 'err'); } }
  if (action === 'app-update-download') {
    if (riderDirty()) { toast('Apply or Revert your Rider preview first so it is not lost when the app restarts.', 'info', 6000); return; }
    updateAccepted = true;
    try { S.appUpdate = await api.invoke('app:downloadUpdate'); drawAppUpdate(); } catch (err) { updateAccepted = false; toast(esc(cleanErr(err)), 'err'); }
  }
  if (action === 'app-update-install') { updateAccepted = true; await restartForUpdate(); }
});
S.settingsTab = 'general';
S.admin = { unlocked: false, stats: null };
const ADMIN_STEAM_ID = '76561198098586128';
// Admin: the owner and the admins the owner adds by friend code (the service says who; refreshed
// when Settings opens). The owner's own Steam account always counts.
function isAdminAccount() { return !!(S.adminRole?.admin || S.accounts.steam?.steamId === ADMIN_STEAM_ID); }
async function refreshAdminRole(force) { try { S.adminRole = await api.invoke('online:adminRole', force); } catch {} }
function settingsTabs() {
  return `<div class="seg-tabs"><button class="${S.settingsTab === 'general' ? 'active' : ''}" data-settings-tab="general">${icon('settings')}General</button><button class="${S.settingsTab === 'health' ? 'active' : ''}" data-settings-tab="health">${icon('sparkle')}Fix & clean</button><button class="${S.settingsTab === 'plugins' ? 'active' : ''}" data-settings-tab="plugins">${icon('globe')}Plugins</button><button class="${S.settingsTab === 'credits' ? 'active' : ''}" data-settings-tab="credits">${icon('rider')}Creator & Tester</button>${isAdminAccount() ? `<button class="${S.settingsTab === 'admin' ? 'active' : ''}" data-settings-tab="admin">${icon('shield')}Admin</button>` : ''}</div>`;
}
document.addEventListener('click', (e) => { const tab = e.target.closest('[data-settings-tab]'); if (tab) { S.settingsTab = tab.dataset.settingsTab; renderSettings($('#content')); } });
function renderCreditsSettings(c) {
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Settings</h2>${settingsTabs()}</div><div class="scroller"><div class="settings">
    <div class="set-card"><h3>Creator & Tester</h3><p>The people behind CoreMX.</p>
      <div class="srv-list">
        <div class="srv"><div class="srv-ico">${icon('rider')}</div><div class="srv-txt"><div class="t">Rare621</div><div class="m">Creator</div></div><button class="btn btn-sm" data-open="https://steamcommunity.com/id/Rare621/" aria-label="Open Rare621's Steam profile">${icon('external')}Steam profile</button></div>
        <div class="srv"><div class="srv-ico">${icon('check')}</div><div class="srv-txt"><div class="t">Raze392</div><div class="m">Tester</div></div><button class="btn btn-sm" data-open="https://steamcommunity.com/id/Raze392/" aria-label="Open Raze392's Steam profile">${icon('external')}Steam profile</button></div>
      </div>
    </div>
  </div></div></div></div>`;
}
async function renderSettings(c) {
  if (!S.adminRole) await refreshAdminRole();
  else refreshAdminRole().then(() => { if (S.view === 'settings' && $('[data-settings-tab]') && !$('[data-settings-tab="admin"]') && isAdminAccount()) renderSettings($('#content')); });
  if (S.settingsTab === 'admin') return renderAdminSettings(c);
  if (S.settingsTab === 'health') return renderHealth(c);
  if (S.settingsTab === 'plugins') return renderPluginSettings(c);
  if (S.settingsTab === 'credits') return renderCreditsSettings(c);
  if (!S.accounts.shops.length) await refreshAccounts();
  const env = S.env, s = env.settings;
  const pathRow = (val, ok, which) => `<div class="path-row"><div class="path">${ok ? `<span class="ok">${icon('check')}</span>` : `<span class="bad">${icon('alert')}</span>`}${esc(val || 'Not found')}</div>
    <button class="btn" data-act="pick-${which}">Change…</button>${val ? `<button class="btn btn-icon" data-folder="${which}" title="Open">${icon('folder')}</button>` : ''}</div>`;
  const t = env.tools;
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Settings</h2>${settingsTabs()}</div><div class="scroller"><div class="settings">
    <div class="set-card"><h3>MX Bikes user folder</h3><p>Where your mods, profiles and replays live. Detected automatically from your Documents folder.</p>
      ${pathRow(s.gameUserDir, env.modsFound, 'user')}
      <div class="muted mono" style="margin-top:8px">mods: ${esc(env.modsDir)}</div>${env.profilesDir && !env.profilesDir.toLowerCase().startsWith((env.settings.gameUserDir || "").toLowerCase()) ? `<div class="muted mono" style="margin-top:4px">profiles: ${esc(env.profilesDir)} <span style="font-family:var(--ui)">(MX Bikes keeps these in Documents)</span></div>` : ""}</div>
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
        <div>${t.sevenZip ? `<span style="color:var(--ok)">${icon('check')}</span>7-Zip ${/[\\/](?:resources|vendor)[\\/]7zip[\\/]7z\.exe$/i.test(t.sevenZip) ? '<span class="muted">(built into CoreMX)</span>' : `<span class="muted mono">${esc(t.sevenZip)}</span>`}` : `<span style="color:var(--warn)">${icon('alert')}</span>7-Zip not found — <a href="#" data-open="https://www.7-zip.org/">get 7-Zip</a> for best .rar/.7z support`}</div>
        <div>${t.unrar ? `<span style="color:var(--ok)">${icon('check')}</span>WinRAR UnRAR <span class="muted mono">${esc(t.unrar)}</span>` : `<span class="muted">${icon('info')}</span><span class="muted">WinRAR not installed (optional)</span>`}</div>
        <div>${t.tar ? `<span style="color:var(--ok)">${icon('check')}</span>Windows built-in tar <span class="muted mono">${esc(t.tar)}</span>` : ''}</div>
      </div></div>
    <div class="set-card"><h3>Disabled mods</h3><p>Disabling a mod moves it here so the game stops loading it. Enabling moves it back. Nothing is deleted.</p>
      <div class="path-row"><div class="path">${esc(env.disabledDir)}</div><button class="btn btn-icon" data-folder="disabled" title="Open">${icon('folder')}</button></div></div>
    <div class="set-card"><h3>Setup</h3><p>Go through the welcome setup again.</p><button class="btn" data-act="run-setup">${icon('sparkle')}Run setup again</button></div>
    <div class="set-card"><h3>App updates</h3><div id="appUpdates">${appUpdateHtml()}</div></div>
    <div class="set-card"><h3>About</h3><p>CoreMX ${esc(env.version)} — Content manager for MX Bikes.</p><p><a class="btn" href="#" data-open="https://coremx.app/#/">${icon('external')}Open website · coremx.app</a></p><p>Free mods come from CoreMX community uploads and <a href="#" data-open="https://mxb-mods.com">mxb-mods.com</a>. Please support mod creators.</p></div>
  </div></div></div></div>`;
  $('#autoInstall').addEventListener('change', async (e) => { S.env = await api.invoke('settings:set', { autoInstall: e.target.checked }); });
  $('#autoImages').addEventListener('change', async (e) => { S.env = await api.invoke('settings:set', { autoImages: e.target.checked }); if (e.target.checked) backgroundImages(); });
}
// ---------- Admin: who uses CoreMX ----------
// One row per account (Steam ID), daily active riders, and totals, from the online service.
S.admin = S.admin || {};
const ADMIN_FILTERS = [['recent', 'Last 5 days'], ['online', 'Online now'], ['all', 'All accounts']];
function adminDate(t) { return t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '—'; }
function adminDay(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function adminUserRows(a) {
  const q = (S.admin.q || '').trim().toLowerCase(), filter = S.admin.filter || 'recent', FIVE = 5 * 86400000;
  return (a?.users || []).filter((u) => filter === 'all' || (filter === 'online' ? u.online : u.online || (u.lastSeen && Date.now() - u.lastSeen < FIVE)))
    .filter((u) => !q || `${u.name} ${u.id} ${u.server}`.toLowerCase().includes(q));
}
function adminUsersHtml(a) {
  const rows = adminUserRows(a), days = a?.daily?.length || 30;
  if (!rows.length) return `<div class="admin-empty muted">${S.admin.q ? 'No accounts match your search.' : (S.admin.filter || 'recent') === 'online' ? 'Nobody is online right now.' : 'No one has used CoreMX in this period.'}</div>`;
  return rows.map((u) => {
    const status = u.online ? (u.inGame ? (u.server ? `Riding on ${esc(u.server)}${u.track ? ` · ${esc(u.track)}` : ''}` : 'In MX Bikes') : 'Online in CoreMX') : u.lastSeen ? `Last seen ${esc(timeAgo(u.lastSeen))}` : 'Not seen yet';
    const share = Math.round(Math.min(1, u.activeDays / days) * 100);
    return `<div class="admin-user" data-open="https://steamcommunity.com/profiles/${esc(u.id)}" title="Open Steam profile">
      <span class="admin-user-av">${esc((u.name || '?').slice(0, 1).toUpperCase())}<span class="fr-dot ${u.online ? u.inGame ? 'ride' : 'on' : 'off'}"></span></span>
      <span class="admin-user-main"><b>${esc(u.name || 'Unnamed')}</b><small class="${u.online ? 'admin-online' : 'muted'}">${status}</small></span>
      <span class="admin-user-days" title="${u.activeDays} of the last ${days} days"><span class="admin-meter"><i style="width:${share}%"></i></span><small class="muted">${u.activeDays} / ${days} days</small></span>
      <span class="admin-user-joined muted"><small>Joined</small>${esc(adminDate(u.createdAt))}</span></div>`;
  }).join('');
}
function adminChartHtml(a) {
  // Days before the service kept daily history are left out (shown as a note instead of empty bars).
  const since = a?.trackedSince, all = a?.daily || [], daily = since ? all.filter((d) => d.date >= since) : all, max = Math.max(1, ...daily.map((d) => d.count));
  const step = Math.ceil(daily.length / 6), last = daily.length - 1;
  const label = (i) => i === 0 || i === last || (daily.length > 10 && i % step === 0 && last - i >= step / 2);
  return `<div class="admin-chart" role="img" aria-label="Riders using CoreMX each day">${daily.map((d, i) => {
    const day = adminDay(d.date), untracked = false;
    return `<div class="admin-bar${untracked ? ' untracked' : ''}${i === daily.length - 1 ? ' today' : ''}" title="${esc(day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${untracked ? 'not tracked yet' : `${d.count} rider${d.count === 1 ? '' : 's'}`}">
      <span class="admin-bar-n">${d.count || ''}</span><i style="height:${untracked ? 0 : Math.max(d.count ? 6 : 2, Math.round(d.count / max * 100))}%"></i><small>${label(i) ? esc(day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : ''}</small></div>`;
  }).join('')}</div>${since && all[0] && all[0].date < since ? `<p class="muted admin-note">Daily history started ${esc(adminDate(adminDay(since).getTime()))}, when the online service was updated.</p>` : ''}`;
}
function adminActivityHtml(a) {
  return `<div class="set-card admin-activity">${adminActivityInner(a)}</div>`;
}
// The card's contents: redrawn in place (redrawing the card itself would replay its fade-in).
function adminActivityInner(a) {
  const s = a?.summary || {}, range = S.admin.range || 30;
  const tile = (n, label, hint, cls = '') => `<div class="admin-tile ${cls}"><b>${Number(n) || 0}</b><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div>`;
  return `<div class="admin-head"><div><h3>Riders using CoreMX</h3><p class="muted">${a ? `Updated ${esc(timeAgo(a.at))}` : 'Loading…'}</p></div><span class="grow"></span>
      <div class="seg-tabs">${[7, 30, 90].map((d) => `<button class="${range === d ? 'active' : ''}" data-admin-range="${d}">${d} days</button>`).join('')}</div>
      <button class="btn btn-icon" data-admin-refresh title="Refresh">${icon('refresh')}</button></div>
    <div class="admin-tiles">${tile(s.onlineNow, 'Online now', `${Number(s.inGame) || 0} in MX Bikes`, 'live')}${tile(s.today, 'Today')}${tile(s.last5Days, 'Last 5 days')}${tile(s.last30Days, 'Last 30 days')}${tile(s.accounts, 'Accounts', `${Number(s.newThisWeek) || 0} new this week`)}</div>
    <div class="admin-sub">Riders each day</div>${adminChartHtml(a)}
    <div class="admin-list-head"><div class="seg-tabs">${ADMIN_FILTERS.map(([id, label]) => `<button class="${(S.admin.filter || 'recent') === id ? 'active' : ''}" data-admin-filter="${id}">${label}</button>`).join('')}</div><span class="grow"></span>
      <div class="search">${icon('search')}<input id="adminSearch" placeholder="Search riders…" value="${esc(S.admin.q || '')}" aria-label="Search riders"></div></div>
    <div class="admin-users" id="adminUsers">${adminUsersHtml(a)}</div>`;
}
async function loadAdminActivity(c) {
  try { S.admin.activity = await api.invoke('online:adminActivity', S.admin.range || 30); }
  catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
  const box = $('.admin-activity', c);
  if (box) { box.innerHTML = adminActivityInner(S.admin.activity); wireAdminActivity(c); }
}
function wireAdminActivity(c) {
  const box = $('.admin-activity', c); if (!box) return;
  $('#adminSearch', box)?.addEventListener('input', (e) => { S.admin.q = e.target.value; $('#adminUsers', box).innerHTML = adminUsersHtml(S.admin.activity); });
  if (box._wired) return;
  box._wired = true;
  box.addEventListener('click', (e) => {
    const range = e.target.closest('[data-admin-range]'), filter = e.target.closest('[data-admin-filter]');
    if (range) { S.admin.range = Number(range.dataset.adminRange); loadAdminActivity(c); }
    else if (filter) {
      S.admin.filter = filter.dataset.adminFilter;
      box.querySelectorAll('[data-admin-filter]').forEach((b) => b.classList.toggle('active', b === filter));
      $('#adminUsers', box).innerHTML = adminUsersHtml(S.admin.activity);
    }
    else if (e.target.closest('[data-admin-refresh]')) loadAdminActivity(c);
  });
}

// ---------- Admin: who may use it (owner only) ----------
// Admins are added by friend code; they unlock Admin with the same server admin key and see
// activity and announcements. Only the owner manages this list.
function adminsHtml(list) {
  const me = S.accounts.steam || {};
  const row = (a, owner) => `<div class="admin-user admin-row"${owner ? '' : ` data-open="https://steamcommunity.com/profiles/${esc(a.id)}"`}>
      <span class="admin-user-av">${esc((a.name || '?').slice(0, 1).toUpperCase())}</span>
      <span class="admin-user-main"><b>${esc(a.name || 'Not signed in to CoreMX yet')}</b><small class="muted mono">${esc(a.id)}</small></span>
      <span class="admin-user-days muted"><small>${owner ? 'Owner' : a.addedAt ? 'Added ' + esc(adminDate(a.addedAt)) : 'Admin'}</small></span>
      <span class="admin-user-joined">${owner ? '' : `<button class="btn btn-sm btn-danger" data-admin-remove="${esc(a.id)}">${icon('trash')}Remove</button>`}</span></div>`;
  return `<div class="set-card"><h3>Admins</h3><p>People you add see <b>Settings → Admin</b> in their CoreMX (it can take a minute) and unlock it with the same server admin key. They can see activity and publish announcements; only you can add or remove admins.</p>
    <div class="path-row" style="gap:8px;margin:14px 0"><input class="input mono" id="adminAddCode" placeholder="Friend code (7656119…)" spellcheck="false" style="flex:1"><button class="btn btn-primary" id="adminAddBtn">${icon('user')}Add admin</button></div>
    <div class="admin-users">${row({ id: me.steamId || '', name: me.name || 'You' }, true)}${(list || []).map((a) => row(a, false)).join('') || ''}</div></div>`;
}
async function loadAdmins(c) {
  const box = $('#adminAdmins', c); if (!box) return;
  try { S.admin.admins = (await api.invoke('online:adminList')).admins || []; }
  catch (error) { box.innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(cleanErr(error))}</div></div>`; return; }
  box.innerHTML = adminsHtml(S.admin.admins);
  const add = async () => {
    const code = $('#adminAddCode', box).value.trim();
    if (!/^7656119\d{10}$/.test(code)) { toast('A friend code is a 17-digit number starting with 7656119', 'err', 3500); return; }
    try { S.admin.admins = (await api.invoke('online:adminAdd', code)).admins || []; toast('Admin added. They see the Admin tab next time CoreMX checks (within a minute).', 'ok', 4000); box.innerHTML = adminsHtml(S.admin.admins); wire(); }
    catch (error) { toast(esc(cleanErr(error)), 'err', 5000); }
  };
  const wire = () => {
    $('#adminAddBtn', box)?.addEventListener('click', add);
    $('#adminAddCode', box)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    box.querySelectorAll('[data-admin-remove]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.dataset.adminRemove, who = (S.admin.admins || []).find((a) => a.id === id);
      if (!await confirmBox('Remove admin?', `<b>${esc(who?.name || id)}</b> will no longer see the Admin tab.`, 'Remove', true)) return;
      try { S.admin.admins = (await api.invoke('online:adminRemove', id)).admins || []; box.innerHTML = adminsHtml(S.admin.admins); wire(); toast('Admin removed', 'ok', 2500); }
      catch (error) { toast(esc(cleanErr(error)), 'err', 5000); }
    }));
  };
  wire();
}

async function renderAdminSettings(c) {
  if (!S.accounts.steam) await refreshAccounts();
  await refreshAdminRole(true);
  if (!isAdminAccount()) { S.settingsTab = 'general'; return renderSettings(c); }
  const owner = !!(S.adminRole?.owner || S.accounts.steam?.steamId === ADMIN_STEAM_ID);
  if (!owner) S.admin.tab = 'overview';
  if (S.admin.unlocked) {
    try { S.admin.stats = await api.invoke('online:adminStatus'); }
    catch (error) { S.admin.unlocked = false; S.admin.stats = null; toast(esc(cleanErr(error)), 'err', 6000); }
  }
  const adminTabs = S.admin.unlocked && owner ? `<div class="seg-tabs admin-tabs"><button class="${S.admin.tab !== 'admins' ? 'active' : ''}" data-admin-tab="overview">${icon('signal')}Activity & announcements</button><button class="${S.admin.tab === 'admins' ? 'active' : ''}" data-admin-tab="admins">${icon('users')}Admins</button></div>` : '';
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Settings</h2>${settingsTabs()}</div><div class="scroller"><div class="settings admin-settings">
    ${adminTabs}${S.admin.unlocked && S.admin.tab === 'admins' ? '<div id="adminAdmins"><div class="loadmore"><div class="spinner"></div></div></div>' : S.admin.unlocked ? `${adminActivityHtml(S.admin.activity)}
    <div class="set-card"><h3>New announcement</h3><p>People see this once when the app next checks online. It also stays in their Notifications until they delete it.</p>
      <div class="field"><label for="adminTitle">Title</label><input class="input" id="adminTitle" maxlength="100" placeholder="Server maintenance"></div>
      <div class="field"><label for="adminMessage">Description</label><textarea class="input" id="adminMessage" maxlength="2000" rows="5" placeholder="Tell everyone what is happening and when."></textarea></div>
      <button class="btn btn-primary" id="adminPublish">${icon('bell')}Publish announcement</button></div>` : `<div class="set-card"><h3>Unlock Admin</h3><p>For admin accounts. Enter the admin key configured on the CoreMX online server to publish announcements.</p>
      <div class="field"><label for="adminKey">Server admin key</label><input class="input" id="adminKey" type="password" autocomplete="off"></div>
      <button class="btn btn-primary" id="adminUnlock">Unlock</button></div>`}
  </div></div></div></div>`;
  c.querySelectorAll('[data-admin-tab]').forEach((b) => b.addEventListener('click', () => { S.admin.tab = b.dataset.adminTab; renderAdminSettings(c); }));
  if (S.admin.unlocked && S.admin.tab === 'admins') loadAdmins(c);
  else if (S.admin.unlocked) { wireAdminActivity(c); loadAdminActivity(c); }
  $('#adminUnlock')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { S.admin.stats = await api.invoke('online:adminUnlock', $('#adminKey').value); S.admin.unlocked = true; renderAdminSettings(c); }
    catch (error) { btn.disabled = false; toast(esc(cleanErr(error)), 'err', 6000); }
  });
  $('#adminPublish')?.addEventListener('click', async (e) => {
    const title = $('#adminTitle').value.trim(), message = $('#adminMessage').value.trim();
    if (title.length < 3 || message.length < 5) { toast('Enter a title and description first.', 'err'); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await api.invoke('online:createAnnouncement', title, message); $('#adminTitle').value = ''; $('#adminMessage').value = ''; toast('Announcement published', 'ok'); }
    catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
    finally { if (btn.isConnected) btn.disabled = false; }
  });
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
    case 'rider-apply': {
      a.disabled = true;
      try {
        const result = await api.invoke('rider:apply', S.rider.profile, S.rider.bike, riderChanges());
        if (result && result.queued) {
          // The game is open: the preview stays on screen and is saved when MX Bikes closes.
          (S.rider.queued ||= new Map()).set(riderDraftKey(), JSON.stringify(riderChanges()));
          await renderRider($('#content'));
          toast('MX Bikes is open, so this will be saved automatically when you close the game', 'info', 5000);
          break;
        }
        delete S.rider.drafts[riderDraftKey()]; S.rider.identityDraft = {}; S.rider.selectionDirty = false; S.rider.saveState = 'Saved'; S.rider.bikes = null; await renderRider($('#content')); toast('Saved to your active game profile', 'ok'); }
      catch (err) { a.disabled = false; toast(esc(cleanErr(err)), 'err', 7000); } break;
    }
    case 'rider-cancel-queued': await api.invoke('rider:cancelPendingApply', S.rider.profile, S.rider.bike); S.rider.queued?.delete(riderDraftKey()); await renderRider($('#content')); toast('Cancelled. Your preview is still here to Apply or Revert.', 'info', 3000); break;
    case 'rider-revert': S.rider.queued?.delete(riderDraftKey()); api.invoke('rider:cancelPendingApply', S.rider.profile, S.rider.bike).catch(() => {}); delete S.rider.drafts[riderDraftKey()]; S.rider.identityDraft = {}; S.rider.selectionDirty = false; S.rider.saveState = ''; S.rider.profile = null; S.rider.bike = null; S.rider.bikes = null; await renderRider($('#content')); break;
    case 'rider-refresh': if (!riderDirty()) { S.rider.profile = null; S.rider.bike = null; } S.rider.bikes = null; S.rider.modelKey = null; S.rider.bikeModelKey = null; S.gearThumbs.clear(); await renderRider($('#content')); toast('Rider and bike refreshed from the game', 'ok'); break;
    case 'profile-delete': {
      if (!await confirmBox('Delete rider profile?', `Move <b>${esc(S.rider.profile)}</b> and its saved gear and settings to the Recycle Bin? Another profile will be selected if this one is active.`, 'Delete profile', true)) break;
      try { const removed = S.rider.profile; const result = await api.invoke('rider:deleteProfile', removed); for (const key of Object.keys(S.rider.drafts)) if (key.startsWith(removed + '|')) delete S.rider.drafts[key]; S.rider.selectionDirty = false; S.rider.saveState = ''; S.rider.profiles = result.profiles; S.rider.profile = result.last; S.rider.bikes = null; S.rider.bike = null; await renderRider($('#content')); }
      catch (err) { toast(esc(cleanErr(err)), 'err', 6000); } break;
    }
    case 'profile-activate': {
      try { const result = await api.invoke('rider:activateProfile', S.rider.profile); S.rider.activeProfile = result.name; await renderRider($('#content')); toast('Profile selected for your next ride', 'ok'); }
      catch (error) { toast(esc(cleanErr(error)), 'err', 6000); }
      break;
    }
    case 'rescan': await rescan(); break;
    case 'retry-bike-previews': await api.invoke('library:retryBikeThumbnails'); await rescan(true); break;
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
      closeDrawer(); await refreshInstalledIds(); await rescan(true);
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
      await refreshInstalledIds();
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
      S.selected.clear(); await refreshInstalledIds(); await rescan(true);
      break;
    }
    case 'rider-pick-bike': {
      const R = S.rider;
      bikePicker({ current: R.bike, selectedInGame: R.bikes.find((b) => b.selected)?.id,
        onPick: async (v) => { R.bike = v; R.selectionDirty = true; R.bikes = null; await renderRider($('#content')); } });
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
    case 'open-site': api.invoke('open:external', 'https://coremx.app/#/browse?src=local'); break;
    case 'browse-more': S.browse.emptyPages = 0; browseLoad(); break;
    case 'browse-retry': if (S.browse.posts.length) browseLoad(); else browseReset(); break;
    case 'pick-user': case 'pick-install': S.env = await api.invoke('settings:pickFolder', act === 'pick-user' ? 'user' : 'install'); render(); if (S.env.modsFound) rescan(true); break;
    case 'redetect': S.env = await api.invoke('settings:redetect'); render(); if (S.env.modsFound) rescan(true); toast('Folders re-detected', 'ok', 1800); break;
    case 'clear-jobs': S.jobs = new Map((await api.invoke('jobs:clearHistory')).map((j) => [j.id, j])); renderDownloads($('#content')); renderRail(); toast('Completed history cleared. Installed files were kept.', 'ok'); break;
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
$('#launchBtn').addEventListener('click', async () => { try { if (riderDirty()) { toast('Apply or Revert your Rider preview before launching MX Bikes.', 'info', 5000); return; } await api.invoke('game:launch'); toast('Launching MX Bikes…', 'info', 2500); } catch (e) { toast(esc(cleanErr(e)), 'err', 4000); } });

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
    const m = $$('.modal-wrap:not(.closing)').pop();
    if (m) m.close(); else if (S.drawerId) closeDrawer(); else if (S.selected.size) { S.selected.clear(); renderLibItems(); }
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const s = $('#libSearch') || $('#brSearch');
    if (s) { s.focus(); s.select(); }
  }
});

// ---------- events from main ----------
api.on('rider:pendingApplied', (results) => {
  for (const r of results || []) for (const key of [...(S.rider.queued?.keys() || [])]) if (key.endsWith('|' + r.bike)) { S.rider.queued.delete(key); if (r.ok) delete S.rider.drafts[key]; }
  const bad = (results || []).filter((r) => !r.ok);
  if (bad.length) toast(`Couldn't save your Rider changes: ${esc(bad[0].error)}`, 'err', 8000);
  else toast('MX Bikes closed, so your Rider changes are now saved to the game', 'ok', 4500);
});
api.on('rider:changed', async ({ active, fromGame }) => { if (fromGame) toast('Saved from the in-game overlay. It is written to your profile when MX Bikes closes.', 'ok', 4500); const profiles = await api.invoke('rider:profiles'); S.rider.profiles = profiles.profiles; if (!riderDirty()) { S.rider.profile = active; S.rider.bike = null; S.rider.saveState = ''; } S.rider.bikes = null; S.gearThumbs.clear(); if (S.view === 'rider') renderRider($('#content')); });
const equipQueue = [];
let equipPromptBusy = false;
function installedEquipTarget(choice) {
  const R = S.rider, bike = choice.bike || R.bike;
  return { profile: R.profile, bike, changes: { ...(R.drafts[`${R.profile}|${bike}`] || {}) } };
}
async function equipInstalledPreview(job, index, paint, target) {
  // Merge into the chosen profile/bike draft, including edits made before
  // installing. Do not write a separate saved-game outfit behind the preview.
  const result = await api.invoke('jobs:equip', job.id, index, paint, target);
  const R = S.rider, key = `${result.profile}|${result.bike}`;
  R.drafts[key] = { ...(R.drafts[key] || {}), ...result.changes };
  if (R.profile !== result.profile || R.bike !== result.bike) R.selectionDirty = true;
  R.profile = result.profile; R.bike = result.bike;
  R.lo = null; R.bikes = null; R.saveState = 'Preview changes';
  S.gearThumbs.clear();
  if (S.view === 'rider') await renderRider($('#content'));
  toast('Added to your Rider preview. Click Apply on the Rider page to save it to the game.', 'ok', 6000);
}
async function offerEquip(job) {
  equipQueue.push(job); if (equipPromptBusy) return; equipPromptBusy = true;
  try {
    while (equipQueue.length) {
      const j = equipQueue.shift();
      await new Promise((resolve) => {
        let choosing = false;
        const choices = j.equipCandidates;
        let selectedIndex = 0, previewRevision = 0;
        const previews = new Map();
        const label = (choice) => ({ helmetPaint: 'Helmet paint', gogglesPaint: 'Goggles', suitPaint: 'Rider kit', glovesPaint: 'Gloves', bootsPaint: 'Boot paint', protectionPaint: 'Protector paint', bikePaint: 'Bike livery' }[choice.slot] || 'Gear');
        const preview = (index) => {
          if (!previews.has(index)) previews.set(index, (async () => {
            if (choices[index].slot === 'bikePaint' || !window.RiderViewer) return j.image;
            const ctx = await api.invoke('jobs:equipContext', j.id, index, installedEquipTarget(choices[index])), paint = ctx.preferred?.[0] || '';
            const model = await api.invoke('rider:thumbModel', ctx.profile, ctx.bike, ctx.slot, paint, ctx.lo.current);
            if (model.unreadable?.includes(ctx.slot)) return j.image;
            return await window.RiderViewer.thumb(model, GEAR_FRAMING[ctx.slot] || 'full', 320);
          })().catch(() => j.image));
          return previews.get(index);
        };
        const m = modal({ title: 'Installed — use it now?', size: 'sm', body: `<p><b>${esc(j.title)}</b> is installed.</p><p class="muted">Add it to the rider you’re customizing, choose its paints, or skip for now. Use Apply on the Rider page to save your preview to the game.</p><button class="equip-item-btn" data-equip-choice><span class="equip-item-preview"></span><span><b>${esc(choices[0].label)}</b><small>${esc(label(choices[0]))}</small></span>${icon('chevron')}</button>`, foot: '<button class="btn" data-close>Skip</button><button class="btn" data-equip-installed="customize">Customize first</button><button class="btn btn-primary" data-equip-installed="now">Use in preview</button>', onClose: () => { if (!choosing) resolve(); } });
        const drawChoice = async () => {
          const revision = ++previewRevision, button = $('[data-equip-choice]', m);
          button.querySelector('b').textContent = choices[selectedIndex].label; button.querySelector('small').textContent = label(choices[selectedIndex]);
          const url = await preview(selectedIndex);
          if (m.isConnected && revision === previewRevision) $('.equip-item-preview', m).innerHTML = url ? `<img src="${esc(url)}" alt="Installed item preview">` : icon('shirt');
        };
        drawChoice();
        $('[data-equip-choice]', m).addEventListener('click', () => {
          if (choices.length === 1) { $('[data-equip-installed="customize"]', m).click(); return; }
          const picker = modal({ title: 'Choose an installed item', body: `<div class="gear-grid">${choices.map((choice, index) => `<button class="gear-tile" data-equip-index="${index}"><span class="gear-img">${j.image ? `<img src="${esc(j.image)}" alt="">` : icon('shirt')}</span><span class="gear-name">${esc(choice.label)}</span><small>${esc(label(choice))}</small></button>`).join('')}</div>` });
          choices.forEach(async (_, index) => { const url = await preview(index); if (picker.isConnected && url) $(`[data-equip-index="${index}"] .gear-img`, picker).innerHTML = `<img src="${esc(url)}" alt="">`; });
          picker.addEventListener('click', (e) => { const item = e.target.closest('[data-equip-index]'); if (item) { selectedIndex = Number(item.dataset.equipIndex); picker.close(); drawChoice(); } });
        });
        $$('[data-equip-installed]', m).forEach((button) => button.addEventListener('click', async (e) => {
          const index = selectedIndex; e.target.disabled = true;
          try {
            const target = installedEquipTarget(choices[index]);
            const ctx = await api.invoke('jobs:equipContext', j.id, index, target);
            target.profile = ctx.profile; target.bike = ctx.bike;
            // A post-install Customize action must never reopen the player's
            // entire library.  `preferred` is built from exactly the files
            // written by this job; retain only those names which the selected
            // model exposes, including paints inside this download's PKZ.
            // Never add unrelated paints already present in the library.
            const available = ctx.lo.options[ctx.slot] || [];
            const downloaded = [...new Set(ctx.preferred || [])].filter((value) => available.includes(value));
            const values = downloaded.length ? downloaded : [''];
            if (choices[index].hasModel && !values.includes('')) values.unshift('');
            const options = values.map((value) => ({ value, label: prettyValue(ctx.slot, value) }));
            const equip = async (paint) => {
              try { await equipInstalledPreview(j, index, paint, target); }
              catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
              finally { resolve(); }
            };
            choosing = true; m.close();
            if (e.target.dataset.equipInstalled === 'customize') gearPicker(ctx.lo.slots.find((s) => s.id === ctx.slot), options, ctx.lo, { context: { profile: ctx.profile, bike: ctx.bike }, confirmSelection: true, onPick: equip, onClose: resolve });
            else await equip(ctx.preferred.find((paint) => options.some((o) => o.value === paint)) || '');
          } catch (err) { e.target.disabled = false; toast(esc(cleanErr(err)), 'err', 6000); }
        }));
      });
    }
  } finally { equipPromptBusy = false; }
}
api.on('jobs:update', (j) => {
  const prev = S.jobs.get(j.id);
  S.jobs.set(j.id, j);
  if (downloadWatch?.id === j.id) drawDownloadWatch();
  for (const old of [...S.jobs.values()].filter((job) => ['done', 'error'].includes(job.status)).sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt)).slice(10)) { S.jobs.delete(old.id); $(`[data-job="${old.id}"]`)?.remove(); }
  refreshInlineDownloads();
  if ((!prev || prev.status !== j.status) && $('.dl-summary')) $('.dl-summary').outerHTML = downloadSummaryHtml([...S.jobs.values()]);
  if (prev && prev.status !== j.status) {
    if (j.status === 'done' && j.appId) appSavedPopup(j);
    // Gear CoreMX fetched so other riders look right in your game: never offered for your own rider.
    else if (j.status === 'done' && (j.friendGear || j.forOthers)) toast(`Installed <b>${esc(j.title)}</b> so ${j.friendName ? `<b>${esc(j.friendName)}</b>'s` : 'other riders’'} gear shows in your game`, 'ok', 4500);
    else if (j.status === 'done') toast(`Installed <b>${esc(j.title)}</b>`, 'ok', 4500);
    if (j.status === 'error' && j.error !== 'Cancelled') toast(`<b>${esc(j.title)}</b>: ${esc(j.error)}`, 'err', 7000);
    if (j.status === 'browser') toast(`<b>${esc(j.title)}</b> needs the browser window — click its download button there.`, 'info', 6000);
    renderRail();
  } else if (!prev) renderRail();
  if (j.status === 'done' && prev?.status !== 'done' && j.equipCandidates?.length && !j.friendGear && !j.forOthers) offerEquip(j);
  if (S.view === 'downloads' && (!S.dlTab || S.dlTab === 'downloads')) updateJobInPlace(j);
  else if (S.view === 'downloads' && S.dlTab === 'recent' && j.status === 'done') renderRecentInstalls($('#content'));
});
// A program (setup .exe, or a tool in a zip) or files for making mods were downloaded: they are saved
// to Downloads, not installed into the game, and CoreMX never runs programs. Say where to start them.
function appSavedPopup(j) {
  const m = modal({
    title: j.appFiles ? 'Files saved to Downloads' : 'Program downloaded, not installed yet', size: 'sm',
    body: j.appFiles
      ? `<p><b>${esc(j.title)}</b> is a set of files for making mods (fonts, templates or 3D models), not something the game loads.</p><p>They're saved in your Downloads folder. Open them any time from <b>My Mods → Apps</b>.</p>`
      : `<p><b>${esc(j.title)}</b> comes as a program (an installer or a tool). CoreMX never runs programs by itself, so nothing is in your game yet.</p><p>To install it: <b>My Mods → Apps</b>, then <b>Run</b>. Close MX Bikes first if it's a plugin.</p>`,
    foot: `<span class="grow"></span><button class="btn" data-close>OK</button><button class="btn btn-primary" data-app-open>${icon('folder')}Open Apps</button>`,
  });
  m.addEventListener('click', (e) => {
    if (!e.target.closest('[data-app-open]')) return;
    m.close();
    S.lib.scope = 'mods'; S.lib.tab = 'apps'; go('library');
  });
}
api.on('jobs:review', (id) => {
  const j = S.jobs.get(id);
  if (j) toast(`<b>${esc(j.title)}</b> is ready — review where it goes.`, 'info', 4000);
  if (!reviewOpen) openReview(id);
});
const onLibraryChanged = debounce(async () => {
  S.gearThumbs.clear();
  S.gfx = null; S.animations = null; S.plugins = null; S.apps = null;
  await refreshInstalledIds(); await rescan(true);
  for (const refresh of openPostRefreshers) refresh().catch(() => {});
  S.friendDialog?.refresh(true);
  if (typeof checkFriendTrackJoin === 'function') checkFriendTrackJoin().catch((e) => toast(esc(cleanErr(e)), 'err', 6000));
  if (S.view === 'rider') { S.rider.bikes = null; renderRider($('#content')); }
  S.packs = null;
  if (isFree()) renderBrowseGrid();
  if (isShop()) drawShops();
  if (S.view === 'packs') renderPacks($('#content'));
  if (S.view === 'settings' && S.settingsTab === 'health') renderHealth($('#content'));
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
  refreshAccounts().catch(() => {});
  setTimeout(refreshNotifications, 3000);
  setInterval(refreshNotifications, 30000);
  api.invoke('app:updates').then((state) => { if (state) { S.appUpdate = state; drawAppUpdate(); } }).catch(() => {});
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
  // Links are delivered only after environment, jobs and installed content are ready.
  for (const link of await api.invoke('deeplink:ready')) queueOpenLink(link);
})();

api.on('shops:changed', async () => { await refreshAccounts(); rerenderAccountsArea(); });
// A download from a shop or browser window: a big window with its progress, closed by itself when the
// download is done (the "what did you install" review then opens, or it installs), fails or is cancelled.
let downloadWatch = null;
function watchDownload(id) {
  if (downloadWatch?.m.isConnected) downloadWatch.m.close();
  const m = modal({ title: 'Downloading', size: 'sm', body: '<div data-dl-watch></div>',
    foot: '<button class="btn" data-dl-cancel>Cancel download</button><span class="grow"></span><button class="btn btn-primary" data-close>Keep going in the background</button>',
    onClose: () => { if (downloadWatch?.m === m) downloadWatch = null; } });
  downloadWatch = { id, m };
  $('[data-dl-cancel]', m).addEventListener('click', () => { api.invoke('jobs:cancel', id).catch(() => {}); m.close(); });
  drawDownloadWatch();
}
function drawDownloadWatch() {
  const w = downloadWatch;
  if (!w || !w.m.isConnected) return;
  const j = S.jobs.get(w.id);
  if (j && ['review', 'installing', 'done', 'error'].includes(j.status)) { w.m.close(); return; }
  const known = j && j.total > 0, pct = known ? Math.min(100, Math.floor(j.received / j.total * 100)) : 0;
  const box = $('[data-dl-watch]', w.m);
  if (box) box.innerHTML = `<p><b>${esc(j?.title || 'Your download')}</b></p><progress max="100" ${known ? `value="${pct}"` : ''} style="width:100%"></progress>
    <p class="muted">${j?.status === 'extracting' ? 'Unpacking…' : known ? `${fmtSize(j.received)} of ${fmtSize(j.total)} · ${pct}%` : j?.received ? `${fmtSize(j.received)} downloaded` : 'Starting…'}</p>
    <p class="muted">The shop window closes once the file is here. Then CoreMX asks where it goes, or installs it.</p>`;
}
api.on('jobs:started', (id) => { renderRail(); if (id) watchDownload(id); else toast('Download started — it will install automatically', 'info', 2500); });

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

// ---------- Settings: section menu ----------
// General settings is one long page; a side menu jumps to each section and
// highlights the one in view.
const SETTINGS_ICONS = { 'MX Bikes user folder': 'folder', 'Game install folder': 'folder', Accounts: 'key', Installing: 'download', Pictures: 'image', 'Extraction tools': 'box', 'Disabled mods': 'power', Setup: 'settings', 'App updates': 'refresh', About: 'info' };
function buildSettingsNav(c) {
  const list = $('.settings', c), sc = $('.scroller', c);
  if (!list || !sc || list.parentElement.classList.contains('settings-layout')) return;
  const cards = $$(':scope > .set-card', list).filter((card) => $('h3', card));
  cards.forEach((card, i) => { card.id = `set-${i}`; });
  const layout = document.createElement('div'); layout.className = 'settings-layout';
  list.replaceWith(layout);
  layout.innerHTML = `<nav class="set-nav">${cards.map((card, i) => { const t = $('h3', card).textContent.trim(); return `<button data-set-jump="${i}" class="${i ? '' : 'active'}">${icon(SETTINGS_ICONS[t] || 'settings')}<span>${esc(t)}</span></button>`; }).join('')}</nav>`;
  layout.appendChild(list);
  const nav = $('.set-nav', layout);
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set-jump]'); if (!b) return;
    const card = $(`#set-${b.dataset.setJump}`, list);
    const target = sc.scrollTop + card.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8, from = sc.scrollTop;
    sc.scrollTo({ top: target, behavior: 'smooth' });
    // If smooth scrolling is unavailable, jump there instead.
    setTimeout(() => { if (sc.scrollTop === from && Math.abs(target - from) > 2) sc.scrollTop = target; }, 600);
    card.classList.toggle('flash', false); void card.offsetWidth; card.classList.toggle('flash', true);
    // Keep the clicked section highlighted while the page scrolls to it.
    lockUntil = Date.now() + 900;
    $$('[data-set-jump]', nav).forEach((x) => x.classList.toggle('active', x === b));
  });
  let lockUntil = 0;
  const spy = () => {
    if (Date.now() < lockUntil) return;
    const edge = sc.getBoundingClientRect().top + 60;
    let current = 0;
    cards.forEach((card, i) => { if (card.getBoundingClientRect().top <= edge) current = i; });
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) current = cards.length - 1;
    $$('[data-set-jump]', nav).forEach((b) => b.classList.toggle('active', Number(b.dataset.setJump) === current));
  };
  sc.addEventListener('scroll', spy, { passive: true });
}
const renderSettingsBase = renderSettings;
// eslint-disable-next-line no-func-assign
renderSettings = async function (c) { await renderSettingsBase(c); if (S.view === 'settings' && (S.settingsTab || 'general') === 'general') buildSettingsNav(c); };

// ---------- Missing track (from the game plugin) ----------
// A short two-note chime so the pop-up is noticed even with the game in front.
function chime() {
  try {
    const ctx = new AudioContext(), t = ctx.currentTime;
    for (const [f, at] of [[880, 0], [1320, 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(0.18, t + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
      o.connect(g).connect(ctx.destination); o.start(t + at); o.stop(t + at + 0.4);
    }
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}
const SOURCE_LABEL = { 'mxb-mods': 'MXB Mods · free', hub: 'MXB Hub · shop', mxbs: 'MX Bikes Shop · shop' };
let missingModal = null;
// After the missing track installs: restart MX Bikes straight into the server you tried to join.
S.pendingRejoin = null;
api.on('jobs:update', (j) => {
  const p = S.pendingRejoin;
  if (!p || j.status !== 'done' || Date.now() - p.at > 30 * 60 * 1000) return;
  if (!(String(j.postId || '') === String(p.postId || '-') || j.plan?.kind === 'track')) return;
  S.pendingRejoin = null;
  let left = 5, timer = null;
  const m = modal({
    title: 'Track installed', size: 'sm',
    body: `<p style="margin-top:0">Restarting MX Bikes to join <b>${esc(p.server || p.address)}</b> in <b data-rj-left>${left}</b>…</p><p class="muted" style="font-size:12px">MX Bikes is closed the normal way, so your profile is saved first.</p>`,
    foot: `<button class="btn" data-close>Cancel</button><span class="grow"></span><button class="btn btn-primary" data-rj-now>${icon('play')}Join now</button>`,
    onClose: () => clearInterval(timer),
  });
  const go = async () => {
    clearInterval(timer); m.close();
    toast(`Restarting MX Bikes to join <b>${esc(p.server || p.address)}</b>…`, 'info', 6000);
    try { await api.invoke('game:restartAndJoin', p.address, p.server || ''); } catch (e) { toast(esc(cleanErr(e)), 'err', 7000); }
  };
  $('[data-rj-now]', m).addEventListener('click', go);
  timer = setInterval(() => { left--; const el = $('[data-rj-left]', m); if (el) el.textContent = left; if (left <= 0) go(); }, 1000);
});

api.on('missing:track', ({ track, results, address, server }) => {
  if (missingModal) missingModal.close();
  chime();
  S.pendingRejoin = address ? { address, server, track, at: Date.now(), postId: null } : null;
  const pretty = String(track).replace(/_/g, ' ');
  const row = (r, i) => `<div class="mt-row" data-mt="${i}"><div class="mt-img">${r.image ? `<img src="${esc(r.image)}" alt="">` : icon('track')}</div>
    <div class="mt-txt"><b>${esc(r.title)}</b><small>${SOURCE_LABEL[r.source] || esc(r.source)}${r.price ? ` · ${esc(r.price)}` : ''}</small></div>
    ${r.source === 'mxb-mods' ? `<button class="btn btn-primary btn-sm" data-mt-open="${i}">${icon('download')}View & install</button>` : dependencyButton({ url: r.link }, 'View in shop')}</div>`;
  missingModal = modal({
    title: 'Missing track', size: 'sm',
    body: `<p style="margin-top:0">MX Bikes couldn't join${server ? ` <b>${esc(server)}</b>` : ''} because you don't have <b>${esc(pretty)}</b>.</p>
      ${address ? `<label class="mt-rejoin"><input type="checkbox" data-mt-rejoin checked><span>When the track is installed, restart MX Bikes and join ${server ? `<b>${esc(server)}</b>` : 'the server'}</span></label>` : ''}
      ${results.length ? `<div class="section-title" style="margin-top:4px">Best matches</div><div class="mt-list">${results.map(row).join('')}</div><p class="muted" style="font-size:12px">Matches are found by name; check it's the right track before installing.</p>` : `<div class="notice info">${icon('info')}<div>No match on MXB Mods, MXB Hub or MX Bikes Shop. The server's own page or Discord usually links it.</div></div>`}`,
    foot: `<button class="btn" data-mt-search>${icon('search')}Search Get Mods</button><span class="grow"></span><button class="btn" data-close>Close</button>`,
    onClose: () => { missingModal = null; },
  });
  missingModal.addEventListener('click', (e) => {
    const open = e.target.closest('[data-mt-open]');
    const rejoin = e.target.closest('[data-mt-rejoin]');
    if (rejoin) { if (rejoin.checked && address) S.pendingRejoin = { address, server, track, at: Date.now(), postId: null }; else S.pendingRejoin = null; return; }
    if (open) { const r = results[Number(open.dataset.mtOpen)]; if (S.pendingRejoin) S.pendingRejoin.postId = r.id; missingModal.close(); openPost(r); return; }
    if (e.target.closest('[data-mt-search]')) { missingModal.close(); if (typeof findTrack === 'function') findTrack(pretty); }
  });
});
// The plugin's missing-track detection paused (game updated) or switched off (it crashed the game).
api.on('plugin:hook', (info) => {
  const crashed = info.state === 'disabled';
  modal({
    title: crashed ? 'Missing-track detection switched off' : 'Missing-track detection paused', size: 'sm',
    body: `<div class="notice ${crashed ? 'warn' : 'info'}">${icon(crashed ? 'alert' : 'info')}<div>${crashed
      ? 'MX Bikes crashed inside the CoreMX plugin, so missing-track detection has been switched off to keep the game stable.'
      : 'MX Bikes has been updated, and the plugin doesn\'t recognise the new version yet, so missing-track detection is paused. Nothing in the game was changed.'}</div></div>
      <p>It turns back on automatically when you install the next CoreMX update. Everything else (friends, live servers, gear sync) keeps working.</p>`,
    foot: '<button class="btn btn-primary" data-close>OK</button>',
  });
});

// Links from the website (coremx.app): mxbm://install/<source>/<id>[?file=n] and mxbm://oem/<pack>
async function handleOpenLink(l) {
  if (!l) return;
  try {
    if (l.type === 'join') { await handleJoinLink(l.address); return; }
    if (!S.env.settings.setupDone || !S.env.modsFound) {
      toast('Finish setup and choose your MX Bikes folder, then open the website link again.', 'info', 6000);
      if (S.env.settings.setupDone) openSetup(0);
      return;
    }
    if (l.type === 'oem') {
      S.packs = await api.invoke('packs:list', true);
      go('packs');
      const pack = S.packs.find((p) => p.id === l.pack);
      const b = $(`#packList [data-pack-update="${l.pack}"]:not([disabled]), #packList [data-pack-full="${l.pack}"]:not([disabled])`);
      if (b) b.click();
      else if ([...S.jobs.values()].some((j) => j.packId === l.pack && !['done', 'error', 'cancelled'].includes(j.status))) toast('That pack is already downloading. See Downloads for progress.', 'info', 4000);
      else if (pack && !pack.error && pack.summary && !pack.summary.needCount) toast('That pack is already installed and up to date', 'ok', 3500);
      else toast(pack?.error || 'Could not load this OEM pack. Try Check again.', 'err', 5000);
      return;
    }
    if (l.type !== 'install') return;
    const t = await api.invoke('deeplink:target', l);
    if (!t) { toast('That mod could not be found. It may have been removed.', 'err', 5000); return; }
    if (t.source === 'mxbmods' || t.source === 'local') {
      S.getSrc = 'free';
      Object.assign(S.browse, { posts: [], cursor: null, kind: 'all', tab: 'all', page: 0, totalPages: 1, loading: false, reqId: (S.browse.reqId || 0) + 1 });
      go('get'); await openPost(t.post, { install: true, file: Number.isInteger(l.file) ? l.file : null }); return;
    }
    S.getSrc = t.source; go('get');
    await api.invoke('shops:open', t.source, t.link);
  } catch (e) { toast(esc(cleanErr(e)), 'err', 6000); }
}
let linkSequence = Promise.resolve();
function queueOpenLink(link) { linkSequence = linkSequence.then(() => handleOpenLink(link)).catch((e) => toast(esc(cleanErr(e)), 'err', 6000)); return linkSequence; }
api.on('deeplink:open', queueOpenLink);

function installLinkedDownload(post, file) {
  const downloads = post.downloads || [];
  if (Number.isInteger(file) && !downloads[file]) { toast('That download is no longer available. Choose a download below.', 'info', 5000); return; }
  const picked = Number.isInteger(file) ? downloads[file] : downloads.length === 1 ? downloads[0] : null;
  if (!picked) { toast('Choose which download to install below.', 'info', 4000); return; }
  if (picked.installed) { toast('This download is already installed.', 'ok', 3500); return; }
  (picked.shop ? installDependency(picked.url) : startDownload(post, picked)).catch((e) => toast(esc(cleanErr(e)), 'err', 6000));
}
