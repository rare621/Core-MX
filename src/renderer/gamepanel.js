/* global S, $, $$, esc, icon, toast, modal, confirmBox, cleanErr, debounce, api, go, fmtSize, thumbHtml, listPicker, bikePicker, bikeItem, bikeTitle, openItem */
'use strict';
// ---------- Game: Ride and game settings; maintenance lives in app Settings ----------
S.gameTab = 'ride';
S.ride = { bike: null, track: null };

function gameTabs() {
  const t = (id, ic, l) => `<button class="${S.gameTab === id ? 'active' : ''}" data-game-tab="${id}">${icon(ic)}${l}</button>`;
  return `<div class="seg-tabs">${t('ride', 'play', 'Ride')}${t('settings', 'settings', 'Settings')}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-game-tab]');
  if (b) { S.gameTab = b.dataset.gameTab; renderGame($('#content')); }
});

function renderGame(c) {
  if (S.gameTab === 'settings') return renderGameSettings(c);
  return renderRide(c);
}

// ---- Ride ----
async function renderRide(c) {
  const st = await api.invoke('game:settings').catch(() => null);
  const info = (st && st.values.info) || {};
  if (!S.ride.bike) S.ride.bike = (st && st.values.currentBike) || info.bikeid || null;
  if (!S.ride.track) S.ride.track = (st && st.values.ui && st.values.ui.race_track) || null;
  const bike = S.ride.bike && bikeItem(S.ride.bike);
  const track = S.ride.track && S.items.find((i) => i.group === 'tracks' && i.name === S.ride.track);
  const tile = (kind, it, title, sub) => `<button class="ride-pick" data-ride-pick="${kind}">
      <div class="thumb ride-img">${it ? thumbHtml(it) : `<div class="ph"><div class="ph-icon">${icon(kind === 'bike' ? 'bike' : 'track')}</div></div>`}</div>
      <div class="ride-txt"><div class="slot-l">${kind === 'bike' ? 'Bike' : 'Track'}</div><div class="ride-title">${esc(title)}</div><div class="muted" style="font-size:13px">${esc(sub || '')}</div></div>
      <span class="btn btn-sm">Change</span></button>`;
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>Game</h2>${gameTabs()}</div>
    <div class="scroller"><div style="max-width:960px">
      <div class="ride-grid">
        ${tile('bike', bike, bike ? bike.title : (S.ride.bike || 'Choose a bike'), bike ? [bike.cc && (bike.cc === 'Electric' ? 'Electric' : `${bike.cc}cc`), bike.bikeClass].filter(Boolean).join(' · ') : '')}
        ${tile('track', track, track ? track.title : (S.ride.track || 'Choose a track'), track ? (track.info && track.info.author) || track.label : '')}
      </div>
      <div class="ride-go">
        <button class="btn btn-primary ride-btn" data-act="ride-go">${icon('play')}Ride</button>
        <div class="muted" style="font-size:13px">Sets this bike and track in your game, then opens MX Bikes — choose <b>Single Player</b> and your bike and track are already set. Your outfit for this bike comes from the <b>Rider</b> tab.</div>
      </div>
    </div></div></div></div>`;
}

