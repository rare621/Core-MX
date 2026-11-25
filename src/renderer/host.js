/* global S, $, $$, esc, icon, toast, modal, confirmBox, confirmRiderBeforeGame, cleanErr, api, onlineTabs, debounce */
'use strict';
// ---------- Host your own dedicated server (every option from PiBoSo's server config) ----------
const CATEGORIES = ['MX1 OEM', 'MX2 OEM', 'MX1-2T OEM', 'MX2-2T OEM', 'MX3 OEM', 'MX-E OEM', 'SM OEM', 'Enduro OEM'];
const tog = (sec, key, label, hint) => ({ sec, key, label, type: 'toggle', hint });
const num = (sec, key, label, opts = {}) => ({ sec, key, label, type: 'number', ...opts });
const txt = (sec, key, label, opts = {}) => ({ sec, key, label, type: 'text', ...opts });
const sel = (sec, key, label, opts, hint) => ({ sec, key, label, type: 'select', opts, hint });

const HOST_GROUPS = [
  { id: 'server', title: 'Server', icon: 'globe', fields: [
    txt('connection', 'name', 'Server name', { placeholder: 'My MX Bikes server' }),
    num('connection', 'maxclient', 'Max riders', { min: 1, max: 100 }),
    txt('connection', 'password', 'Password', { placeholder: 'Empty = anyone can join', secret: true }),
    txt('connection', 'admin_password', 'Admin password', { placeholder: 'Lets you run admin commands', secret: true }),
    txt('connection', 'location', 'Location', { placeholder: 'e.g. EU, NA East' }),
    txt('connection', 'MOTD', 'Message of the day', { placeholder: 'Shown to riders when they join. Use /r for a new line' }),
    sel('connection', 'bandwidth', 'Your upload speed', [['', 'Default'], ['0', 'Very low'], ['1', 'Low'], ['2', 'Medium'], ['3', 'High'], ['4', 'Very high']], 'Pick lower if riders lag'),
    num('connection', 'max_ping', 'Max ping (ms)', { min: 0, max: 2000, hint: '0 = no limit' }),
    sel('rating', 'class', 'Minimum rider rating', [['', 'Anyone'], ['D', 'D (800+)'], ['C', 'C (1200+)'], ['B', 'B (1600+)'], ['A', 'A (2000+)']]),
    tog('connection', 'polls_disable', 'Turn off rider polls'),
    tog('polls', 'disable_during_races', 'No polls during races'),
    txt('connection', 'whitelist', 'Whitelist file', { placeholder: 'Optional file name in the game folder', advanced: true }),
    txt('connection', 'blacklist', 'Blacklist file', { placeholder: 'Optional file name in the game folder', advanced: true }),
  ] },
  { id: 'event', title: 'Tracks & bikes', icon: 'track', fields: [
    { type: 'tracks' },
    txt('event', 'name', 'Event name', { placeholder: 'Optional' }),
    sel('event', 'tracks_shuffle', 'Track order', [['', 'In order'], ['1', 'Shuffle once at start'], ['2', 'Re-shuffle every lap of the list']]),
    { type: 'categories' },
    txt('event', 'allowed_bikes', 'Only these bikes', { placeholder: 'Bike IDs separated by / (optional)', advanced: true }),
  ] },
  { id: 'race', title: 'Race format', icon: 'clock', fields: [
    tog('race', 'open_practice', 'Open practice only', 'No qualifying or races — just ride'),
    tog('race', 'quick_race', 'Quick race', 'Only warmup + one race, no sighting lap'),
    sel('race', 'format', 'Qualifying', [['0', 'Qualifying race'], ['1', 'Timed qualifying practice']]),
    num('race', 'practice_length', 'Practice (minutes)', { min: 0, max: 600, hint: '0 skips it' }),
    num('race', 'prequalify_length', 'Pre-qualifying (minutes)', { min: 0, max: 600, hint: '0 skips it' }),
    num('race', 'qualifypractice_length', 'Qualifying practice (minutes)', { min: 0, max: 600, hint: '0 skips it' }),
    num('race', 'warmup_length', 'Warmup (minutes)', { min: 0, max: 600, hint: '0 skips it' }),
    tog('race', 'sighting_lap', 'Sighting lap'),
    sel('race', 'race_length_format', 'Race length', [['0', '% of real race + 2 laps'], ['1', 'Minutes + extra laps'], ['2', 'Number of laps']]),
    num('race', 'race_length', 'Race length (%)', { min: 1, max: 100, show: (c) => c.race.race_length_format === '0' }),
    num('race', 'race_minutes', 'Race minutes', { min: 1, max: 600, show: (c) => c.race.race_length_format === '1' }),
    num('race', 'race_extralaps', 'Extra laps', { min: 0, max: 10, show: (c) => c.race.race_length_format === '1' }),
    num('race', 'race_laps', 'Race laps', { min: 1, max: 200, show: (c) => c.race.race_length_format === '2' }),
    num('race', 'restart_delay', 'Restart after (seconds)', { min: 0, max: 3600, hint: '0 = never restart' }),
  ] },
  { id: 'conditions', title: 'Weather & track', icon: 'sparkle', fields: [
    tog('weather', 'realistic', 'Realistic weather', 'Uses the track\'s own weather; ignores the settings below'),
    sel('weather', 'conditions', 'Sky', [['0', 'Sunny'], ['1', 'Cloudy'], ['2', 'Rainy']]),
    num('weather', 'temperature', 'Air temperature (°C)', { min: -20, max: 50 }),
    sel('weather', 'wind_direction', 'Wind from', [['0', 'North'], ['1', 'North-east'], ['2', 'East'], ['3', 'South-east'], ['4', 'South'], ['5', 'South-west'], ['6', 'West'], ['7', 'North-west']]),
    num('weather', 'wind_speed', 'Wind speed (m/s)', { min: 0, max: 30 }),
    sel('weather', 'track_conditions', 'Track', [['0', 'Dry'], ['1', 'Wet']]),
    num('deformation', 'scale', 'Rut / terrain deformation', { min: 0, max: 1, step: 0.1, hint: '0 = off, 1 = full' }),
    tog('deformation', 'auto_reset', 'Reset ruts each session'),
    tog('dynamicsurface', 'disable', 'Turn off dynamic track surface'),
    tog('dynamicsurface', 'persistent', 'Keep track surface between events'),
  ] },
  { id: 'rules', title: 'Rules', icon: 'shield', fields: [
    tog('hardcore', 'force_cockpit', 'Force first-person view'),
    tog('hardcore', 'no_aids', 'No riding aids'),
    tog('hardcore', 'limited_tyre_sets', 'Limited tyre sets'),
    sel('collisions', 'disable', 'Collisions between riders', [['1', 'Off'], ['0', 'On']]),
    num('collisions', 'max_ping', 'Turn collisions off above ping (ms)', { min: 0, max: 2000, hint: '0 = never', show: (c) => c.collisions.disable === '0' }),
    sel('reset', 'type', 'Crash reset delay', [['0', 'No delay'], ['1', 'Fixed time'], ['2', 'Based on distance from bike'], ['3', 'Based on crash speed']]),
    num('reset', 'time', 'Reset delay (ms)', { min: 0, max: 60000, show: (c) => c.reset.type === '1' }),
  ] },
  { id: 'admin', title: 'Admin tools', icon: 'settings', fields: [
    sel('live', 'enable', 'Live timing', [['', 'Off'], ['1', 'Send over UDP'], ['2', 'Write to a file']]),
    num('live', 'port', 'Live timing port', { min: 0, max: 65535, hint: '0 = 54220', show: (c) => c.live.enable === '1' }),
    txt('live', 'password', 'Live timing password', { secret: true, show: (c) => c.live.enable === '1' }),
    txt('live', 'file', 'Live timing file', { show: (c) => c.live.enable === '2' }),
    tog('live', 'track_position', 'Include track map + rider positions', null),
    sel('live', 'contacts', 'Log contacts', [['', 'No'], ['1', 'Rider contacts'], ['2', 'Rider + wall contacts']]),
    tog('remote_admin', 'enable', 'Remote admin', 'Control the server from another app'),
    num('remote_admin', 'port', 'Remote admin port', { min: 0, max: 65535, hint: '0 = 54230', show: (c) => c.remote_admin.enable === '1' }),
    txt('remote_admin', 'password', 'Remote admin password', { secret: true, show: (c) => c.remote_admin.enable === '1' }),
    sel('export', 'results', 'Save results', [['', 'No'], ['html', 'HTML'], ['xml', 'XML'], ['both', 'HTML + XML']]),
    txt('export', 'directory', 'Results folder', { placeholder: 'Must already exist', show: (c) => !!c.export.results }),
    sel('export', 'units', 'Results units', [['0', 'Metric'], ['1', 'US'], ['2', 'UK']]),
    txt('export', 'prefix', 'Results file prefix', { show: (c) => !!c.export.results }),
    tog('export', 'incremental', 'Save results after every session'),
    sel('export', 'contacts', 'Contacts in results', [['', 'No'], ['1', 'Rider contacts'], ['2', 'Rider + wall contacts']]),
    tog('replay', 'save', 'Save full race replay'),
    txt('replay', 'directory', 'Replay folder', { placeholder: 'Must already exist', show: (c) => c.replay.save === '1' }),
    txt('replay', 'prefix', 'Replay file prefix', { show: (c) => c.replay.save === '1' }),
  ] },
];

