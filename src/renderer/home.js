/* global S, $, esc, icon, api, go, liveStatus, refreshLiveList, joinLiveServer, joinServer, openLiveServer, trackLabel, friendGearSummary, prettifyBike */
'use strict';

// Home loads account and server data first; its rider snapshot renders later.
S.home = { rider: null, request: null, introPlayed: false, previewKey: null, previewBusy: false, viewer: null, modelOk: false };

function finishStartup() {
  const screen = $('#startupScreen');
  if (!screen) return;
  screen.classList.add('done');
  screen.setAttribute('aria-hidden', 'true');
  setTimeout(() => screen.remove(), 500);
  setTimeout(() => { if (S.view === 'home') prepareHomeRiderPreview(); }, 1500);
}

function homePut(id, html) {
  const box = $(`#${id}`);
  if (box && box._lastHtml !== html) { box.innerHTML = html; box._lastHtml = html; }
}

function renderHome(c) {
  const entrance = S.home.introPlayed ? '' : ' home-enter';
  S.home.introPlayed = true;
  c.innerHTML = `<div class="view home-view"><div class="main">
    <div class="toolbar home-toolbar"><div class="home-heading"><h2 id="homeGreeting">Welcome back</h2></div><div class="grow"></div><button class="btn" data-home-go="host">${icon('signal')}Host a World</button><button class="btn btn-primary" data-home-go="online">${icon('play')}Play online</button></div>
    <div class="scroller home-scroll"><div class="home-page${entrance}"><div class="home-grid">
      <section class="home-panel home-rider"><div class="home-panel-head"><div><span class="home-kicker">YOUR SETUP</span><h2>Ready to ride</h2></div><button class="btn btn-sm" data-home-go="rider">Edit outfit ${icon('chevron')}</button></div><div id="homeRider" class="home-panel-body"></div><div class="home-shortcuts"><button data-home-go="library">${icon('library')}My Mods ${icon('chevron')}</button><button data-home-go="get">${icon('globe')}Get Mods ${icon('chevron')}</button></div></section>
      <div class="home-side"><section class="home-panel home-servers"><div class="home-panel-head"><div><span class="home-kicker">ONLINE</span><h2>Live servers</h2></div><button class="btn btn-sm" data-home-go="online">View all ${icon('chevron')}</button></div><div id="homeServers" class="home-panel-body"></div></section>
        <section class="home-panel home-friends"><div class="home-panel-head"><div><span class="home-kicker">YOUR FRIENDS</span><h2>Friends</h2></div><button class="btn btn-sm" data-home-go="friends">View all ${icon('chevron')}</button></div><div id="homeFriends" class="home-panel-body"></div></section>
        <section class="home-panel home-recents"><div class="home-panel-head"><div><span class="home-kicker">QUICK JOIN</span><h2>Recently played</h2></div><button class="btn btn-sm" data-home-go="recents">View all ${icon('chevron')}</button></div><div id="homeRecents" class="home-panel-body"></div></section></div>
    </div></div></div></div></div>`;
  drawHome();
}