// Picture grid picker: search + cards with each mod's preview image.
function gridPicker({ title, items, current, meta, onPick, facets = [] }) {
  const filters = {};
  const m = modal({
    title: esc(title),
    body: `<div class="search wide" style="margin-bottom:16px">${icon('search')}<input id="gpQ" placeholder="Search…" spellcheck="false"></div>
      ${facets.length ? `<div class="picker-filters">${facets.map((fc) => {
        const vals = [...new Set(items.map(fc.get).filter(Boolean))].sort(fc.order || ((a, b) => String(a).localeCompare(String(b))));
        return `<label><span>${esc(fc.label)}</span><select data-picker-filter="${esc(fc.key)}"><option value="">${esc(FACET_ALL[fc.key] || 'All')}</option>${vals.map((v) => `<option value="${esc(v)}">${esc(fc.fmt(v))}</option>`).join('')}</select></label>`;
      }).join('')}<button class="btn btn-sm" data-picker-reset>Reset</button></div>` : ''}
      <div class="picker-count" id="gpCount" aria-live="polite"></div><div id="gpGrid"></div>`,
  });
  const sorted = [...items].sort((a, b) => (b.name === current) - (a.name === current) || a.title.localeCompare(b.title, undefined, { numeric: true }));
  const draw = () => {
    const q = $('#gpQ', m).value.toLowerCase().split(/\s+/).filter(Boolean);
    const xs = sorted.filter((i) => {
      const hay = `${i.title} ${i.name} ${meta(i)}`.toLowerCase();
      return q.every((t) => hay.includes(t)) && facets.every((fc) => !filters[fc.key] || String(fc.get(i)) === filters[fc.key]);
    });
    $('#gpCount', m).textContent = `${xs.length} of ${items.length}`;
    $('#gpGrid', m).innerHTML = xs.length ? `<div class="grid">${xs.map((i) => `<div class="card ${i.name === current ? 'selected' : ''}" data-gp="${esc(i.name)}">
        <div class="thumb">${thumbHtml(i)}${i.name === current ? `<div class="badges"><span class="badge ok">${icon('check')}Selected</span></div>` : ''}</div>
        <div class="card-body"><div class="card-title" title="${esc(i.title)}">${esc(i.title)}</div><div class="card-meta">${esc(meta(i))}</div></div></div>`).join('')}</div>`
      : `<div class="empty"><div>${icon('search')}<h3>No matches</h3></div></div>`;
  };
  $('#gpQ', m).addEventListener('input', draw);
  $$('[data-picker-filter]', m).forEach((el) => el.addEventListener('change', () => { filters[el.dataset.pickerFilter] = el.value; draw(); }));
  const reset = $('[data-picker-reset]', m);
  if (reset) reset.addEventListener('click', () => {
    $('#gpQ', m).value = '';
    $$('[data-picker-filter]', m).forEach((el) => { el.value = ''; delete filters[el.dataset.pickerFilter]; });
    draw();
  });
  $('#gpGrid', m).addEventListener('click', (e) => { const c = e.target.closest('[data-gp]'); if (c) { m.close(); onPick(c.dataset.gp); } });
  draw();
  setTimeout(() => $('#gpQ', m).focus(), 50);
}

document.addEventListener('click', async (e) => {
  const p = e.target.closest('[data-ride-pick]');
  if (p) {
    if (p.dataset.ridePick === 'bike') {
      bikePicker({
        current: S.ride.bike,
        onPick: (v) => { S.ride.bike = v; renderRide($('#content')); },
      });
    } else {
      gridPicker({
        title: 'Choose a track', current: S.ride.track,
        items: S.items.filter((i) => i.group === 'tracks' && !i.disabled && i.sub !== '(loose)' && i.kind !== 'archive' && !i.duplicateOf),
        meta: (i) => [i.label, i.info && i.info.author].filter(Boolean).join(' · '),
        onPick: (v) => { S.ride.track = v; renderRide($('#content')); },
      });
    }
    return;
  }
  const go2 = e.target.closest('[data-act="ride-go"]');
  if (go2) {
    try {
      if (!S.ride.bike || !S.ride.track) { toast('Choose a bike and a track first', 'err'); return; }
      await api.invoke('game:quickStart', { bike: S.ride.bike, track: S.ride.track });
      await api.invoke('game:launch');
      toast('Starting MX Bikes — choose <b>Single Player</b> — your bike and track are already set', 'ok', 4500);
    } catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
  }
});

