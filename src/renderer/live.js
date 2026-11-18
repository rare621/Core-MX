/* global S, $, esc, icon, toast, modal, confirmBox, cleanErr, api, timeAgo, trackInstalled, findTrack, joinServer, onlineTabs, renderOnline, refreshAccounts */
'use strict';
// ---------- Live online data: the game plugin + your online service ----------
// Servers tab: "Live servers" (with tracks and riders). Friends tab: where friends are, join them.
S.live = { status: null, servers: null, serversErr: null, friends: null, friendsErr: null };

// Render/status events are frequent during file sync. Fetch lists on a clock,
// sharing any in-flight request and leaving time to recover after a failure.
async function refreshLiveList(kind, force = false) {
  const requestKey = `${kind}Request`, nextKey = `${kind}Next`, errorKey = `${kind}Err`;
  if (S.live[requestKey]) return S.live[requestKey];
  if (Date.now() < (S.live[nextKey] || 0) && (!force || S.live[errorKey])) return false;
  S.live[`${kind}Last`] = Date.now();
  S.live[requestKey] = (async () => {
    try {
      S.live[kind] = await api.invoke(`online:${kind}`, force);
      S.live[errorKey] = null;
      S.live[nextKey] = Date.now() + (kind === 'servers' ? 60000 : 15000);
    } catch (e) {
      S.live[errorKey] = cleanErr(e);
      S.live[nextKey] = Date.now() + 30000;
    }
    return true;
  })();
  try { return await S.live[requestKey]; }
  finally { S.live[requestKey] = null; }
}

async function liveStatus(refresh) {
  if (!S.live.status || refresh) S.live.status = await api.invoke(refresh ? 'online:refresh' : 'online:status').catch(() => null);
  return S.live.status;
}
api.on('online:status', (st) => {
  const previous = S.live.status;
  S.live.status = st;
  const activeCount = $('#activeUsersCount span');
  if (activeCount) activeCount.textContent = Number.isInteger(st?.service?.activeUsers) ? `${st.service.activeUsers} online` : 'Online —';
  if (S.friendDialog) S.friendDialog.progress();
  if (st?.paintSync?.at && st.paintSync.at !== previous?.paintSync?.at && !st.paintSync.busy) S.friendDialog?.refresh();
  const key = (s) => JSON.stringify([s?.service, s?.plugin, s?.paintSync?.enabled, s?.paintSync?.error, s?.paintSync?.at, s?.paintSync?.friends]);
  if (S.friendsPanel?.body && key(previous) !== key(st)) renderFriends(S.friendsPanel.body);
  const overlay = $('#friendsSyncOverlay'); if (overlay) overlay.innerHTML = friendProgressHtml();
  if (S.view !== 'online' && S.view !== 'friends') return;
  if (S.view === 'friends') { if (key(previous) !== key(st)) renderFriends($('#content')); return; }
  if (S.onlineTab === 'servers') { drawYouAreOn(); drawLiveServers(); }
  if (S.onlineTab === 'friends' || S.view === 'friends') {
    if (key(previous) !== key(st)) renderFriends($('#content'));
    else { const overlay = $('#friendsSyncOverlay'); if (overlay) overlay.innerHTML = friendProgressHtml(); }
  }
});

const SESSION_NAMES = ['Waiting', 'Practice', 'Pre-qualifying', 'Qualifying practice', 'Qualifying', 'Warmup', 'Race 1', 'Race 2'];
const sessionLabel = (s) => Number.isInteger(s?.session) && SESSION_NAMES[s.session] ? SESSION_NAMES[s.session] : '';
const trackLabel = (s) => s.trackName || s.trackId || '';
const trackHave = (s) => !!(trackInstalled(s.trackName || '') || trackInstalled(s.trackId || ''));

// Card that sets things up: plugin, then service. Shown until both are done; collapses to a status line after.
function setupCardHtml(st, where) {
  if (!st) return '';
  const p = st.plugin, sv = st.service;
  const pluginRow = p.needsUpdate
    ? `<div class="live-step"><span style="color:var(--warn)">${icon('alert')}</span><div><b>Game plugin update required</b><div class="muted">The installed plugin is older than this app. Close MX Bikes, update the plugin, then reopen the game to report server sessions.</div></div><button class="btn btn-sm btn-primary" data-act="live-plugin-install">Update plugin</button></div>`
    : p.installed
    ? `<div class="live-step done">${icon('check')}<div><b>Game plugin installed</b><div class="muted">Tells the app which server and track you're on. ${st.game.running ? '' : 'It starts with MX Bikes.'}</div></div><button class="btn btn-sm btn-ghost" data-act="live-plugin-remove">Remove</button></div>`
    : `<div class="live-step">${icon('download')}<div><b>Install the game plugin</b><div class="muted">A small plugin using MX Bikes' official plugin system. It only reads the server name, track and rider list and saves them for this app — no game changes, no network.</div></div>
        ${p.available ? `<button class="btn btn-sm btn-primary" data-act="live-plugin-install">Install</button>` : '<span class="muted" style="font-size:12px">Not built yet</span>'}</div>`;
  const svcRow = sv.connected
    ? `<div class="live-step done">${icon('check')}<div><b>Online${sv.name ? ` as ${esc(sv.name)}` : ''}</b>${sv.error ? `<div style="color:var(--warn)">${esc(sv.error)}</div>` : '<div class="muted">Signed in with your Steam account.</div>'}</div><button class="btn btn-sm btn-ghost" data-act="live-disconnect">Go offline</button></div>`
    : sv.defaultUrl
      ? `<div class="live-step">${icon('globe')}<div style="flex:1"><b>Online features</b><div class="muted">${sv.error ? `<span style="color:var(--warn)">Couldn't reach the online service — it may be offline right now.</span>` : 'Signing in with your Steam account…'}</div></div>
          <button class="btn btn-sm btn-primary" data-act="live-connect">${sv.error ? 'Try again' : 'Go online'}</button></div>`
      : `<div class="live-step">${icon('globe')}<div style="flex:1"><b>Online features aren't set up</b><div class="muted">This copy of the app has no online service built in.</div></div></div>`;
  if (p.installed && !p.needsUpdate && sv.connected && !sv.error && where !== 'friends') return '';
  return `<div class="set-card live-setup"><h3>Live servers & friends</h3>${pluginRow}${svcRow}</div>`;
}