function drawHome() {
  if (S.view !== 'home' || !$('#homeRider')) return;
  const st = S.live?.status;
  const connected = !!st?.service?.connected;
  const steamName = S.accounts?.steam?.name || st?.service?.name || '';
  const greeting = $('#homeGreeting');
  if (greeting) greeting.textContent = steamName ? `Welcome back, ${steamName}` : 'Welcome back';
  const servers = S.live?.servers?.servers || [];
  const liveFriends = new Map((S.live?.friends || []).map((f) => [f.id, f]));
  const friends = (S.friends || []).map((f) => ({ f, l: liveFriends.get(f.code) }));

  let serverRows = '';
  if (!st) serverRows = '<div class="home-empty">Checking live servers…</div>';
  else if (!connected) serverRows = '<div class="home-empty">Go online to see servers with CoreMX riders.</div>';
  else if (S.live.serversErr && !servers.length) serverRows = `<div class="home-empty">${esc(S.live.serversErr)}</div>`;
  else if (!servers.length) serverRows = `<div class="home-empty">${S.live.servers ? 'No live servers yet.' : 'Finding live servers…'}</div>`;
  else {
    serverRows = [...servers].sort((a, b) => b.riders.length - a.riders.length).slice(0, 5).map((s) => {
      const i = servers.indexOf(s);
      return `<div class="home-row"><span class="home-pop">${s.riders.length}</span><div class="home-row-copy"><b>${esc(s.name || 'Unnamed World')}</b><small>${esc(trackLabel(s) || 'Track unknown')} · ${s.riders.length} rider${s.riders.length === 1 ? '' : 's'}${s.hosted ? ' · Game hosted' : ''}</small></div><button class="btn btn-sm ${s.address ? 'btn-primary' : ''}" data-home-server="${i}">${s.address ? `${icon('play')}Join` : 'Details'}</button></div>`;
    }).join('');
  }
  homePut('homeServers', serverRows);
  const recents = (S.home.recents || []).filter((r) => r.name).slice(0, 2);
  homePut('homeRecents', recents.length ? recents.map((r, i) => `<div class="home-row"><span class="home-recent-icon">${icon('clock')}</span><div class="home-row-copy"><b>${esc(r.name)}</b><small>${esc(r.track || 'Track unknown')}${r.address ? '' : ' · Address not discovered'}</small></div><button class="btn btn-sm btn-primary" data-home-recent="${i}" ${r.address ? '' : 'disabled'}>${icon('play')}Join</button></div>`).join('') : '<div class="home-empty">Servers you join will appear here.</div>');

  let friendRows = '';
  if (!S.friends && !st) friendRows = '<div class="home-empty">Checking your friends…</div>';
  else if (!S.friends?.length) friendRows = '<div class="home-empty">Add friends to see when they are riding.</div>';
  else friendRows = friends.sort((a, b) => Number(!!b.l?.online) - Number(!!a.l?.online)).slice(0, 3).map(({ f, l }) => {
    const paint = (st.paintSync?.friends || []).find((p) => p.id === f.code);
    const summary = paint?.items?.length ? friendGearSummary(paint.items) : null;
    const online = l?.status === 'ok' && l.online;
    const presence = online ? (l.server || (l.inGame ? 'In MX Bikes' : 'Online')) : l?.status === 'not-on-service' ? 'Not using CoreMX' : 'Offline';
    const sync = summary ? summary.text : connected ? 'Gear status pending' : 'Gear sync offline';
    return `<div class="home-row"><span class="home-friend-avatar ${online ? 'online' : 'offline'}">${esc((f.name || '?').slice(0, 1).toUpperCase())}<i></i></span><div class="home-row-copy"><b>${esc(f.name)}</b><small>${esc(presence)} · ${esc(sync)}</small></div><button class="btn btn-sm" data-home-go="friends">View</button></div>`;
  }).join('');
  homePut('homeFriends', friendRows);

  const rider = S.home.rider;
  const activeProfile = S.rider?.profile || rider?.profile;
  const selectedBike = S.rider?.bike ? S.rider?.bikes?.find((b) => b.id === S.rider.bike) || (rider?.bike?.id === S.rider.bike ? rider.bike : null) : rider?.bike;
  const bikeName = selectedBike ? prettifyBike(selectedBike.id || selectedBike.name || '') : 'Choose your bike';
  const preview = S.home.modelOk ? '' : `<div class="home-preview-wait">${icon('helmet')}<div>${S.home.previewBusy ? 'Preparing your rider and bike…' : 'Your rider and bike will appear here'}</div></div>`;
  homePut('homeRider', `<div class="home-rider-preview ${S.home.modelOk ? '' : 'is-loading'}" id="homeRiderStage" aria-label="3D preview of your rider on ${esc(bikeName)}">${preview}</div><div class="home-rider-meta"><div><small>RIDER</small><b>${esc(activeProfile || 'Loading rider…')}</b></div><div><small>BIKE</small><b>${esc(bikeName)}</b></div></div>`);
  const stage = $('#homeRiderStage');
  if (stage && S.home.viewer && S.home.viewer.el.parentElement !== stage) stage.prepend(S.home.viewer.el);
}