// ---- Settings ----
const pct = (v) => `${Math.round(v * 100)}%`;
const GAME_SETTINGS = [
  { group: 'Display', rows: [
    { label: 'Resolution', type: 'res' },
    { label: 'Fullscreen', type: 'toggle', s: 'gfx', k: 'fullscreen' },
    { label: 'V-Sync', type: 'toggle', s: 'gfx', k: 'vsync' },
    { label: 'Anti-aliasing', type: 'select', s: 'gfx', k: 'multisample', opts: [['0', 'Off'], ['2', '2×'], ['4', '4×'], ['8', '8×']] },
  ] },
  { group: 'Graphics', rows: [
    { label: 'Draw distance', type: 'slider', s: 'gfx', k: 'drawdistance', min: 200, max: 3000, step: 50, fmt: (v) => `${Math.round(v)} m`, float: true },
    { label: '3D grass', type: 'toggle', s: 'gfx', k: '3d_grass' },
    { label: 'Shadows', type: 'toggle', s: 'gfx', k: 'shadow_disable', invert: true },
    { label: 'Reflections', type: 'toggle', s: 'gfx', k: 'reflection_disable', invert: true },
    { label: 'Shaders', type: 'toggle', s: 'gfx', k: 'shaders_disable', invert: true },
    { label: 'Texture filtering', type: 'select', s: 'gfx', k: 'anisotropic', opts: [['0', 'Off'], ['1', '2×'], ['2', '4×'], ['3', '8×'], ['4', '16×']] },
  ] },
  { group: 'Sound', rows: [
    { label: 'Master', type: 'slider', s: 'sound', k: 'master_volume', min: 0, max: 1, step: 0.01, fmt: pct, float: true },
    { label: 'Music', type: 'slider', s: 'sound', k: 'music_volume', min: 0, max: 1, step: 0.01, fmt: pct, float: true },
    { label: 'Menus', type: 'slider', s: 'sound', k: 'ui_volume', min: 0, max: 1, step: 0.01, fmt: pct, float: true },
    { label: 'Other riders', type: 'slider', s: 'sound', k: 'remotebikes_volume', min: 0, max: 1, step: 0.01, fmt: pct, float: true },
    { label: 'Brakes', type: 'slider', s: 'sound', k: 'brakes_volume', min: 0, max: 1, step: 0.01, fmt: pct, float: true },
    { label: 'Wind', type: 'slider', s: 'sound', k: 'aero_volume', min: 0, max: 1, step: 0.01, fmt: pct, float: true },
  ] },
  { group: 'Riding aids', rows: [
    { label: 'Lean assist', type: 'toggle', s: 'aids', k: 'leanhelp' },
    { label: 'Lean assist strength', type: 'slider', s: 'aids', k: 'leanhelp_scale', min: 0, max: 1, step: 0.01, fmt: pct, float: true },
    { label: 'Auto clutch', type: 'toggle', s: 'aids', k: 'autoclutch' },
    { label: 'Auto shift', type: 'toggle', s: 'aids', k: 'autoshift' },
    { label: 'Shift assist', type: 'toggle', s: 'aids', k: 'shifthelp' },
    { label: 'Brake assist', type: 'toggle', s: 'aids', k: 'brakehelp' },
    { label: 'Traction assist', type: 'toggle', s: 'aids', k: 'tractionhelp' },
    { label: 'Auto tyre change', type: 'toggle', s: 'aids', k: 'autotyreschange' },
    { label: 'Auto sit', type: 'toggle', s: 'aids', k: 'autoridersit' },
    { label: 'Auto dab', type: 'toggle', s: 'aids', k: 'autoriderdab' },
  ] },
  { group: 'Camera & HUD', rows: [
    { label: 'Field of view', type: 'slider', s: 'view', k: 'fov', min: 50, max: 130, step: 1, fmt: (v) => `${Math.round(v)}°`, float: true },
    { label: 'Show HUD', type: 'toggle', s: 'view', k: 'show_HUD' },
    { label: 'Show FPS', type: 'toggle', s: 'misc', k: 'showfps' },
    { label: 'Show rider names', type: 'toggle', s: 'misc', k: 'hide_names', invert: true },
    { label: 'Chase camera follows bike', type: 'toggle', s: 'ext_view', k: 'follow_bike' },
  ] },
  { group: 'Controls', rows: [
    { label: 'Combined brakes', type: 'toggle', s: 'input', k: 'combined_brakes' },
    { label: 'Controller rumble', type: 'toggle', s: 'input', k: 'rumble' },
  ] },
  { group: 'Other', rows: [
    { label: 'Skip intro', type: 'toggle', s: 'misc', k: 'skip_intro' },
    { label: 'Hide chat while riding', type: 'toggle', s: 'misc', k: 'disable_driving_chat' },
  ] },
];
const RESOLUTIONS = ['1280x720', '1600x900', '1920x1080', '2560x1080', '2560x1440', '3440x1440', '3840x1600', '3840x2160'];