// "You're on <server> · <track>" while the plugin reports a session.
function drawYouAreOn() {
  const box = $('#youAreOn');
  if (!box) return;
  const st = S.live.status, pr = st && st.presence;
  if (!pr || !pr.inEvent) { box.innerHTML = ''; return; }
  const online = !!pr.server;
  box.innerHTML = `<div class="set-card live-now"><div class="live-dot"></div><div style="flex:1">
      <b>${online ? `You're on ${esc(pr.server)}` : 'In a session (the server name appears once you ride out)'}</b>
      <div class="muted">${esc(pr.trackName || pr.trackId)} · ${esc(pr.bikeName || '')}${pr.riders && pr.riders.length > 1 ? ` · ${pr.riders.length} riders` : ''}${pr.session != null && SESSION_NAMES[pr.session] && pr.type === 2 ? ` · ${SESSION_NAMES[pr.session]}` : ''}</div></div>
    ${online && pr.serverAddress ? `<button class="btn btn-sm" data-act="live-copy-link" data-addr="${esc(pr.serverAddress)}">${icon('copy')}Copy join link</button>` : ''}</div>`;
}

// Friends who are on a server right now, with a one-click Join.
function drawFriendsRiding() {
  const box = $('#friendsRiding'); if (!box) return;
  const live = new Map((S.live.friends || []).map((l) => [l.id, l]));
  const riding = (S.friends || []).map((f, i) => ({ f, i, l: live.get(f.code) })).filter(({ l }) => l && l.status === 'ok' && l.online && (l.server || l.inEvent));
  box.innerHTML = `<div class="section-title">Friends riding now</div>${riding.length ? `<div class="ride-friends">${riding.map(({ f, i, l }) => `<div class="ride-friend"><span class="fr-av">${esc((f.name || '?').slice(0, 1).toUpperCase())}<span class="fr-dot ride"></span></span>
    <div class="rf-txt"><b>${esc(f.name)}</b><small>${esc(l.server || 'In a session · server shows once on track')}${l.trackName ? ` · ${esc(l.trackName)}` : ''}</small></div>
    ${l.server && l.address ? `<button class="btn btn-sm btn-primary" data-friend-join="${i}">${icon('play')}Join</button>` : ''}</div>`).join('')}</div>`
    : `<div class="side-empty">${icon('users')}<span>${(S.friends || []).length ? 'None of your friends are riding right now.' : 'Add friends to see where they ride.'}</span><button class="btn btn-sm" data-view="friends">Friends</button></div>`}`;
}
document.addEventListener('click', (e) => { const b = e.target.closest('#friendsRiding [data-view]'); if (b) go(b.dataset.view); });
async function drawLiveServers(refresh) {
  const box = $('#allServers');
  if (!box) return;
  const st = await liveStatus();
  const meta = $('#allSrvMeta');
  const setup = setupCardHtml(st, 'servers');
  if (!st || !st.service.connected) { box.innerHTML = setup; if (meta) meta.textContent = ''; return; }
  await refreshLiveList('servers', refresh);
  if (!$('#allServers')) return;
  if (S.live.serversErr) { box.innerHTML = setup + `<div class="notice danger">${icon('alert')}<div>${esc(S.live.serversErr)}</div></div>`; return; }
  const all = S.live.servers?.servers || [];
  S.allSrv.filters ||= { population: 'all', maxPing: '', sort: 'activity' };
  const filters = S.allSrv.filters;
  const q = (S.allSrv.q || '').toLowerCase();
  let xs = all.filter((s) => {
    if (q && !`${s.name} ${trackLabel(s)} ${s.categories.join(' ')}`.toLowerCase().includes(q)) return false;
    const count = s.riders.length, capacity = Number(s.capacity || s.maxPlayers) || 0;
    if (filters.population === 'empty' && count || filters.population === 'populated' && !count || filters.population === 'full' && (!capacity || count < capacity) || filters.population === 'available' && capacity && count >= capacity) return false;
    return !filters.maxPing || s.ping != null && s.ping <= Number(filters.maxPing);
  });
  if (filters.sort === 'ping') xs.sort((a, b) => (a.ping ?? Infinity) - (b.ping ?? Infinity));
  if (meta) meta.innerHTML = `${all.length} live · updated ${esc(timeAgo(S.live.servers?.at))}`;
  box.innerHTML = `${setup}<div class="filters" style="padding:0 0 12px"><div class="search wide">${icon('search')}<input id="allSrvQ" placeholder="Search by server, track or class…" value="${esc(S.allSrv.q || '')}" spellcheck="false"></div>
      <select class="input" data-server-filter="population" aria-label="Server population">${[['all', 'All servers'], ['populated', 'Not empty'], ['empty', 'Empty'], ['available', 'Hide full'], ['full', 'Full only']].map(([v, label]) => `<option value="${v}" ${filters.population === v ? 'selected' : ''}>${label}</option>`).join('')}</select><select class="input" data-server-filter="maxPing" aria-label="Maximum network ping">${[['', 'Any ping'], ['50', 'Under 50 ms'], ['100', 'Under 100 ms'], ['150', 'Under 150 ms'], ['250', 'Under 250 ms']].map(([v, label]) => `<option value="${v}" ${filters.maxPing === v ? 'selected' : ''}>${label}</option>`).join('')}</select><select class="input" data-server-filter="sort" aria-label="Server order"><option value="activity" ${filters.sort === 'activity' ? 'selected' : ''}>Activity</option><option value="ping" ${filters.sort === 'ping' ? 'selected' : ''}>Lowest ping</option></select><span class="count">${xs.length} shown</span>
      <button class="btn btn-icon" data-act="live-refresh" title="Reload">${icon('refresh')}</button></div>
    <p class="muted" style="font-size:12px">Only servers that currently have an CoreMX user on them are listed here.</p><div class="srv-list">${xs.map((s, i) => {
      const have = trackHave(s);
      const tl = trackLabel(s);
      const cap = Number(s.capacity || s.maxPlayers) || 0, pingTone = s.ping == null ? '' : s.ping < 80 ? 'good' : s.ping < 150 ? 'ok' : 'bad';
      return `<div class="srv live-srv" data-live-open="${all.indexOf(s)}" style="cursor:pointer"><div class="srv-pop ${s.riders.length ? 'busy' : ''}"><b>${s.riders.length}</b><small>${cap ? '/' + cap : 'riders'}</small></div>${pingTone ? `<span class="ping-dot ${pingTone}" title="${s.ping} ms"></span>` : ''}
        <div class="srv-txt"><div class="t">${esc(s.name)}${s.hosted ? `<span class="home-host" title="${s.addressObserved ? 'A rider who joined this World reported the game endpoint. Direct Join still depends on the host being reachable.' : 'This address is estimated from the host connection and game port. Direct Join may time out.'}">Home host · ${s.addressObserved ? 'address observed' : 'address estimated'}</span>` : ''}</div>
          <div class="m">${tl ? (have ? `<span style="color:var(--ok)">${icon('check')} ${esc(tl)}</span>` : `<span style="color:var(--warn)">${icon('alert')} ${esc(tl)} — not installed</span>`) : '<span class="muted">Track unknown</span>'}
          ${sessionLabel(s) ? ` · <b>${esc(sessionLabel(s))}</b>` : ''} · ${icon('user')} ${s.riders.length}${s.capacity || s.maxPlayers ? '/' + Number(s.capacity || s.maxPlayers) : ''} · ${s.ping == null ? 'Ping unknown' : `${s.ping} ms`}${s.categories.length ? ` · ${esc(s.categories.slice(0, 3).join(', '))}` : ''} · <span class="muted">${esc(timeAgo(s.lastSeen))}</span></div></div>
        <div class="jactions">${tl && !have ? `<button class="btn btn-sm" data-live-find="${all.indexOf(s)}">${icon('search')}Get track</button>` : ''}
          ${s.address ? `<button class="btn btn-sm btn-primary" data-live-join="${all.indexOf(s)}">${icon('play')}Join</button>` : `<button class="btn btn-sm" data-live-address="${all.indexOf(s)}" title="MX Bikes does not expose server IP addresses to plugins">${icon('settings')}Set address</button>`}</div></div>`;
    }).join('') || `<div class="set-card muted" style="text-align:center;padding:28px">No live servers yet. Servers appear here as soon as anyone using the app (with the plugin) rides on one.</div>`}</div>`;
  const qi = $('#allSrvQ');
  $$('[data-server-filter]', box).forEach((select) => select.addEventListener('change', () => { S.allSrv.filters[select.dataset.serverFilter] = select.value; drawLiveServers(); }));
  drawFriendsRiding();
  if (qi) qi.addEventListener('input', () => { S.allSrv.q = qi.value; clearTimeout(drawLiveServers.t); drawLiveServers.t = setTimeout(() => drawLiveServers().then(() => { const n = $('#allSrvQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }), 200); });
}

// Joining a live server: if other app users are riding there (their plugin reports it, or
// their Steam name is on the server's rider list), offer to download their free gear first
// so their bikes and outfits show up in game. Then the usual track check and join.
async function joinLiveServer(s) {
  const join = () => {
    // Home-hosted (Host World) servers are often only reachable through the in-game browser.
    if (s.hosted) toast(`<b>${esc(s.name)}</b> is hosted from home. If MX Bikes says <b>connection timed out</b>, join it from <b>Multiplayer → World</b> in the game instead.`, 'info', 9000);
    return joinServer(s.address, { name: s.name, address: s.address, track: trackLabel(s) });
  };
  const st = S.live.status;
  if (!st || !st.service.connected || !s.name) return join();
  toast('Checking riders on this server…', 'info', 2500);
  let riders;
  try {
    riders = await Promise.race([api.invoke('online:serverRiders', s.name), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000))]);
  } catch (e) {
    if (!/timeout/.test(e.message || '')) toast(esc(cleanErr(e)), 'info', 5000);
    return join();
  }
  const sizeOf = (r) => r.items.filter((it) => it.state === 'ready').reduce((n, it) => n + (it.size || 0), 0);
  const want = riders.filter((r) => r.items.some((it) => it.state === 'ready'));
  if (!want.length) {
    if (riders.length) toast(`You already have the gear for ${riders.length === 1 ? esc(riders[0].name) : riders.length + ' riders'} on this server`, 'ok', 2500);
    return join();
  }
  const fmt = (n) => (typeof fmtSize === 'function' ? fmtSize(n) : `${Math.round(n / 1024)} KB`);
  const row = (r, i) => {
    const ready = r.items.filter((it) => it.state === 'ready');
    const paid = (r.unavailable || []).filter((u) => /paid|store-protected|account-bound/i.test(u.error || '')).length;
    const needs = [...new Map(r.items.flatMap((it) => it.needs || []).map((n) => [`${n.kind}|${n.name}`, n])).values()];
    return `<label class="sr-row"><input type="checkbox" data-sr="${i}" checked><span class="fr-av">${esc((r.name || '?').slice(0, 1).toUpperCase())}</span>
      <span class="sr-txt"><b>${esc(r.name)}</b><small>${ready.length} file${ready.length === 1 ? '' : 's'} · ${fmt(sizeOf(r))}${r.bikeName || r.bike ? ` · ${esc(prettyBikeId(r.bikeName || r.bike))}` : ''}</small>
      ${needs.length ? `<small class="sr-warn">Needs ${needs.map((n) => esc(n.name.replace(/_/g, ' '))).join(', ')} to show fully</small>` : ''}${paid ? `<small class="muted">${paid} paid item${paid > 1 ? 's' : ''} not shared</small>` : ''}</span>
      <span class="sr-via" title="${r.via === 'name' ? 'Their Steam name matches a rider on this server' : 'Their game plugin reports this server'}">${r.via === 'name' ? 'Name match' : 'On server'}</span></label>`;
  };
  const m = modal({
    title: `Riders on ${esc(s.name)}`, size: 'sm',
    body: `<p class="muted" style="margin-top:0">${want.length === 1 ? 'A rider' : `${want.length} riders`} on this server use${want.length === 1 ? 's' : ''} CoreMX. Download their gear so you see their bikes and outfits in game? Your own outfit stays as it is.</p><div class="sr-list">${want.map(row).join('')}</div><div class="sr-progress muted" hidden></div>`,
    foot: `<button class="btn" data-sr-skip>Join without gear</button><span class="grow"></span><button class="btn btn-primary" data-sr-go>${icon('download')}Download & join</button>`,
  });
  $('[data-sr-skip]', m).addEventListener('click', () => { m.close(); join(); });
  $('[data-sr-go]', m).addEventListener('click', async (e) => {
    const ids = $$('[data-sr]', m).filter((c) => c.checked).map((c) => want[Number(c.dataset.sr)].id);
    if (!ids.length) { m.close(); return join(); }
    e.target.disabled = true; $('[data-sr-skip]', m).disabled = true;
    const p = $('.sr-progress', m); p.hidden = false; p.innerHTML = '<div class="spinner"></div> Downloading gear…';
    try {
      const results = await api.invoke('online:syncServerRiders', s.name, ids);
      const got = results.reduce((n, r) => n + r.items.filter((it) => it.state === 'downloaded').length, 0);
      const failed = results.reduce((n, r) => n + r.items.filter((it) => it.state === 'failed').length, 0);
      toast(`Downloaded ${got} file${got === 1 ? '' : 's'}${failed ? ` · ${failed} couldn't be downloaded` : ''}`, failed ? 'info' : 'ok', 3500);
    } catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
    m.close(); join();
  });
}

function openLiveServer(s) {
  const tl = trackLabel(s), have = trackHave(s);
  let showAllRiders = false;
  const ridersBody = () => {
    const riders = s.riders || [], shown = showAllRiders ? riders : riders.slice(0, 5);
    return `<div class="muted" style="margin-bottom:12px">${tl ? `Track: <b style="color:var(--text)">${esc(tl)}</b> ${have ? `<span style="color:var(--ok)">${icon('check')} installed</span>` : `<span style="color:var(--warn)">not installed</span>`}` : 'Track unknown'}
        ${sessionLabel(s) ? ` · ${esc(sessionLabel(s))}` : ''} · seen ${esc(timeAgo(s.lastSeen))}${s.address ? ` · <span class="mono">${esc(s.address)}</span>` : ''}</div>
      <div class="section-title" style="margin-top:0">Riders (${riders.length})</div>
        <div class="srv-list">${shown.map((r) => `<div class="srv"><div class="srv-ico" style="border-radius:50%">${esc((r.coremxName || r.name || '?').slice(0, 1).toUpperCase())}</div><div class="srv-txt"><div class="t">${esc(r.coremxName || r.name)}</div><div class="m">${r.coremxName && r.coremxName !== r.name ? `MX Bikes: ${esc(r.name)} · ` : ''}${esc(r.bike)}${r.category ? ` · ${esc(r.category)}` : ''}</div></div></div>`).join('') || '<div class="srv muted">No rider list yet.</div>'}</div>
      ${riders.length > 5 ? `<button class="btn" style="margin-top:12px" data-live-riders-toggle>${showAllRiders ? 'Show fewer riders' : `Show all ${riders.length} riders`}</button>` : ''}`;
  };
  const m = modal({
    title: esc(s.name),
    body: ridersBody(),
    foot: `${tl && !have ? `<button class="btn" data-live-mfind>${icon('search')}Get track</button>` : ''}<span class="grow"></span>${s.address ? '' : `<button class="btn" data-live-maddress>${icon('settings')}Set address</button>`}<button class="btn" data-close>Close</button>
      ${s.address ? `<button class="btn btn-primary" data-live-mjoin>${icon('play')}Join</button>` : ''}`,
  });
  m.addEventListener('click', (e) => { if (e.target.closest('[data-live-riders-toggle]')) { showAllRiders = !showAllRiders; $('.modal-body', m).innerHTML = ridersBody(); } });
  const f = $('[data-live-mfind]', m); if (f) f.addEventListener('click', () => { m.close(); findTrack(tl); });
  const j = $('[data-live-mjoin]', m); if (j) j.addEventListener('click', () => { m.close(); joinLiveServer(s); });
  const address = $('[data-live-maddress]', m); if (address) address.addEventListener('click', () => { m.close(); setLiveServerAddress(s); });
}

// MX Bikes plugins deliberately receive server names but not their network
// addresses. Let a player associate an address once; it is saved locally and
// immediately makes that live listing (and future matching listings) joinable.
async function setLiveServerAddress(server) {
  const m = modal({
    title: `Set address — ${esc(server.name)}`,
    size: 'sm',
    body: `<p class="muted">MX Bikes does not give plugins a server IP address. Enter the address you use in the game browser for this server.</p><label class="field"><span>Server address</span><input id="liveServerAddress" class="input mono" placeholder="123.45.67.89:54210" style="width:100%" autocomplete="off" spellcheck="false"></label>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-live-address-save>Save address</button>',
  });
  const input = $('#liveServerAddress', m);
  const save = $('[data-live-address-save]', m);
  save.addEventListener('click', async () => {
    const address = input.value.trim();
    if (!/^[a-z0-9.-]+:\d{2,5}$/i.test(address)) { toast('Address should look like 123.45.67.89:54210', 'err'); input.focus(); return; }
    save.disabled = true;
    try {
      if (!S.servers) S.servers = await api.invoke('servers:list');
      const saved = { name: server.name, address, track: trackLabel(server), addedAt: Date.now() };
      const at = S.servers.findIndex((row) => String(row.name || '').trim().toLowerCase() === String(server.name || '').trim().toLowerCase());
      if (at >= 0) S.servers[at] = { ...S.servers[at], ...saved };
      else S.servers.push(saved);
      S.servers = await api.invoke('servers:save', S.servers);
      server.address = address;
      for (const row of S.live.servers?.servers || []) if (row.name === server.name && !row.address) row.address = address;
      m.close(); await drawLiveServers();
      toast(`Saved the address for <b>${esc(server.name)}</b>`, 'ok');
    } catch (error) { save.disabled = false; toast(esc(cleanErr(error)), 'err', 6000); }
  });
  setTimeout(() => input.focus(), 30);
}