// The game's own Multiplayer → Host screen keeps its settings in profile.ini [ui].
// Dedicated-config field → profile key. Fields not listed here don't exist on the in-game Host screen.
const GAME_KEYS = {
  'connection|name': 'hostsetup_name', 'connection|maxclient': 'hostsetup_maxclients', 'connection|bandwidth': 'hostsetup_bandwidth',
  'connection|max_ping': 'hostsetup_maxping', 'connection|location': 'hostsetup_location',
  'weather|realistic': 'race_weather_realistic', 'weather|conditions': 'race_weather_conditions', 'weather|temperature': 'race_temperature',
  'weather|wind_direction': 'race_wind_direction', 'weather|wind_speed': 'race_wind_speed', 'weather|track_conditions': 'race_track_conditions',
  'hardcore|force_cockpit': 'race_forcecockpit', 'hardcore|no_aids': 'race_noaids', 'hardcore|limited_tyre_sets': 'race_limitedtyresets',
  'collisions|disable': 'disable_collisions',
  'race|open_practice': 'race_openpractice', 'race|format': 'race_format', 'race|quick_race': 'race_quickrace',
  'race|practice_length': 'race_practicelength', 'race|prequalify_length': 'race_prequalifylength', 'race|qualifypractice_length': 'race_qualifypracticelength',
  'race|warmup_length': 'race_warmuplength', 'race|sighting_lap': 'race_sightinglap', 'race|race_length': 'race_length',
  'race|race_minutes': 'race_minutes', 'race|race_laps': 'race_laps', 'race|race_extralaps': 'race_extra_laps', 'race|race_length_format': 'race_length_format',
};
const inGameField = (f) => !f.sec || f.type === 'tracks' || f.type === 'categories' || !!GAME_KEYS[`${f.sec}|${f.key}`];