async function renderGameSettings(c) {
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Game</h2>${gameTabs()}</div><div class="scroller"><div class="loadmore"><div class="spinner"></div></div></div></div></div>`;
  let st;
  try { st = await api.invoke('game:settings'); } catch (e) { $('.scroller', c).innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`; return; }
  if (!st) { $('.scroller', c).innerHTML = `<div class="empty"><div>${icon('settings')}<h3>No game profile yet</h3><div>Start MX Bikes once to create it.</div></div></div>`; return; }
  const V = st.values;
  const get = (r) => (V[r.s] || {})[r.k];
  const row = (r, gi, ri) => {
    const id = `gs-${gi}-${ri}`;
    let ctl;
    if (r.type === 'toggle') {
      let on = String(get(r) || '0') !== '0';
      if (r.invert) on = !on;
      ctl = `<label class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="sw"></span></label>`;
    } else if (r.type === 'select') {
      ctl = `<select id="${id}">${r.opts.map(([v, l]) => `<option value="${v}" ${String(get(r)) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    } else if (r.type === 'slider') {
      const v = Number(get(r) || 0);
      ctl = `<div class="slider"><input type="range" id="${id}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"><span class="sv" id="${id}-v">${r.fmt(v)}</span></div>`;
    } else if (r.type === 'res') {
      const cur = `${(V.gfx || {}).x}x${(V.gfx || {}).y}`;
      const list = [...new Set([...RESOLUTIONS, `${screen.width * devicePixelRatio}x${screen.height * devicePixelRatio}`, cur])].filter((x) => /^\d+x\d+$/.test(x)).sort((a, b) => parseInt(a) - parseInt(b));
      ctl = `<select id="${id}">${list.map((x) => `<option ${x === cur ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
    }
    return `<div class="gs-row"><span>${esc(r.label)}</span>${ctl}</div>`;
  };
  $('.scroller', c).innerHTML = `<div style="max-width:760px">
    <div class="muted" style="margin:-4px 4px 16px;font-size:13px">Changes save to your game profile right away (<b>${esc(st.profile)}</b>). Close MX Bikes first — the game overwrites them when it exits.</div>
    ${GAME_SETTINGS.map((g, gi) => `<div class="section-title">${esc(g.group)}</div><div class="glist">${g.rows.map((r, ri) => row(r, gi, ri)).join('')}</div>`).join('')}</div>`;

  const save = debounce(async (values) => {
    try { await api.invoke('game:setValues', values); toast('Saved', 'ok', 1000); }
    catch (e) { toast(esc(cleanErr(e)), 'err', 6000); }
  }, 350);
  const pending = new Map();
  const queue = (s, k, v) => { pending.set(`${s}|${k}`, [s, k, v]); save([...pending.values()]); };
  GAME_SETTINGS.forEach((g, gi) => g.rows.forEach((r, ri) => {
    const el = $(`#gs-${gi}-${ri}`);
    if (!el) return;
    if (r.type === 'toggle') el.addEventListener('change', () => queue(r.s, r.k, (el.checked !== !!r.invert) ? '1' : '0'));
    else if (r.type === 'select') el.addEventListener('change', () => queue(r.s, r.k, el.value));
    else if (r.type === 'slider') el.addEventListener('input', () => { const v = Number(el.value); $(`#gs-${gi}-${ri}-v`).textContent = r.fmt(v); queue(r.s, r.k, r.float ? v.toFixed(6) : String(Math.round(v))); });
    else if (r.type === 'res') el.addEventListener('change', () => { const [x, y] = el.value.split('x'); queue('gfx', 'x', x); queue('gfx', 'y', y); });
  }));
}

// ---- Fix & clean ----
async function renderHealth(c) {
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Settings</h2>${settingsTabs()}<div class="grow"></div><button class="btn" data-act="health-rescan">${icon('refresh')}Check again</button></div><div class="scroller"><div class="loadmore"><div class="spinner"></div></div></div></div></div>`;
  let r;
  try { r = await api.invoke('health:scan'); } catch (e) { $('.scroller', c).innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`; return; }
  S.health = r;
  const crash = r.issues.filter((i) => i.kind === 'crash'), clean = r.issues.filter((i) => i.kind === 'clean');
  const issueRow = (i, idx) => `<div class="srv"><div class="srv-ico" style="${i.kind === 'crash' ? 'background:var(--danger-soft);color:var(--danger)' : ''}">${icon(i.kind === 'crash' ? 'alert' : 'sparkle')}</div>
    <div class="srv-txt"><div class="t">${esc(i.title)}</div><div class="m" style="white-space:normal">${esc(i.detail)}</div></div>
    <div class="jactions"><button class="btn btn-sm ${i.kind === 'crash' ? 'btn-primary' : ''}" data-health-fix="${idx}">${esc(i.fix)}</button></div></div>`;
  const total = r.storage.total || 1;
  const colors = ['#ff8a1f', '#0a84ff', '#30d158', '#bf5af2', '#ffd60a', '#ff453a', '#64d2ff'];
  $('.scroller', c).innerHTML = `<div style="max-width:960px">
    ${!r.issues.length ? `<div class="notice ok">${icon('check')}<div>Everything looks good — no crash causes or clutter found.</div></div>` : ''}
    ${crash.length ? `<div class="section-title">Can crash the game</div><div class="srv-list">${crash.map((i) => issueRow(i, r.issues.indexOf(i))).join('')}</div>` : ''}
    ${clean.length ? `<div class="section-title" style="display:flex">Clean up<span class="grow"></span>${clean.length > 1 ? `<button class="btn btn-sm" data-act="health-fix-all">Fix all ${clean.length}</button>` : ''}</div><div class="srv-list">${clean.map((i) => issueRow(i, r.issues.indexOf(i))).join('')}</div>` : ''}
    <div class="section-title">Storage · ${fmtSize(r.storage.total)}</div>
    <div class="set-card">
      <div class="stor-bar">${r.storage.groups.map((g, i) => `<div style="width:${(g.size / total) * 100}%;background:${colors[i % colors.length]}" title="${esc(g.label)}"></div>`).join('')}</div>
      <div class="stor-legend">${r.storage.groups.map((g, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${esc(g.label)} <b>${fmtSize(g.size)}</b></span>`).join('')}</div>
    </div>
    <div class="section-title">Biggest mods</div>
    <div class="srv-list">${r.storage.biggest.map((b) => `<div class="srv" data-open-item="${esc(b.id)}" style="cursor:pointer"><div class="srv-txt"><div class="t">${esc(b.title)}</div><div class="m">${esc(b.label)}</div></div><b>${fmtSize(b.size)}</b></div>`).join('')}</div>
    <div class="muted" style="font-size:12px;margin:14px 4px">Fixes never delete for good — removed files go to the Recycle Bin, and turned-off files are renamed so you can undo it.</div>
  </div>`;
}

async function fixIssue(issue) {
  try {
    const r = await api.invoke('health:fix', issue);
    if (r && r.job) { toast('Installing…', 'info', 2000); return; }
    if (r?.conflicts?.length) toast(`Moved ${r.repaired} files. Kept ${r.conflicts.length} differing copies in their original folders for review.`, 'info', 9000);
    else if (r?.repaired != null) toast(`Repaired ${r.repaired} gear files`, 'ok');
  } catch (e) { toast(esc(cleanErr(e)), 'err', 6000); }
}

document.addEventListener('click', async (e) => {
  const f = e.target.closest('[data-health-fix]');
  if (f) { f.disabled = true; await fixIssue(S.health.issues[Number(f.dataset.healthFix)]); renderHealth($('#content')); return; }
  const a = e.target.closest('[data-act]');
  if (a && a.dataset.act === 'health-rescan') { renderHealth($('#content')); return; }
  if (a && a.dataset.act === 'health-fix-all') {
    const clean = S.health.issues.filter((i) => i.kind === 'clean');
    if (!(await confirmBox('Clean up', `Fix all <b>${clean.length}</b> items? Removed files go to the Recycle Bin.`, 'Fix all'))) return;
    for (const i of clean) await fixIssue(i);
    renderHealth($('#content'));
    return;
  }
  const oi = e.target.closest('[data-open-item]');
  if (oi && S.view === 'settings' && S.settingsTab === 'health') openItem(oi.dataset.openItem);
});