// ---------- Friends ----------
// Layout: a slim online line, then your friends (status, join, their synced paints), then a small
// "Sharing" card. Adding friends happens in one popup (Steam friends, or a friend code).
async function renderFriends(c) {
  if (!c) return;
  if (c.id === 'content' && S.view !== 'friends') { if (S.friendsPanel?.body) await renderFriends(S.friendsPanel.body); if (S.view === 'online' && S.onlineTab === 'friends') return renderSync(c); return; }
  if (!S.friends) S.friends = await api.invoke('friends:list');
  if (!S.accounts.steam) await refreshAccounts();
  const st = await liveStatus();
  const connected = !!(st && st.service.connected);
  if (connected && Date.now() >= (S.live.friendsNext || 0) && !S.live.friendsRequest) {
    S.live.friendsLoading = true;
    refreshLiveList('friends')
      .finally(() => {
        S.live.friendsLoading = false;
        if (S.friendsPanel?.body) renderFriends(S.friendsPanel.body);
        if (S.view === 'friends') renderFriends($('#content'));
      });
  }
  const live = new Map((S.live.friends || []).map((f) => [f.id, f]));
  const paints = new Map(((st && st.paintSync && st.paintSync.friends) || []).map((f) => [f.id, f]));

  // One status per friend: [dot colour, text, sort weight]
  const statusOf = (f) => {
    if (!connected) return ['off', 'Offline — go online to see status', 3];
    const l = live.get(f.code);
    if (!l) return ['off', S.live.friendsLoading ? 'Checking…' : '—', 3];
    if (l.status === 'not-on-service') return ['off', "Hasn't installed CoreMX yet", 4];
    if (l.status === 'not-added-back') return ['wait', 'Waiting for them to add you back', 2];
    if (l.status === 'hidden' || !l.online) return ['off', l.lastSeen ? `Offline · last seen ${timeAgo(l.lastSeen)}` : 'Offline', 3];
    if (l.server) return ['ride', `Riding on ${l.server}${l.trackName || l.trackId ? ` · ${l.trackName || l.trackId}` : ''}${sessionLabel(l) ? ` · ${sessionLabel(l)}` : ''}`, 0];
    if (l.inEvent) return ['ride', `In a riding session${l.trackName ? ` · ${l.trackName}` : ''}`, 0];
    return ['on', l.inGame ? 'In MX Bikes' : 'Online in the manager', 1];
  };
  const joinable = (f) => { const l = live.get(f.code); return l && l.status === 'ok' && l.online && l.server && l.address ? l : null; };
  const paintLine = (f) => {
    const p = paints.get(f.code);
    if (!p || (!p.items.length && !(p.unavailable || []).length)) return '';
    const got = p.items.filter((it) => it.state === 'downloaded' || it.state === 'have').length;
    const need = [...new Map(p.items.flatMap((it) => it.needs).map((n) => [`${n.kind}|${n.name}`, n])).values()];
    const bike = prettyBikeId(p.bikeName || p.bike || '');
    const protectedItems = (p.unavailable || []).filter((it) => /paid|store-protected/i.test(it.error || ''));
    return `<div class="fr-loadout">${bike ? `<div class="fr-bike">${icon('bike')}<span>${esc(bike)}</span></div>` : ''}${p.items.length ? `<div class="fr-sync-state ${got === p.items.length ? 'complete' : ''}">${icon(got === p.items.length ? 'check' : 'refresh')}<span>${got} of ${p.items.length} free files synced</span></div>` : ''}
      ${paidModsSummary(protectedItems)}
      ${need.map((n) => `<button class="fr-need" data-act="paint-get" data-name="${esc(n.name)}" title="Search Get Mods for it">Needs ${esc({ bike: 'bike', helmet: 'helmet', boots: 'boots', protection: 'protector' }[n.kind] || n.kind)} ${esc(n.name.replace(/_/g, ' '))} ${icon('search')}</button>`).join('')}</div>`;
  };

  const query = (S.live.friendQuery || '').trim().toLowerCase();
  const rows = S.friends.map((f, i) => ({ f, i, s: statusOf(f) })).filter(({ f, s }) => !query || `${f.name} ${f.code} ${s[1]}`.toLowerCase().includes(query)).sort((a, b) => a.s[2] - b.s[2] || a.f.name.localeCompare(b.f.name));
  const pageSize = c.id === 'content' ? 12 : 5;
  const visible = S.live.showAllFriends ? rows : rows.slice(0, pageSize);
  const friendCard = ({ f, i, s }) => {
    const j = joinable(f);
    return `<div class="fr-row" data-friend-open="${i}"><button class="fr-av fr-open" data-friend-details="${i}" aria-label="View ${esc(f.name)}'s gear">${esc((f.name || '?').slice(0, 1).toUpperCase())}<span class="fr-dot ${s[0]}"></span></button>
      <div class="fr-txt"><div class="fr-name">${esc(f.name)}</div><div class="fr-status ${s[0]}">${esc(s[1])}</div>${paintLine(f)}</div>
      <div class="fr-act"><button class="btn btn-sm" data-friend-details="${i}">${icon('shirt')}Gear & sync</button>${j ? `<button class="btn btn-sm btn-primary" data-friend-join="${i}">${icon('play')}Join</button>` : ''}
        <button class="btn btn-sm btn-ghost btn-icon fr-remove" data-friend-remove="${i}" title="Remove ${esc(f.name)} from friends" aria-label="Remove friend ${esc(f.name)}">${icon('trash')}</button></div></div>`;
  };

  const ps = st && st.paintSync;
  const steam = S.accounts.steam || {};
  const banner = !st ? '' : !connected
    ? `<div class="fr-banner off"><span class="fr-dot off"></span><div><b>You're offline.</b> ${st.service.defaultUrl ? "Friends' status and paint sync are paused until the online service is reachable." : 'Online features are not set up in this copy of the app.'}</div>${st.service.defaultUrl ? `<button class="btn btn-sm" data-act="live-connect">Try again</button>` : ''}</div>`
    : `<div class="fr-banner on"><span class="fr-dot ride"></span><div>Online as <b>${esc(st.service.name || steam.name || '')}</b>${st.service.error ? ` · <span style="color:var(--warn)">${esc(st.service.error)}</span>` : ''}</div>
        ${ps && ps.enabled ? `<span class="muted" style="font-size:12px">${ps.busy ? 'Syncing paints…' : ps.at ? `Paints synced ${esc(timeAgo(ps.at))}` : ''}</span>` : ''}</div>`;
  const pluginTip = st && st.plugin.available && (!st.plugin.installed || st.plugin.needsUpdate)
    ? `<div class="fr-banner tip">${icon('info')}<div>${st.plugin.needsUpdate ? 'Close MX Bikes and update the game plugin to report server sessions.' : 'Install the game plugin so friends can see which server you\'re on.'}</div><button class="btn btn-sm" data-act="live-plugin-install">${st.plugin.needsUpdate ? 'Update plugin' : 'Install'}</button></div>` : '';

  // Your own card: who you are and what your friends are up to.
  const counts = { ride: rows.filter((r) => r.s[0] === 'ride').length, on: rows.filter((r) => r.s[0] === 'on').length };
  const meCard = c.id === 'content' ? `<div class="me-card"><div class="me-av">${steam.avatarData ? `<img src="${esc(steam.avatarData)}" alt="">` : icon('steam')}<span class="fr-dot ${connected ? 'ride' : 'off'}"></span></div>
    <div class="me-name">${esc(steam.name || st?.service?.name || 'You')}</div><div class="me-sub">${connected ? 'Online' : 'Offline'}</div>
    <div class="me-stats"><div><b>${S.friends.length}</b><small>Friends</small></div><div><b>${counts.ride}</b><small>Riding</small></div><div><b>${counts.on}</b><small>Online</small></div></div>
    <button class="btn btn-primary" data-act="friends-add">${icon('users')}Add friends</button></div>` : '';
  const scrollTop = $('.scroller', c)?.scrollTop || 0;
  const searchFocused = document.activeElement?.id === 'friendSearch';
  const selection = searchFocused ? document.activeElement.selectionStart : 0;
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>Friends</h2><div class="grow"></div>
      ${connected ? `<button class="btn btn-icon" data-act="live-friends-refresh" title="Refresh">${icon('refresh')}</button>` : ''}
      ${c.id === 'content' ? '' : `<button class="btn btn-primary" data-act="friends-add">${icon('user')}Add friends</button>`}</div>
    <div class="scroller"><div class="fr-page fr-layout">
      <aside class="fr-side">${meCard}${banner}${pluginTip}${S.view === 'friends' ? friendSettingsHtml(st) : ''}</aside>
      <section class="fr-main"><div class="friends-sync-overlay" id="friendsSyncOverlay">${friendProgressHtml()}</div>
      ${S.live.friendsErr ? `<div class="notice danger">${icon('alert')}<div>${esc(S.live.friendsErr)}</div></div>` : ''}
      ${S.friends.length
        ? `<div class="friends-list-toolbar"><div class="section-title">Friends · ${S.friends.length}</div><div class="search">${icon('search')}<input id="friendSearch" placeholder="Search friends…" aria-label="Search friends" value="${esc(S.live.friendQuery || '')}"></div></div><div class="fr-list">${visible.map(friendCard).join('') || '<div class="set-card muted">No friends match your search.</div>'}</div>${rows.length > pageSize ? `<button class="btn friends-show-all" data-friends-expand>${S.live.showAllFriends ? 'Show less' : `Show all ${rows.length} friends`}</button>` : ''}`
        : `<div class="fr-empty"><div class="fr-empty-ico">${icon('user')}</div><h3>Ride with your friends</h3>
            <p>Add the people you ride with. You'll see which server and track they're on, join them in one click, and see each other's liveries and gear in game.</p>
            <button class="btn btn-primary" data-act="friends-add">${icon('steam')}Add from Steam friends</button></div>`}
    </section></div></div></div></div>`;
  const scroll = $('.scroller', c); if (scroll) scroll.scrollTop = scrollTop;
  const search = $('#friendSearch');
  if (search) {
    search.addEventListener('input', () => { S.live.friendQuery = search.value; renderFriends(c); });
    if (searchFocused) { search.focus({ preventScroll: true }); search.setSelectionRange(selection, selection); }
  }
  $('[data-friends-expand]', c)?.addEventListener('click', () => { S.live.showAllFriends = !S.live.showAllFriends; renderFriends(c); });

  const ps2 = $('#paintSync');
  if (ps2) ps2.addEventListener('change', async () => { S.live.status = await api.invoke('online:paintSync', ps2.checked); renderFriends($('#content')); });
  const sh = $('#liveShare');
  if (sh) sh.addEventListener('change', async () => { S.live.status = await api.invoke('online:share', sh.checked); toast(sh.checked ? 'Friends can see where you ride' : 'Hidden from friends', 'ok', 1800); });
  const ss = $('#serverShare');
  if (ss) ss.addEventListener('change', async () => { S.live.status = await api.invoke('online:serverShare', ss.checked); toast(ss.checked ? 'Riders on your server can sync your gear' : 'Your gear is shared with friends only', 'ok', 2000); });
}

async function renderSync(c) {
  const st = await liveStatus(), ps = st?.paintSync || {}, connected = !!st?.service.connected;
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Online</h2>${onlineTabs()}</div><div class="scroller"><div class="fr-page"><div class="section-title">Sync settings</div>${setupCardHtml(st, 'friends')}<div class="fr-settings"><label class="fr-set"><span><b>Automatic outfit sync</b><span class="muted">Checks every minute for changes to equipped gear and bike paint. Identical files are skipped.</span></span><span class="toggle"><input type="checkbox" id="paintSync" ${ps.enabled ? 'checked' : ''} ${connected ? '' : 'disabled'}><span class="sw"></span></span></label><label class="fr-set"><span><b>Share my riding status</b><span class="muted">Friends who added you back can see your game and server.</span></span><span class="toggle"><input type="checkbox" id="liveShare" ${st?.service.share !== false ? 'checked' : ''} ${connected ? '' : 'disabled'}><span class="sw"></span></span></label><label class="fr-set"><span><b>Share my gear with riders on my server</b><span class="muted">Other app users on the same server can download your free gear and livery when they join, so they see you as you are. Paid items are never shared.</span></span><span class="toggle"><input type="checkbox" id="serverShare" ${st?.serverShare !== false ? 'checked' : ''} ${connected ? '' : 'disabled'}><span class="sw"></span></span></label><div class="fr-set"><span><b>${ps.busy ? 'Checking equipped files…' : ps.at ? `Last synced ${esc(timeAgo(ps.at))}` : 'No sync completed yet'}</b><span class="muted">${ps.error ? esc(ps.error) : 'Only currently equipped gear and the selected bike paint are shared.'}</span></span><button class="btn" data-act="paint-now" ${!connected || ps.busy ? 'disabled' : ''}>Sync now</button></div>${ps.received ? `<div class="fr-set"><span><b>Files downloaded from friends</b><span class="muted">${ps.received} managed files</span></span><button class="btn btn-danger" data-act="paint-remove">Remove downloaded files…</button></div>` : ''}</div><p class="muted">Open friends and their gear from your Steam account at the bottom left.</p><div class="friends-sync-overlay" id="friendsSyncOverlay">${friendProgressHtml()}</div></div></div></div></div>`;
  $('#paintSync', c)?.addEventListener('change', async (e) => { S.live.status = await api.invoke('online:paintSync', e.target.checked); renderSync(c); });
  $('#liveShare', c)?.addEventListener('change', async (e) => { S.live.status = await api.invoke('online:share', e.target.checked); renderSync(c); });
  $('#serverShare', c)?.addEventListener('change', async (e) => { S.live.status = await api.invoke('online:serverShare', e.target.checked); renderSync(c); });
}