function defaultHost() {
  return {
    port: 54215,
    tracks: [{ track: 'forest', layout: '' }],
    categories: ['MX1 OEM', 'MX2 OEM'],
    sections: {
      connection: { name: `${(S.accounts && S.accounts.steam && S.accounts.steam.name) || 'My'} server`, maxclient: '20', password: '', admin_password: '', location: '', MOTD: '', bandwidth: '', max_ping: '0', polls_disable: '0', whitelist: '', blacklist: '' },
      rating: { class: '' }, polls: { disable_during_races: '0' },
      event: { name: '', tracks_shuffle: '', allowed_bikes: '' },
      race: { open_practice: '0', quick_race: '0', format: '0', practice_length: '10', prequalify_length: '0', qualifypractice_length: '5', warmup_length: '2', sighting_lap: '1', race_length_format: '1', race_length: '50', race_minutes: '10', race_extralaps: '2', race_laps: '10', restart_delay: '300' },
      weather: { realistic: '0', conditions: '0', temperature: '20', wind_direction: '0', wind_speed: '0', track_conditions: '0' },
      deformation: { scale: '1', auto_reset: '1' }, dynamicsurface: { disable: '0', persistent: '0' },
      hardcore: { force_cockpit: '0', no_aids: '0', limited_tyre_sets: '0' },
      collisions: { disable: '0', max_ping: '0' }, reset: { type: '3', time: '5000' },
      live: { enable: '', port: '0', password: '', file: '', track_position: '0', contacts: '' },
      remote_admin: { enable: '0', port: '0', password: '' },
      export: { results: '', directory: '', units: '0', prefix: '', incremental: '0', contacts: '' },
      replay: { save: '0', directory: '', prefix: '' },
    },
  };
}

