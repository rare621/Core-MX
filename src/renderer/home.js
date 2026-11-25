/* global S, $, esc, icon, api, go, liveStatus, refreshLiveList, joinLiveServer, joinServer, openLiveServer, trackLabel, friendGearSummary, prettifyBike */
'use strict';

// Home loads account and server data first; its rider snapshot renders later.
S.home = { rider: null, request: null, introPlayed: false, previewKey: null, previewImage: null, previewBusy: false };

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

async function warmHomeRiderPreview() {
  try {
    const hint = JSON.parse(localStorage.getItem('coremx.homePreview') || 'null');
    if (!hint || typeof hint.key !== 'string' || typeof hint.profile !== 'string' || typeof hint.bike !== 'string') return;
    const image = await api.invoke('rider:thumbCacheGet', hint.key);
    if (!image || S.home.previewBusy || S.home.previewImage || S.home.rider &&
      (S.home.rider.profile !== hint.profile || S.home.rider.bike && S.home.rider.bike.id !== hint.bike)) return;
    S.home.previewHint = hint;
    S.home.previewKey = hint.key;
    S.home.previewImage = image;
    drawHome();
  } catch {}
}

function renderHome(c) {
  const entrance = S.home.introPlayed ? '' : ' home-enter';
  S.home.introPlayed = true;
  c.innerHTML = `<div class="view home-view"><div class="main"><div class="scroller home-scroll"><div class="home-page${entrance}">
    <section class="home-hero"><div class="home-hero-copy"><div class="home-eyebrow">YOUR MX BIKES HOME</div><h1 id="homeGreeting">Ready to ride?</h1></div><div class="home-actions"><button class="btn btn-primary" data-home-go="game">${icon('play')}Start riding</button><button class="btn" data-home-go="host">${icon('signal')}Host a World</button></div></section>
    <div class="home-grid"><section class="home-panel home-servers"><div class="home-panel-head"><div><span class="home-kicker">GO RIDE</span><h2>Live servers</h2></div><button class="btn btn-sm" data-home-go="online">View all ${icon('chevron')}</button></div><div id="homeServers" class="home-panel-body"></div></section>
      <section class="home-panel home-friends"><div class="home-panel-head"><div><span class="home-kicker">YOUR CREW</span><h2>Friends</h2></div><button class="btn btn-sm" data-home-go="friends">View friends ${icon('chevron')}</button></div><div id="homeFriends" class="home-panel-body"></div></section>
      <section class="home-panel home-rider"><div class="home-panel-head"><div><span class="home-kicker">READY FOR THE GATE</span><h2>Your rider</h2></div><button class="btn btn-sm" data-home-go="rider">Edit outfit ${icon('chevron')}</button></div><div id="homeRider" class="home-panel-body"></div></section>
      <section class="home-panel home-recents"><div class="home-panel-head"><div><span class="home-kicker">JUMP BACK IN</span><h2>Recently played</h2></div><button class="btn btn-sm" data-home-go="recents">See all ${icon('chevron')}</button></div><div id="homeRecents" class="home-panel-body"></div></section>
    </div></div></div></div></div>`;
  drawHome();
}

function drawHome() {
  if (S.view !== 'home' || !$('#homeRider')) return;
  const st = S.live?.status;
  const connected = !!st?.service?.connected;
  const steamName = S.accounts?.steam?.name || st?.service?.name || '';
  const greeting = $('#homeGreeting');
  if (greeting) greeting.textContent = steamName ? `Ready to ride, ${steamName}?` : 'Ready to ride?';
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
  const selectedBike = S.rider?.bike ? S.rider?.bikes?.find((b) => b.id === S.rider.bike) : rider?.bike;
  const bikeName = selectedBike ? prettifyBike(selectedBike.id || selectedBike.name || '') : 'Choose your bike';
  const preview = S.home.previewImage ? `<img src="${S.home.previewImage}" alt="Your rider on ${esc(bikeName)}">`
    : `<div class="home-preview-wait">${icon('helmet')}<div>${S.home.previewBusy ? 'Preparing your rider and bike…' : 'Your rider and bike will appear here'}</div></div>`;
  homePut('homeRider', `<div class="home-rider-preview">${preview}</div><div class="home-rider-meta"><div><b>${esc(activeProfile || 'Loading rider…')}</b><small>${esc(bikeName)}</small></div><button class="btn btn-sm" data-home-go="rider">Customize ${icon('chevron')}</button></div>`);
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
        if (S.home.previewHint?.profile !== profile) S.home.previewImage = null;
      }
      drawHome();
      const bikes = await api.invoke('rider:bikes', profile);
      const bike = bikes.find((b) => b.selected) || bikes.find((b) => b.installed) || bikes[0];
      if (S.home.rider?.profile !== profile || S.home.rider?.bike?.id !== bike?.id && S.home.previewHint?.bike !== bike?.id) S.home.previewImage = null;
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
  const key = JSON.stringify(['home-rider-v1', profile, bike.id, loadout.current, loadout.identity?.riderNumber, stamp >>> 0]);
  if (S.home.previewKey === key && S.home.previewImage) return;
  if (S.home.previewBusy) { S.home.previewKey = key; S.home.previewImage = null; S.home.previewPending = true; return; }
  S.home.previewBusy = true;
  S.home.previewKey = key;
  S.home.previewImage = null;
  drawHome();
  try {
    const cached = await api.invoke('rider:thumbCacheGet', key);
    if (cached) {
      if (S.home.previewKey === key) {
        S.home.previewImage = cached;
        S.home.previewHint = { key, profile, bike: bike.id };
        try { localStorage.setItem('coremx.homePreview', JSON.stringify(S.home.previewHint)); } catch {}
      }
      return;
    }
    // The startup gate never waits for 3D. Render only after it has gone away.
    if ($('#startupScreen') && !$('#startupScreen').classList.contains('done')) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    const [riderModel, bikeModel] = await Promise.all([
      api.invoke('rider:model', profile, bike.id, loadout.current),
      api.invoke('bike:model', profile, bike.id, loadout.current.bikePaint || '', 1024,
        { ...loadout.current, riderNumber: loadout.identity?.riderNumber ?? '' }),
    ]);
    if (S.home.previewKey !== key) return;
    const host = document.createElement('div');
    host.className = 'home-render-host';
    document.body.appendChild(host);
    let viewer;
    try {
      viewer = window.RiderViewer.create(host);
      viewer.loadScene({ rider: riderModel, bike: bikeModel });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const image = viewer.el.querySelector('canvas')?.toDataURL('image/webp', 0.84);
      if (image && S.home.previewKey === key) {
        S.home.previewImage = image;
        S.home.previewHint = { key, profile, bike: bike.id };
        try { localStorage.setItem('coremx.homePreview', JSON.stringify(S.home.previewHint)); } catch {}
        const installedBike = (S.items || []).find((item) => item.group === 'bikes' && item.name === bike.id && !item.disabled);
        api.invoke('rider:thumbCacheSave', key, image, installedBike?.id || null).catch(() => {});
      }
    } finally { viewer?.dispose(); host.remove(); }
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
  else go(link.dataset.homeGo);
});

setInterval(() => { if (S.view === 'home') refreshHome(); }, 60000);