function friendSettingsHtml(st) {
  const ps = st?.paintSync || {}, connected = !!st?.service.connected;
  return `<div class="section-title" style="margin-top:26px">Sync settings</div>${setupCardHtml(st, 'friends')}<div class="fr-settings"><label class="fr-set"><span><b>Automatic outfit sync</b><span class="muted">Checks every minute for changes to equipped free gear and bike paint. Identical files are skipped.</span></span><span class="toggle"><input type="checkbox" id="paintSync" ${ps.enabled ? 'checked' : ''} ${connected ? '' : 'disabled'}><span class="sw"></span></span></label><label class="fr-set"><span><b>Share my riding status</b><span class="muted">Friends who added you back can see your game and server.</span></span><span class="toggle"><input type="checkbox" id="liveShare" ${st?.service.share !== false ? 'checked' : ''} ${connected ? '' : 'disabled'}><span class="sw"></span></span></label><label class="fr-set"><span><b>Share my gear with riders on my server</b><span class="muted">Other app users on the same server can download your free gear and livery when they join, so they see you as you are. Paid items are never shared.</span></span><span class="toggle"><input type="checkbox" id="serverShare" ${st?.serverShare !== false ? 'checked' : ''} ${connected ? '' : 'disabled'}><span class="sw"></span></span></label><div class="fr-set"><span><b>${ps.busy ? 'Checking equipped files…' : ps.at ? `Last synced ${esc(timeAgo(ps.at))}` : 'No sync completed yet'}</b><span class="muted">${ps.error ? esc(ps.error) : 'Paid or shop-protected items are never copied to friends.'}</span></span><button class="btn" data-act="paint-now" ${!connected || ps.busy ? 'disabled' : ''}>Sync now</button></div>${ps.received ? `<div class="fr-set"><span><b>Files downloaded from friends</b><span class="muted">${ps.received} managed files</span></span><button class="btn btn-danger" data-act="paint-remove">Remove downloaded files…</button></div>` : ''}</div>`;
}