S.host = { cfg: null, open: 'server', status: null, showAdvanced: false, mode: 'game' };

// Read the in-game Host screen's current settings from the profile into cfg.
async function loadFromProfile(cfg) {
  const st = await api.invoke('game:settings').catch(() => null);
  const ui = (st && st.values && st.values.ui) || {};
  for (const [k, pk] of Object.entries(GAME_KEYS)) {
    if (ui[pk] === undefined) continue;
    const [sec, key] = k.split('|');
    let v = ui[pk];
    if (/^-?\d+\.\d+$/.test(v)) v = String(Math.round(Number(v) * 100) / 100);
    cfg.sections[sec][key] = v;
  }
  if (ui.race_track) cfg.tracks = [{ track: ui.race_track, layout: ui.race_track_layout || '' }, ...cfg.tracks.slice(1)];
  // Classes this game has (mod bikes add their own, like E10 250 or MX1), offered next to the OEM ones.
  S.host.gameClasses = [...new Set([...Object.keys((st && st.values && st.values.category) || {}), ...String(ui.race_class || '').split('/')].map((x) => x.trim()).filter(Boolean))];
  const classes = ui.race_class ?? ui.race_category;
  if (classes) cfg.categories = classes.split('/').map((x) => x.trim()).filter(Boolean);
}