async function refreshHome() {
  if (S.home.request) return S.home.request;
  S.home.request = (async () => {
    const status = await liveStatus();
    drawHome();
    const tasks = [];
    tasks.push(api.invoke('friends:list').then((rows) => { S.friends = rows; drawHome(); }));
    tasks.push(api.invoke('servers:recent').then((rows) => { S.home.recents = rows; drawHome(); }));
    if (status?.service?.connected) {
      tasks.push(refreshLiveList('servers').then(drawHome));
      tasks.push(refreshLiveList('friends').then(drawHome));
    }
    tasks.push(api.invoke('rider:profiles').then(async (profiles) => {
      const profile = profiles.last || profiles.profiles?.[0];
      if (!profile) return;
      if (S.home.rider?.profile !== profile) {
        S.home.rider = { profile, bike: null };
        S.home.modelOk = false;
      }
      drawHome();
      const bikes = await api.invoke('rider:bikes', profile);
      const bike = bikes.find((b) => b.selected) || bikes.find((b) => b.installed) || bikes[0];
      if (S.home.rider?.profile !== profile || S.home.rider?.bike?.id !== bike?.id) S.home.modelOk = false;
      S.home.rider = { profile, bike };
      drawHome();
      if (S.home.rider.bike) {
        S.home.rider.loadout = await api.invoke('rider:loadout', profile, S.home.rider.bike.id);
        prepareHomeRiderPreview();
      }
    }));
    await Promise.allSettled(tasks);
  })();
  try { return await S.home.request; }
  finally { S.home.request = null; }
}

async function prepareHomeRiderPreview() {
  const { profile, bike, loadout } = S.home.rider || {};
  if (!profile || !bike?.id || !loadout?.current) return;
  const sources = (S.items || []).filter((it) => !it.disabled && ['bikes', 'rider'].includes(it.group))
    .map((it) => [it.id, it.size, it.mtime].join(':')).join('|');
  let stamp = 2166136261;
  for (let i = 0; i < sources.length; i++) stamp = Math.imul(stamp ^ sources.charCodeAt(i), 16777619);
  const key = JSON.stringify(['home-rider-live-v1', profile, bike.id, loadout.current, loadout.identity?.riderNumber, stamp >>> 0]);
  if (S.home.previewKey === key && S.home.modelOk && S.home.viewer) return;
  if (S.home.previewBusy) { S.home.previewKey = key; S.home.previewPending = true; return; }
  S.home.previewBusy = true;
  S.home.previewKey = key;
  S.home.modelOk = false;
  drawHome();
  try {
    // The startup gate never waits for 3D. Build the scene once Home is visible.
    if ($('#startupScreen') && !$('#startupScreen').classList.contains('done')) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (!window.RiderViewer) await new Promise((resolve) => window.addEventListener('riderviewer-ready', resolve, { once: true }));
    if (S.view !== 'home' || S.home.previewKey !== key) return;
    const [riderModel, bikeModel] = await Promise.all([
      api.invoke('rider:model', profile, bike.id, loadout.current),
      api.invoke('bike:model', profile, bike.id, loadout.current.bikePaint || '', 1024,
        { ...loadout.current, riderNumber: loadout.identity?.riderNumber ?? '' }).catch(() => null),
    ]);
    if (S.view !== 'home' || S.home.previewKey !== key) return;
    const stage = $('#homeRiderStage');
    if (!stage) return;
    if (!S.home.viewer) {
      const host = document.createElement('div');
      host.className = 'stage-canvas';
      stage.prepend(host);
      S.home.viewer = window.RiderViewer.create(host);
    } else if (S.home.viewer.el.parentElement !== stage) stage.prepend(S.home.viewer.el);
    if (bikeModel) S.home.viewer.loadScene({ rider: riderModel, bike: bikeModel });
    else S.home.viewer.load(riderModel);
    S.home.modelOk = true;
  } catch (e) { console.warn('Home rider preview:', e.message); }
  finally {
    S.home.previewBusy = false;
    drawHome();
    if (S.home.previewPending) { S.home.previewPending = false; prepareHomeRiderPreview(); }
  }
}

document.addEventListener('click', (e) => {
  const recentButton = e.target.closest('[data-home-recent]');
  if (recentButton) {
    const server = (S.home.recents || []).filter((r) => r.name).slice(0, 2)[Number(recentButton.dataset.homeRecent)];
    if (server?.address) joinServer(server.address, server);
    return;
  }
  const serverButton = e.target.closest('[data-home-server]');
  if (serverButton) {
    const server = S.live?.servers?.servers?.[Number(serverButton.dataset.homeServer)];
    if (server) server.address ? joinLiveServer(server) : openLiveServer(server);
    return;
  }
  const link = e.target.closest('[data-home-go]');
  if (!link) return;
  if (link.dataset.homeGo === 'host') { S.onlineTab = 'host'; go('online'); }
  else if (link.dataset.homeGo === 'recents') { S.onlineTab = 'recents'; go('online'); }
  else if (link.dataset.homeGo === 'online') { S.onlineTab = 'servers'; go('online'); }
  else go(link.dataset.homeGo);
});

setInterval(() => { if (S.view === 'home') refreshHome(); }, 60000);