async function toggleFriendsPanel() {
  if (S.friendsPanel) { S.friendsPanel.element.remove(); S.friendsPanel = null; return; }
  const element = document.createElement('aside'); element.className = 'friends-panel'; element.setAttribute('aria-label', 'Friends');
  element.innerHTML = '<button class="btn btn-icon btn-ghost friends-panel-close" aria-label="Close friends">' + icon('x') + '</button><div class="friends-panel-body"></div>';
  document.body.appendChild(element);
  const body = $('.friends-panel-body', element); S.friendsPanel = { element, body };
  $('.friends-panel-close', element).addEventListener('click', () => { element.remove(); S.friendsPanel = null; });
  await renderFriends(body);
}

document.addEventListener('click', async (e) => {
  const add = e.target.closest('[data-act="friends-add"]');
  if (add) return addFriendsModal();
  const rm = e.target.closest('[data-friend-remove]');
  if (rm) {
    const i = Number(rm.dataset.friendRemove), f = S.friends[i];
    if (!(await confirmBox('Remove friend', `Remove <b>${esc(f.name)}</b> from your friends?`, 'Remove', true))) return;
    S.friends.splice(i, 1);
    S.friends = await api.invoke('friends:save', S.friends);
    S.live.friends = null;
    rm.closest('.modal-wrap')?.close();
    toast(`Removed <b>${esc(f.name)}</b>`, 'ok', 2500);
    renderFriends($('#content'));
    if (S.friendsPanel?.body) renderFriends(S.friendsPanel.body);
  }
});

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]');
  const act = a && a.dataset.act;
  if (act === 'open-friends') { go('friends'); return; }
  const busy = (fn) => async () => { const old = a.innerHTML; a.disabled = true; a.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>'; try { await fn(); } catch (err) { toast(esc(cleanErr(err)), 'err', 7000); } a.disabled = false; a.innerHTML = old; };
  const rerender = () => { S.live.servers = null; S.live.friends = null; S.view === 'friends' ? renderFriends($('#content')) : renderOnline($('#content')); };
  if (act === 'live-plugin-install') return busy(async () => { S.live.status = await api.invoke('online:pluginInstall'); toast('Plugin installed — it starts next time you open MX Bikes', 'ok', 4000); rerender(); })();
  if (act === 'live-plugin-remove') { if (await confirmBox('Remove plugin', 'Remove the CoreMX plugin from your game\'s plugins folder?', 'Remove', true)) busy(async () => { S.live.status = await api.invoke('online:pluginRemove'); rerender(); })(); return; }
  if (act === 'live-connect') return busy(async () => { S.live.status = await api.invoke('online:connect'); toast('Online', 'ok'); rerender(); })();
  if (act === 'paint-now') e.preventDefault();
  if (act === 'paint-now') return busy(async () => { S.live.status = await api.invoke('online:paintSyncNow'); renderFriends($('#content')); })();
  if (act === 'paint-remove') {
    e.preventDefault();
    const n = S.live.status.paintSync.received;
    if (await confirmBox('Remove downloaded gear and paints?', `<b>This deletes up to ${n} unchanged files downloaded from friends from your mods folder.</b><p>This can remove their synced gear models and paints. Your own files and files you have changed are kept. Sync can download missing files again later.</p>`, 'Delete synced downloads', true)) {
      const r = await api.invoke('online:removeReceived'); S.live.status = r.status; toast(`Removed ${r.removed} paint${r.removed === 1 ? '' : 's'}`, 'ok'); renderFriends($('#content'));
    }
    return;
  }
  if (act === 'paint-get') { findMod(a.dataset.name); return; }
  if (act === 'live-disconnect') { if (await confirmBox('Go offline', 'Stop using online features? Friends stop seeing you and paint sync pauses. You can go online again any time.', 'Go offline', true)) busy(async () => { S.live.status = await api.invoke('online:disconnect'); rerender(); })(); return; }
  if (act === 'live-refresh') return busy(async () => {
    // A manual click always bypasses the one-minute cache.  Redraw after the
    // request so the player can see the server-list timestamp change.
    S.live.serversNext = 0;
    await liveStatus(true); drawYouAreOn();
    const changed = await refreshLiveList('servers', true);
    await drawLiveServers();
    toast(changed ? 'Server list refreshed' : 'Showing the latest server list', 'ok', 1800);
  })();
  if (act === 'live-friends-refresh') { await refreshLiveList('friends', true); return renderFriends($('#content')); }
  if (act === 'live-copy-link') { navigator.clipboard.writeText(`mxbm://join/${a.dataset.addr}`); toast('Join link copied', 'ok', 2000); return; }
  const j = e.target.closest('[data-live-join]');
  if (j) { e.stopPropagation(); const s = S.live.servers.servers[Number(j.dataset.liveJoin)]; return joinLiveServer(s); }
  const address = e.target.closest('[data-live-address]');
  if (address) { e.stopPropagation(); const s = S.live.servers.servers[Number(address.dataset.liveAddress)]; return setLiveServerAddress(s); }
  const f = e.target.closest('[data-live-find]');
  if (f) { e.stopPropagation(); return findTrack(trackLabel(S.live.servers.servers[Number(f.dataset.liveFind)])); }
  const o = e.target.closest('[data-live-open]');
  if (o && !e.target.closest('button')) return openLiveServer(S.live.servers.servers[Number(o.dataset.liveOpen)]);
  const fj = e.target.closest('[data-friend-join]');
  if (fj) {
    const fr = S.friends[Number(fj.dataset.friendJoin)];
    const l = (S.live.friends || []).find((x) => x.id === fr.code);
    if (l && l.address) syncAndJoinFriend(fr, l).catch((err) => toast(esc(cleanErr(err)), 'err', 6500));
  }
});