async function renderHost(c) {
  if (!S.host.cfg) {
    const saved = await api.invoke('host:get');
    const d = defaultHost();
    S.host.cfg = saved ? { ...d, ...saved, sections: Object.fromEntries(Object.keys(d.sections).map((k) => [k, { ...d.sections[k], ...((saved.sections || {})[k] || {}) }])) } : d;
    if (saved && saved.mode) S.host.mode = saved.mode;
    if (S.host.mode === 'game') await loadFromProfile(S.host.cfg);
  }
  S.host.status = await api.invoke('host:status').catch(() => ({ running: false }));
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>Online</h2>${onlineTabs()}</div>
    <div class="scroller"><div style="max-width:960px" id="hostBody"></div></div></div></div>`;
  drawHost();
}

function hostModeHtml() {
  const t = (id, title, description, glyph) => `<button class="host-mode-card ${S.host.mode === id ? 'active' : ''}" data-hmode="${id}" aria-pressed="${S.host.mode === id}">${icon(glyph)}<span><b>${title}</b><small>${description}</small></span>${S.host.mode === id ? icon('check') : ''}</button>`;
  return `<div class="host-mode">${t('game', 'Ride with friends', 'Host from your game and ride together.', 'rider')}${t('dedicated', 'Run a dedicated server', 'Keep a separate server running on this PC.', 'globe')}</div>`;
}

function hostStatusHtml() {
  if (S.host.mode === 'game') {
    const ready = S.host.cfg.sections.connection.name.trim() && S.host.cfg.tracks[0]?.track;
    return `<div class="host-launch"><div><b>${S.host.prepared ? 'Your setup is saved' : 'Ready to ride?'}</b><p>${S.host.prepared ? 'In MX Bikes, choose Multiplayer → Host, then press Start.' : 'Save this setup, then start hosting from Multiplayer → Host in MX Bikes.'}</p><span class="muted">Friends find you by your server name.</span></div><button class="btn btn-primary" data-act="host-game" ${ready ? '' : 'disabled'}>${icon('play')}Save &amp; open MX Bikes</button></div>`;
  }
  const st = S.host.status || {};
  if (st.running) {
    return `<div class="host-status on"><div class="host-dot"></div><div style="flex:1"><b>Your server is running</b> on port ${st.port}<div class="muted" style="font-size:12.5px">Started ${esc(window.timeAgo(st.startedAt))}. To join it on this PC, use <span class="mono">127.0.0.1:${st.port}</span>. Friends join with your public IP and this port (forward UDP ${st.port} on your router).</div></div>
      <button class="btn" data-act="host-join-own">${icon('play')}Join it</button><button class="btn btn-danger" data-act="host-stop">${icon('power')}Stop</button></div>
      ${st.log ? `<div class="section-title">Server log</div><pre class="host-log">${esc(st.log)}</pre>` : ''}`;
  }
  return `<div class="host-status"><div class="host-dot off"></div><div style="flex:1"><b>Server is off</b><div class="muted" style="font-size:12.5px">Set it up below, then start it. It runs as the game's own dedicated server in its own window.</div></div>
    <button class="btn" data-act="host-preview">${icon('list')}View config</button><button class="btn btn-primary" data-act="host-start">${icon('play')}Start server</button></div>`;
}

function fieldHtml(f, cfg) {
  if (S.host.mode === 'game' && !inGameField(f)) return '';
  if (f.show && !f.show(cfg.sections)) return '';
  if (f.advanced && !S.host.showAdvanced) return '';
  const v = (cfg.sections[f.sec] || {})[f.key] ?? '';
  const id = `hf-${f.sec}-${f.key}`;
  let ctl;
  if (f.type === 'toggle') ctl = `<label class="toggle"><input type="checkbox" id="${id}" data-hf="${f.sec}|${f.key}" ${String(v) === '1' ? 'checked' : ''}><span class="sw"></span></label>`;
  else if (f.type === 'select') ctl = `<select id="${id}" data-hf="${f.sec}|${f.key}">${f.opts.map(([ov, l]) => `<option value="${esc(ov)}" ${String(v) === ov ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.type === 'number') ctl = `<input class="input host-num" type="number" id="${id}" data-hf="${f.sec}|${f.key}" value="${esc(v)}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 1}">`;
  else ctl = `<input class="input host-txt" type="${f.secret ? 'password' : 'text'}" id="${id}" data-hf="${f.sec}|${f.key}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" spellcheck="false">`;
  return `<div class="gs-row"><span>${esc(f.label)}${f.hint ? `<br><span class="muted" style="font-size:12px">${esc(f.hint)}</span>` : ''}</span>${ctl}</div>`;
}

function tracksHtml(cfg) {
  const tracks = S.items.filter((i) => i.group === 'tracks' && !i.disabled && i.kind !== 'archive' && i.sub !== '(loose)' && !i.duplicateOf)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  const layoutsFor = (name) => { const t = tracks.find((x) => x.name === name); return t && t.info && t.info.layoutNames ? t.info.layoutNames : []; };
  const game = S.host.mode === 'game';
  const list = game ? cfg.tracks.slice(0, 1) : cfg.tracks;
  return `<div class="gs-row" style="align-items:flex-start"><span>${game ? 'Track' : 'Tracks'}<br><span class="muted" style="font-size:12px">${game ? 'The track your server starts on' : 'Up to 10 — the server moves to the next one at each restart'}</span></span>
    <div class="host-tracks">${list.map((t, i) => {
      const lays = layoutsFor(t.track);
      const it = tracks.find((x) => x.name === t.track);
      return `<div class="host-track"><span class="muted">${i + 1}</span>
        <button class="host-track-pick" data-htp="${i}" title="Choose a track">
          <span class="thumb host-track-img">${it ? thumbHtml(it) : `<span class="ph"><span class="ph-icon">${icon('track')}</span></span>`}</span>
          <span class="host-track-txt"><b>${it ? esc(it.title) : t.track ? esc(t.track) : 'Choose a track'}</b><span class="muted">${it ? (it.stock ? 'Comes with MX Bikes' : esc([it.label, it.info && it.info.author].filter(Boolean).join(' · ') || 'Installed')) : t.track ? 'Not installed' : 'Pick from your tracks'}</span></span>
          <span class="btn btn-sm">Change</span></button>
        ${lays.length ? `<select data-htl="${i}"><option value="">Main layout</option>${lays.map((l) => `<option ${l === t.layout ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}
        ${!game && cfg.tracks.length > 1 ? `<button class="btn btn-sm btn-ghost btn-icon" data-htx="${i}" title="Remove">${icon('x')}</button>` : ''}</div>`;
    }).join('')}
    ${!game && cfg.tracks.length < 10 ? `<button class="btn btn-sm" data-act="host-add-track">+ Add track</button>` : ''}</div></div>`;
}

function categoriesHtml(cfg) {
  const all = [...new Set([...CATEGORIES, ...(S.host.mode === 'game' ? S.host.gameClasses || [] : []), ...cfg.categories])];
  return `<div class="gs-row" style="align-items:flex-start"><span>Bike classes<br><span class="muted" style="font-size:12px">${S.host.mode === 'game' ? 'None selected = keeps the classes chosen in MX Bikes' : 'None selected = open to every bike'}. Fewer classes = less join lag</span></span>
    <div class="host-cats">${all.map((c) => `<button class="chip ${cfg.categories.includes(c) ? 'active' : ''}" data-hc="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>`;
}

function drawHost() {
  const body = $('#hostBody');
  if (!body) return;
  const cfg = S.host.cfg;
  const groups = HOST_GROUPS.filter((g) => S.host.mode !== 'game' || g.fields.some(inGameField));
  const quickField = (sec, key) => fieldHtml(HOST_GROUPS.flatMap((g) => g.fields).find((f) => f.sec === sec && f.key === key), cfg);
  const preset = cfg.sections.race.open_practice === '1' ? 'practice' : cfg.sections.race.quick_race === '1' ? 'race' : 'custom';
  body.innerHTML = `${hostModeHtml()}
    <div class="host-quick"><div class="host-step-title"><span>1</span><div><h3>Choose where to ride</h3><p>Pick an installed track and the bike classes your friends can use.</p></div></div>${tracksHtml(cfg)}${categoriesHtml(cfg)}</div>
    <div class="host-quick"><div class="host-step-title"><span>2</span><div><h3>Make it yours</h3><p>Your friends will look for this name in the server list.</p></div></div>${quickField('connection', 'name')}${quickField('connection', 'maxclient')}</div>
    <div class="host-quick"><div class="host-step-title"><span>3</span><div><h3>Choose the session</h3><p>Start with a preset, or adjust the options below.</p></div></div><div class="host-presets">${[['practice', 'Just practice', 'Ride freely with no qualifying or races.'], ['race', 'Quick race', 'Warm up, then race for 10 minutes + 2 laps.'], ['custom', 'Custom event', 'Set up practice, qualifying, and race sessions.']].map(([id, title, hint]) => `<button class="host-preset ${preset === id ? 'active' : ''}" data-host-preset="${id}" aria-pressed="${preset === id}"><b>${title}</b><span>${hint}</span></button>`).join('')}</div></div>
    ${hostStatusHtml()}<div class="section-title">Optional settings <span class="muted">Your saved options are kept</span></div>
    ${S.host.mode === 'dedicated' ? `<div class="gs-row glist" style="margin:14px 0"><span>Server port<br><span class="muted" style="font-size:12px">Use something other than 54210 so you can also play on this PC</span></span>
      <input class="input host-num" type="number" id="hostPort" value="${esc(cfg.port)}" min="1024" max="65535"></div>` : '<div style="height:14px"></div>'}
    ${groups.filter((g) => g.fields.some((f) => f.type !== 'tracks' && f.type !== 'categories' && !['name', 'maxclient'].includes(f.key) && (S.host.mode !== 'game' || inGameField(f)))).map((g) => `<div class="host-group ${S.host.open === g.id ? 'open' : ''}">
      <button class="host-group-h" data-hg="${g.id}">${icon(g.icon)}<span>${esc(g.title)}</span>${icon('chevdown')}</button>
      ${S.host.open === g.id ? `<div class="glist">${g.fields.filter((f) => f.type !== 'tracks' && f.type !== 'categories' && !(f.sec === 'connection' && ['name', 'maxclient'].includes(f.key))).map((f) => fieldHtml(f, cfg)).join('')}</div>` : ''}</div>`).join('')}
    ${S.host.mode === 'dedicated' ? `<label class="mini-toggle" style="margin:12px 4px"><input type="checkbox" id="hostAdv" ${S.host.showAdvanced ? 'checked' : ''}> Show advanced options</label>`
      : ''}`;
}

// Write the in-game Host screen's settings into the profile, then open the game.
async function setupInGameHost() {
  if (await confirmRiderBeforeGame('launch') === 'cancel') return false;
  const cfg = readCfg();
  const values = [];
  for (const [k, pk] of Object.entries(GAME_KEYS)) {
    const [sec, key] = k.split('|');
    const v = (cfg.sections[sec] || {})[key];
    if (v === undefined || v === null || v === '') continue;
    values.push(['ui', pk, pk === 'race_track_conditions' ? Number(v).toFixed(6) : String(v)]);
  }
  const t = cfg.tracks[0] || {};
  if (t.track) { values.push(['ui', 'race_track', t.track]); values.push(['ui', 'race_track_layout', t.layout || '']); }
  // The game's race and host screens read the bike classes from race_class (older versions used
  // race_category, which current MX Bikes no longer reads: both are written).
  // None picked: the game's own choice is left as it is.
  if (cfg.categories.length) { values.push(['ui', 'race_class', cfg.categories.join('/')]); values.push(['ui', 'race_category', cfg.categories.join('/')]); }
  await api.invoke('game:setValues', values);
  await api.invoke('game:launch');
  return true;
}

const saveHost = debounce(() => api.invoke('host:save', S.host.cfg), 400);
function readCfg() {
  const cfg = S.host.cfg;
  cfg.sections.event.category = cfg.categories.join('/');
  return cfg;
}

document.addEventListener('change', (e) => {
  if (!$('#hostBody') || !e.target.closest('#hostBody')) return;
  const cfg = S.host.cfg;
  const t = e.target;
  if (t.id === 'hostAdv') { S.host.showAdvanced = t.checked; drawHost(); return; }
  if (t.id === 'hostPort') { cfg.port = Number(t.value) || 54215; saveHost(); return; }
  if (t.dataset.hf) {
    const [sec, key] = t.dataset.hf.split('|');
    cfg.sections[sec] = cfg.sections[sec] || {};
    cfg.sections[sec][key] = t.type === 'checkbox' ? (t.checked ? '1' : '0') : t.value;
    saveHost();
    S.host.prepared = false;
    drawHost();
    return;
  }
  if (t.dataset.ht != null) { cfg.tracks[Number(t.dataset.ht)] = { track: t.value, layout: '' }; saveHost(); drawHost(); return; }
  if (t.dataset.htl != null) { cfg.tracks[Number(t.dataset.htl)].layout = t.value; saveHost(); }
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#hostBody')) return;
  const cfg = S.host.cfg;
  const preset = e.target.closest('[data-host-preset]');
  if (preset) {
    const id = preset.dataset.hostPreset, race = cfg.sections.race;
    race.open_practice = id === 'practice' ? '1' : '0'; race.quick_race = id === 'race' ? '1' : '0';
    if (id === 'race') Object.assign(race, { warmup_length: '2', race_length_format: '1', race_minutes: '10', race_extralaps: '2', sighting_lap: '0' });
    if (id === 'custom') S.host.open = 'race';
    S.host.prepared = false; saveHost(); drawHost(); return;
  }
  const g = e.target.closest('[data-hg]');
  if (g) { S.host.open = S.host.open === g.dataset.hg ? null : g.dataset.hg; drawHost(); return; }
  const hc = e.target.closest('[data-hc]');
  if (hc) { const c = hc.dataset.hc; cfg.categories = cfg.categories.includes(c) ? cfg.categories.filter((x) => x !== c) : [...cfg.categories, c]; saveHost(); drawHost(); return; }
  const hx = e.target.closest('[data-htx]');
  if (hx) { cfg.tracks.splice(Number(hx.dataset.htx), 1); saveHost(); drawHost(); return; }
  const hm = e.target.closest('[data-hmode]');
  if (hm) {
    S.host.mode = hm.dataset.hmode; cfg.mode = S.host.mode;
    if (S.host.mode === 'game') await loadFromProfile(cfg);
    saveHost(); drawHost(); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'host-game') {
    a.disabled = true;
    try { if (await setupInGameHost()) { S.host.prepared = true; drawHost(); toast('Settings saved — in MX Bikes open Multiplayer → Host and press Start', 'ok', 7000); } }
    catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
    a.disabled = false;
    return;
  }
  if (a.dataset.act === 'host-add-track') { cfg.tracks.push({ track: '', layout: '' }); drawHost(); return; }
  if (a.dataset.act === 'host-preview') {
    const ini = await api.invoke('host:preview', readCfg());
    modal({ title: 'Server config', size: 'md', body: `<div class="muted" style="margin-bottom:10px;font-size:13px">This is the file the app gives the game (<span class="mono">mxbm_server.ini</span> in your game folder).</div><pre class="host-log">${esc(ini)}</pre>` });
    return;
  }
  if (a.dataset.act === 'host-start') {
    a.disabled = true; a.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>Starting…';
    try { S.host.status = await api.invoke('host:start', readCfg()); toast('Server starting — it opens in its own window', 'ok', 3500); }
    catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
    drawHost(); pollHost();
    return;
  }
  if (a.dataset.act === 'host-stop') {
    if (!(await confirmBox('Stop server', 'Stop your server? Anyone riding on it is disconnected.', 'Stop', true))) return;
    await api.invoke('host:stop'); setTimeout(async () => { S.host.status = await api.invoke('host:status'); drawHost(); }, 800);
    return;
  }
  if (a.dataset.act === 'host-join-own') {
    try { if (await confirmRiderBeforeGame('join') === 'cancel') return; await api.invoke('game:join', `127.0.0.1:${S.host.status.port}`); toast('Joining your server…', 'ok'); }
    catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
  }
});

// Refresh status + log while the Host tab is open and the server runs
let hostTimer = null;
function pollHost() {
  clearTimeout(hostTimer);
  hostTimer = setTimeout(async () => {
    if (S.view !== 'online' || S.onlineTab !== 'host') return;
    S.host.status = await api.invoke('host:status').catch(() => S.host.status);
    const open = document.activeElement && document.activeElement.closest && document.activeElement.closest('#hostBody');
    if (!open) drawHost();
    if (S.host.status && S.host.status.running) pollHost();
  }, 3000);
}
api.on('host:status', async (s) => {
  if (s && s.exited) toast(`Your server stopped${s.code ? ` (code ${s.code})` : ''}`, s.code ? 'err' : 'info', 4000);
  S.host.status = await api.invoke('host:status').catch(() => null);
  if (S.view === 'online' && S.onlineTab === 'host') drawHost();
});

// Track picker with pictures (same grid as Ride / the shop).
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-htp]');
  if (!b || !$('#hostBody')) return;
  const i = Number(b.dataset.htp);
  const cfg = S.host.cfg;
  gridPicker({
    title: 'Choose a track', current: (cfg.tracks[i] || {}).track,
    items: S.items.filter((x) => x.group === 'tracks' && !x.disabled && x.kind !== 'archive' && x.sub !== '(loose)' && !x.duplicateOf),
    meta: (x) => (x.stock ? 'Comes with MX Bikes' : [x.label, x.info && x.info.author].filter(Boolean).join(' · ')),
    onPick: (v) => { cfg.tracks[i] = { track: v, layout: '' }; saveHost(); drawHost(); },
  });
});