// Search Get Mods for a model a friend's paint needs.
function findMod(name) {
  S.getSrc = 'free'; S.browse.tab = 'all'; S.browse.query = String(name || '').replace(/[_]+/g, ' '); S.browse.sort = 'relevance';
  S.browse.posts = []; S.browse.page = 0; S.browse.totalPages = 1; S.browse.req = (S.browse.req || 0) + 1;
  go('get');
}

function friendProgressHtml() {
  const ps = S.live.status && S.live.status.paintSync;
  const p = ps && ps.progress;
  if (!ps || !ps.busy || !p) return '';
  const ratio = p.size ? Math.min(1, p.loaded / p.size) : 0;
  const pct = p.total ? Math.min(100, (p.completed + ratio) / p.total * 100) : 0;
  return `<div class="friend-sync-progress" role="status"><div><b>${p.phase === 'uploading' ? 'Sharing your outfit' : p.phase === 'downloading' ? 'Installing equipped files' : 'Checking files'}</b><span>${p.total ? `${p.completed} / ${p.total}` : ''}</span></div><progress max="100" ${p.total ? `value="${pct}"` : ''} aria-label="Outfit sync progress"></progress><div class="muted">${esc(p.label || '')}${p.size ? ` · ${fmtSize(p.loaded)} / ${fmtSize(p.size)}` : ''}</div></div>`;
}

function paidModsSummary(items) {
  const missing = items.filter((it) => it.state !== 'have' && /paid|store-protected/i.test(it.error || ''));
  if (!missing.length) return '';
  return `<div class="fr-paid-summary" role="status"><b>Rider has ${missing.length} paid mod${missing.length === 1 ? '' : 's'} — not installing.</b><div>If you own and have installed the matching gear, it is used automatically for this rider. Paid files are not transferred through Sync.</div></div>`;
}

// MX2OEM_2023_Kawasaki_KX250 -> 2023 Kawasaki KX250
function prettyBikeId(id) { return String(id || '').replace(/^(?:MX|SM|EN)[A-Z0-9]*OEM_/i, '').replace(/_/g, ' '); }
async function openFriendDetails(friend) {
  let outfit = null, loading = true, error = null, syncing = false;
  let viewer = null, previewKey = null, previewRevision = 0, refreshRun = null;
  const preview = document.createElement('section');
  preview.className = 'friend-preview';
  preview.innerHTML = `<div class="friend-preview-heading"><b>Rider & bike</b><button class="btn btn-sm" data-preview-reset>${icon('refresh')}Reset view</button></div><div class="friend-preview-stage"><div data-friend-canvas></div><div class="friend-preview-state" role="status"></div></div><div class="friend-preview-note muted" role="status"></div><small class="muted">Drag to turn · scroll to zoom · double-click to reset</small>`;
  const disposePreview = () => { previewRevision++; if (viewer) viewer.dispose(); viewer = null; };
  const renderPreview = async () => {
    if (!outfit || !m.isConnected) return;
    const key = JSON.stringify([outfit.bike, outfit.equipped, outfit.items?.map((item) => [item.slot, item.sha256, item.state]), outfit.unavailable]);
    if (previewKey === key) return;
    previewKey = key; disposePreview();
    const revision = previewRevision, state = $('.friend-preview-state', preview), note = $('.friend-preview-note', preview);
    state.hidden = false; state.innerHTML = '<span class="spinner"></span>Loading shared setup…'; note.textContent = '';
    try {
      const scene = await api.invoke('online:friendPreview', friend.code);
      if (!m.isConnected || revision !== previewRevision) return;
      note.textContent = (scene.warnings || []).join(' ');
      if (!scene.rider && !scene.bike) { state.textContent = scene.pending ? 'Sync or install the required gear to see this setup.' : '3D preview unavailable for this setup.'; return; }
      if (!window.RiderViewer) throw new Error('The 3D viewer has not loaded. Reopen this friend to try again.');
      viewer = window.RiderViewer.create($('[data-friend-canvas]', preview));
      viewer.loadScene(scene); state.hidden = true;
    } catch (err) {
      if (!m.isConnected || revision !== previewRevision) return;
      if (viewer) viewer.dispose(); viewer = null;
      state.textContent = '3D preview unavailable'; note.textContent = cleanErr(err);
    }
  };
  const m = modal({ title: esc(friend.name), body: '<div class="loadmore"><div class="spinner"></div></div>', foot: `<button class="btn btn-danger" data-friend-remove="${S.friends.indexOf(friend)}">${icon('trash')}Remove friend</button><span class="grow"></span><button class="btn" data-close>Close</button><button class="btn btn-primary" data-sync-friend>${icon('download')}Sync equipped gear</button>`,
    onClose: () => { disposePreview(); if (S.friendDialog && S.friendDialog.modal === m) S.friendDialog = null; } });
  $('[data-preview-reset]', preview).addEventListener('click', () => viewer?.resetView());
  const drawProgress = () => { const box = $('[data-friend-progress]', m); if (box) box.innerHTML = friendProgressHtml(); };
  const draw = () => {
    if (!m.isConnected) return;
    const l = (S.live.friends || []).find((f) => f.id === friend.code);
    const track = l && (l.trackName || l.trackId);
    const missing = track && !trackInstalled(track);
    const stateLabels = { have: 'Already installed — skipped', ready: 'Ready to install', downloaded: 'Installed', 'name-taken': 'Different version installed — kept', failed: 'Installation failed', skipped: 'Cannot sync' };
    const rows = (outfit && outfit.equipped && outfit.equipped.length ? outfit.equipped : (outfit && outfit.items || []).map((it) => ({ slot: it.slot, label: it.label, value: it.value }))).map((slot) => {
      const item = (outfit.items || []).find((it) => it.slot === slot.slot);
      const unavailable = (outfit.unavailable || []).find((it) => it.slot === slot.slot);
      if (unavailable && unavailable.state !== 'have' && /paid|store-protected/i.test(unavailable.error || '')) return '';
      const state = item ? stateLabels[item.state] || 'Shared' : unavailable ? unavailable.state === 'have' ? 'Paid mod — already installed' : unavailable.error : 'Included with the game';
      const needs = item && item.needs || [];
      return `<div class="friend-gear-row"><span class="slot-ico">${icon(({ helmet: 'helmet', bikePaint: 'bike', boots: 'boot', glovesPaint: 'glove' })[slot.slot] || 'shirt')}</span><div><b>${esc(slot.label)}</b><div>${esc(slot.value || 'Default')}</div><small class="${unavailable && unavailable.state !== 'have' || item && ['failed', 'name-taken'].includes(item.state) ? 'sync-warning' : 'muted'}">${esc(state)}${item ? ` · ${fmtSize(item.size)}` : ''}</small>${needs.map((n) => `<div class="sync-warning">Needs ${esc(n.name)} <button class="btn btn-sm" data-friend-find="${esc(n.name)}">Find model</button></div>`).join('')}</div></div>`;
    }).join('');
    $('.modal-body', m).innerHTML = `<div class="friend-session"><b>${l && l.online ? l.inGame ? 'In MX Bikes' : 'Online in the manager' : 'Offline'}</b>${l && l.inEvent ? `<div>${esc(l.server || 'In a session — the server name appears once they ride out')}${track ? ` · ${esc(track)}` : ''}${sessionLabel(l) ? ` · ${esc(sessionLabel(l))}` : ''}</div><div class="friend-session-actions">${track && missing ? '<button class="btn" data-friend-track>Download track</button>' : ''}${l.address ? `<button class="btn btn-primary" data-friend-modal-join>${icon('play')}${missing ? 'Get track & join' : 'Join friend'}</button>` : '<span class="muted">Join from the game server list until the server address is known.</span>'}</div>` : ''}</div><div data-friend-progress>${friendProgressHtml()}</div>${error ? `<div class="notice danger">${icon('alert')}<div>${esc(error)}</div></div>` : ''}${loading ? '<div class="loadmore"><div class="spinner"></div></div>' : outfit ? `<div class="friend-outfit-summary"><b>Currently equipped</b><span class="muted">${esc(prettyBikeId(outfit.bikeName || outfit.bike || ''))} · shared ${esc(timeAgo(outfit.at))}</span></div><p class="muted">Sync adds the missing files to your mods folder. Your own outfit stays selected.</p>${paidModsSummary(outfit?.unavailable || [])}<div class="friend-gear-list">${rows}</div>` : '<div class="set-card muted">No outfit shared yet. Both riders need the latest manager and online server, outfit sync enabled, and must add each other as friends.</div>'}`;
    const list = $('.friend-gear-list', m);
    if (list) { list.before(preview); renderPreview(); }
    const button = $('[data-sync-friend]', m);
    button.disabled = loading || syncing || !outfit || !S.live.status?.service.connected;
    button.innerHTML = syncing ? '<span class="spinner"></span>Syncing…' : `${icon('download')}Sync equipped gear`;
  };
  const refresh = (forcePreview = false) => {
    if (forcePreview) previewKey = null;
    if (refreshRun || !m.isConnected) return refreshRun;
    refreshRun = (async () => {
      try { outfit = await api.invoke('online:friendLoadout', friend.code); error = null; }
      catch (e) { error = cleanErr(e); }
      loading = false; draw();
    })().finally(() => { refreshRun = null; });
    return refreshRun;
  };
  S.friendDialog = { id: friend.code, modal: m, progress: drawProgress, redraw: draw, refresh };
  $('[data-sync-friend]', m).addEventListener('click', async () => {
    syncing = true; error = null; draw();
    try {
      S.live.status = await api.invoke('online:paintSyncNow', friend.code);
      const ps = S.live.status.paintSync;
      if (ps.error) throw new Error(ps.error);
      const result = (ps.friends || []).find((f) => f.id === friend.code);
      const failed = result && result.items.filter((it) => ['failed', 'name-taken', 'skipped'].includes(it.state)).length;
      const count = result && result.items.filter((it) => it.state === 'downloaded').length || 0;
      toast(failed ? `${failed} files need attention — see the list` : count ? `Installed ${count} missing equipped files` : 'You already have the equipped files', failed ? 'info' : 'ok', 4500);
      S.gearThumbs.clear();
    } catch (e) { error = cleanErr(e); }
    syncing = false;
    const savedError = error; await refresh(); if (savedError) { error = savedError; draw(); }
  });
  $('.modal-body', m).addEventListener('click', (e) => {
    const find = e.target.closest('[data-friend-find]');
    if (find) { m.close(); findMod(find.dataset.friendFind); return; }
    const l = (S.live.friends || []).find((f) => f.id === friend.code);
    if (e.target.closest('[data-friend-track]')) { m.close(); findFriendTrack(friend, l); }
    if (e.target.closest('[data-friend-modal-join]') && l) {
      m.close();
      syncAndJoinFriend(friend, l).catch((err) => toast(esc(cleanErr(err)), 'err', 6500));
    }
  });
  draw(); await refresh();
}

async function findFriendTrack(friend, session, joinAfter = false) {
  const name = session && (session.trackName || session.trackId);
  if (!name) return;
  const m = modal({ title: `Download track — ${esc(name)}`, body: '<div class="loadmore"><div class="spinner"></div></div>', foot: '<button class="btn" data-close>Cancel</button>' });
  try {
    const { posts } = await api.invoke('library:imageCandidates', { query: name, tab: 'tracks', source: 'all' });
    if (!m.isConnected) return;
    const results = posts.slice(0, 12);
    $('.modal-body', m).innerHTML = `<p class="muted">Choose the matching version from the creator's download page. Store purchases use the store's normal download process.</p><div class="friend-track-results">${results.map((p, i) => `<button class="friend-track-result" data-track-result="${i}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}<span><b>${esc(p.title)}</b><small>${esc(p.source)}${p.matchReliable ? ' · Best match' : ' · Check version'}</small></span>${icon('chevron')}</button>`).join('') || '<div class="muted">No matching download pages found. Try searching Get Mods with a shorter track name.</div>'}</div>`;
    $('.modal-body', m).addEventListener('click', (e) => {
      const button = e.target.closest('[data-track-result]'); if (!button) return;
      const p = results[Number(button.dataset.trackResult)];
      if (joinAfter) { S.pendingFriendJoin = { friendId: friend.code, address: session.address, track: name, server: session.server, at: Date.now() }; toast('Install the matching track, then the app will join your friend', 'info', 6000); }
      m.close();
      if (p.source === 'mxb-mods') openPost(p);
      else { S.shop.id = p.source === 'MX Bikes Shop' ? 'mxbs' : 'hub'; openProduct(p); }
    });
  } catch (e) { if (m.isConnected) $('.modal-body', m).textContent = cleanErr(e); }
}

// Joining a friend is deliberately a small preflight, not just a direct
// connect: their current free gear, livery and tyre files are checked first,
// then their current track is handled before MX Bikes launches.
async function syncAndJoinFriend(friend, session) {
  if (!session?.address) throw new Error('This server address is not known yet. Join it once from the game server list, or save the matching address.');
  toast(`Checking ${esc(friend.name)}'s current gear…`, 'info', 2200);
  S.live.status = await api.invoke('online:paintSyncNow', friend.code);
  const sync = S.live.status.paintSync || {};
  if (sync.error) throw new Error(sync.error);
  const report = (sync.friends || []).find((entry) => entry.id === friend.code);
  const problems = report?.items?.filter((item) => ['failed', 'name-taken', 'skipped'].includes(item.state)).length || 0;
  if (problems) toast(`${problems} of ${friend.name}'s files need attention — open Gear & sync for details`, 'info', 5000);
  else toast(`Checked ${friend.name}'s current free gear and tyres`, 'ok', 1800);
  const track = session.trackName || session.trackId;
  if (track && !trackInstalled(track)) return findFriendTrack(friend, session, true);
  return joinServer(session.address, { name: session.server, address: session.address, track });
}

async function checkFriendTrackJoin() {
  const pending = S.pendingFriendJoin;
  if (!pending || Date.now() - pending.at > 30 * 60 * 1000) { S.pendingFriendJoin = null; return; }
  if (!trackInstalled(pending.track)) return;
  S.pendingFriendJoin = null;
  const friends = await api.invoke('online:friends');
  const friend = friends.find((f) => f.id === pending.friendId);
  if (!friend || !friend.online || friend.address !== pending.address || (friend.trackName || friend.trackId) !== pending.track) { toast('Track installed. Your friend changed session — open their profile to join.', 'info', 6000); return; }
  await joinServer(pending.address, { name: pending.server, track: pending.track });
}

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-friend-details]');
  const row = e.target.closest('[data-friend-open]');
  if (button || row && !e.target.closest('button,a')) {
    const friend = S.friends[Number(button ? button.dataset.friendDetails : row.dataset.friendOpen)];
    if (friend) openFriendDetails(friend);
  }
});

setInterval(async () => {
  const tab = S.onlineTab;
  if ((!S.friendsPanel && (S.view !== 'online' || !['friends', 'servers'].includes(tab))) || !S.live.status?.service.connected || S.live.polling) return;
  S.live.polling = true;
  try {
    if (S.friendsPanel) { const changed = await refreshLiveList('friends'); if (changed && S.friendsPanel) await renderFriends(S.friendsPanel.body); S.friendDialog?.redraw(); }
    if (S.view !== 'online' || S.onlineTab !== 'servers') return;
    const changed = await refreshLiveList('servers'); if (changed && S.view === 'online' && S.onlineTab === 'servers') await drawLiveServers();
  }
  finally { S.live.polling = false; }
}, 15000);

// ---------- Add friends popup: Steam friends list, or a friend code ----------
async function addFriendsModal() {
  const steam = S.accounts.steam || {};
  const selfCode = steam.steamId || S.live.status?.service.id;
  const m = modal({
    title: 'Add friends', size: 'sm',
    body: `<div class="seg-tabs" style="margin:0 0 12px"><button class="active" data-af-tab="steam">${icon('steam')}Steam friends</button><button data-af-tab="code">${icon('key')}Friend code</button></div>
      <div id="afBody"></div>`,
    foot: /^7656119\d{10}$/.test(selfCode || '') ? '<span class="grow">Preview your own status and gear.</span><button class="btn" data-add-self>Add myself</button>' : '',
    onClose: () => { if (S.friendsPanel?.body) renderFriends(S.friendsPanel.body); },
  });
  let list = null;
  const added = () => new Set((S.friends || []).map((f) => f.code));
  const addOne = async (name, code) => {
    if (added().has(code)) { toast(`${esc(name)} is already a friend`, 'info', 1600); return; }
    S.friends.push({ name, code, addedAt: Date.now() });
    S.friends = await api.invoke('friends:save', S.friends);
    S.live.friends = null;
    S.live.friendsNext = 0;
    toast(`Added <b>${esc(name)}</b>`, 'ok', 1600);
  };
  $('[data-add-self]', m)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await addOne(`${steam.name || S.live.status?.service.name || 'My profile'} (you)`, selfCode); m.close(); }
    catch (err) { e.target.disabled = false; toast(esc(cleanErr(err)), 'err'); }
  });

  const showSteam = async () => {
    const box = $('#afBody', m);
    if (!list) {
      box.innerHTML = '<div class="loadmore"><div class="spinner"></div></div>';
      try { list = await api.invoke('online:steamFriends'); } catch (e) { box.innerHTML = `<div class="notice danger">${esc(cleanErr(e))}</div>`; return; }
    }
    if (!list.length) { box.innerHTML = '<div class="muted" style="padding:24px;text-align:center">No Steam friends found on this PC.<br>Make sure Steam is signed in, or use a friend code.</div>'; return; }
    box.innerHTML = `<div class="search" style="margin-bottom:10px">${icon('search')}<input id="sfQ" placeholder="Search your Steam friends…" style="width:100%"></div><div class="opt-list" id="sfList"></div>`;
    const draw = () => {
      const q = $('#sfQ', m).value.toLowerCase();
      const have = added();
      const xs = list.filter((f) => f.name.toLowerCase().includes(q)).sort((a, b) => (b.onService - a.onService) || a.name.localeCompare(b.name));
      $('#sfList', m).innerHTML = xs.map((f) => `<div class="opt" style="cursor:default"><span class="fr-av sm">${esc(f.name.slice(0, 1).toUpperCase())}</span>
        <span class="opt-txt"><span>${esc(f.name)}</span><span class="muted">${f.onService ? 'Uses CoreMX' : "Hasn't installed the app yet"}</span></span>
        ${have.has(f.steamId) ? `<span class="badge ok" style="position:static">${icon('check')}Added</span>` : `<button class="btn btn-sm ${f.onService ? 'btn-primary' : ''}" data-sf-add="${esc(f.steamId)}">Add</button>`}</div>`).join('') || '<div class="muted" style="padding:20px;text-align:center">No matches</div>';
    };
    $('#sfQ', m).addEventListener('input', draw);
    $('#sfList', m).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-sf-add]');
      if (!b) return;
      const f = list.find((x) => x.steamId === b.dataset.sfAdd);
      await addOne(f.name, f.steamId);
      draw();
    });
    draw();
    setTimeout(() => $('#sfQ', m) && $('#sfQ', m).focus(), 50);
  };

  const showCode = () => {
    $('#afBody', m).innerHTML = `<p class="muted" style="margin:0 0 12px;font-size:13px">Ask your friend for their friend code — it's in their app under <b>Online → Friends → Sharing</b>.</p>
      <div class="field" style="margin-bottom:10px"><label>Their name</label><input class="input" id="afName" placeholder="What you call them" style="width:100%"></div>
      <div class="field" style="margin-bottom:14px"><label>Friend code</label><input class="input mono" id="afCode" placeholder="7656119…" style="width:100%" spellcheck="false"></div>
      <button class="btn btn-primary" id="afAdd" style="width:100%;justify-content:center">${icon('user')}Add friend</button>
      ${steam.found ? `<div class="fr-mycode"><span class="muted">Your code</span><span class="mono">${esc(steam.steamId)}</span><button class="btn btn-sm" data-act="copy-steamid">${icon('copy')}Copy</button></div>` : ''}`;
    $('#afAdd', m).addEventListener('click', async () => {
      const name = $('#afName', m).value.trim(), code = $('#afCode', m).value.replace(/\s+/g, '');
      if (!/^7656119\d{10}$/.test(code)) { toast('A friend code is a 17-digit number starting with 7656119', 'err', 3500); return; }
      await addOne(name || 'Friend', code);
      $('#afName', m).value = ''; $('#afCode', m).value = '';
    });
    setTimeout(() => $('#afName', m).focus(), 50);
  };

  m.addEventListener('click', (e) => {
    const t = e.target.closest('[data-af-tab]');
    if (!t) return;
    $$('[data-af-tab]', m).forEach((b) => b.classList.toggle('active', b === t));
    if (t.dataset.afTab === 'steam') showSteam(); else showCode();
  });
  showSteam();
}
