/* global S, $, $$, esc, icon, toast, modal, confirmBox, confirmRiderBeforeGame, cleanErr, render, debounce, api, go, haveMod, normName */
'use strict';
// ---------- Online: Servers (join / saved / links), Friends (front end), Ranked (mxb-ranked.com) ----------
S.onlineTab = 'servers';
S.servers = null;
S.friends = null;

function onlineTabs() {
  const t = (id, ic, l) => `<button class="${S.onlineTab === id ? 'active' : ''}" data-online-tab="${id}">${icon(ic)}${l}</button>`;
  return `<div class="seg-tabs">${t('servers', 'globe', 'Servers')}${t('recents', 'clock', 'Recents')}${t('ranked', 'star', 'Ranked')}${t('host', 'play', 'Host')}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-online-tab]');
  if (b) { S.onlineTab = b.dataset.onlineTab; renderOnline($('#content')); }
});

async function renderOnline(c) {
  if (S.onlineTab === 'friends') S.onlineTab = 'servers';
  if (S.onlineTab === 'ranked') return renderRanked(c);
  if (S.onlineTab === 'recents') return renderRecentServers(c);
  if (S.onlineTab === 'friends') return renderFriends(c);
  if (S.onlineTab === 'host') { await renderHost(c); if (S.host.status && S.host.status.running) pollHost(); return; }
  if (!S.servers) S.servers = await api.invoke('servers:list');
  const trackOf = (s) => s.track && trackInstalled(s.track);
  const rows = S.servers.map((s, i) => {
    const t = s.track ? trackOf(s) : null;
    const trackLine = s.track ? (t ? `<span style="color:var(--ok)">${icon('check')} ${esc(s.track)}</span>` : `<span style="color:var(--warn)">${icon('alert')} ${esc(s.track)} — not installed</span>`) : '<span class="muted">No track set</span>';
    return `<div class="srv"><div class="srv-ico">${icon('globe')}</div>
      <div class="srv-txt"><div class="t">${esc(s.name || s.address)}</div><div class="m"><span class="mono">${esc(s.address)}</span> · ${trackLine}</div></div>
      <div class="jactions">${s.track && !t ? `<button class="btn btn-sm" data-srv-find="${i}">${icon('search')}Get track</button>` : ''}
        <button class="btn btn-sm btn-icon" data-srv-link="${i}" title="Copy join link">${icon('copy')}</button>
        <button class="btn btn-sm btn-icon" data-srv-edit="${i}" title="Edit">${icon('settings')}</button>
        <button class="btn btn-sm btn-primary" data-srv-join="${i}">${icon('play')}Join</button></div></div>`;
  }).join('');
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>Online</h2>${onlineTabs()}<span class="grow"></span><button class="btn" data-act="address-discovery">${icon('globe')}Automatic addresses</button></div>
    <div class="scroller"><div id="onlineAlert"></div><div class="online-layout"><section class="online-main">
      <div class="section-title" style="display:flex">Live servers<span class="grow"></span><span id="allSrvMeta" class="muted" style="text-transform:none;letter-spacing:0;font-weight:500"></span></div>
      <div id="allServers"><div class="loadmore"><div class="spinner"></div></div></div>
      </section><aside class="online-side">
      <div id="youAreOn"></div>
      <div id="friendsRiding"></div>
      <div class="section-title">Saved servers</div>
      ${S.servers.length ? `<div class="srv-list">${rows}</div>` : `<div class="set-card muted" style="text-align:center;padding:28px">Save servers you play on to join them in one click. Add the track a server runs and the app checks you have it before you join.</div>`}
      <div class="set-card" style="margin-top:18px"><h3>Join by address</h3><p>Paste a server address. The game opens and connects straight to it.</p>
        <div class="path-row join-row"><input class="input" id="joinAddr" placeholder="e.g. 123.45.67.89:54210" style="flex:1" spellcheck="false">
          <button class="btn" data-act="srv-save-new">${icon('star')}Save</button><button class="btn btn-primary" data-act="srv-join-new">${icon('play')}Join</button></div></div>
    </aside></div></div></div></div>`;
  drawYouAreOn();
  drawFriendsRiding();
  // Friends' live status feeds the 'Friends riding now' panel.
  (async () => { try { if (!S.friends) S.friends = await api.invoke('friends:list'); const st = await liveStatus(); if (st && st.service.connected) await refreshLiveList('friends'); } catch {} drawFriendsRiding(); })();
  drawLiveServers();
}

async function renderRecentServers(c) {
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Online</h2>${onlineTabs()}</div><div class="scroller"><div class="section-title">Recently played servers</div><div id="recentServers"><div class="loadmore"><div class="spinner"></div></div></div></div></div></div>`;
  try {
    const rows = await api.invoke('servers:recent'); S.recentServers = rows;
    const box = $('#recentServers'); if (!box) return;
    box.innerHTML = rows.length ? `<div class="srv-list">${rows.map((s, i) => `<div class="srv"><div class="srv-ico">${icon('clock')}</div><div class="srv-txt"><div class="t">${esc(s.name)}</div><div class="m">${esc(s.track || 'Track unknown')} · ${timeAgo(s.at)}${s.address ? ` · <span class="mono">${esc(s.address)}</span>` : ' · Address not discovered'}</div></div><div class="jactions"><button class="btn btn-sm btn-primary" data-recent-join="${i}" ${s.address ? '' : 'disabled'}>${icon('play')}Join</button></div></div>`).join('')}</div>` : '<div class="set-card muted">Servers appear here after you join them in MX Bikes with the CoreMX game plugin active.</div>';
  } catch (error) { const box = $('#recentServers'); if (box) box.innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(cleanErr(error))}</div></div>`; }
}
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-recent-join]'); if (!button) return;
  const server = S.recentServers?.[Number(button.dataset.recentJoin)];
  if (server?.address) joinServer(server.address, server);
});

// ---------- Plugin settings and automatic server addresses ----------
S.allSrv = { q: '' };
// Host World: friends can only join when the router lets them in (UPnP port mapping, src/lib/upnp.js).
function upnpCard(u = {}) {
  const line = u.enabled === false ? 'Off. Friends may get "connection timed out" unless you forward the port on your router yourself.'
    : u.state === 'open' ? `Port ${u.port} (UDP) is open on your router while you host.`
    : u.state === 'failed' ? `Couldn't open the port: ${esc(u.error || 'unknown error')}. Turn on UPnP in your router settings, or forward UDP ${u.port || 54210} to this PC.`
    : 'Opens when you host a game from MX Bikes and closes when you stop.';
  return `<div class="set-card"><h3>Open the game port while hosting</h3><p>When you host from MX Bikes (Host World), CoreMX asks your router (UPnP) to let friends in on UDP ${u.port || 54210}. The rule is removed when you stop hosting or close CoreMX.</p>
    <div class="path-row"><span class="${u.state === 'open' ? 'ok' : 'muted'}">${line}</span><span class="grow"></span><label class="toggle"><input type="checkbox" id="upnpToggle" ${u.enabled !== false ? 'checked' : ''}><span class="sw"></span></label></div>
    ${u.state === 'open' && u.doubleNat ? `<div class="notice warn" style="margin-top:10px">${icon('alert')}<div>Your router sits behind another router or the internet provider's modem (it has a home-network outside address). Open UDP ${u.port || 54210} on that modem too, forwarded to this router, or put the modem in bridge mode.</div></div>` : ''}
    <div class="path-row" style="margin-top:10px"><span class="${firewallClass(u.firewall)}" id="firewallLine">${firewallLine(u.firewall)}</span><span class="grow"></span>
      ${u.firewall?.state === 'blocked' ? `<button class="btn btn-primary" data-firewall-allow>${icon('check')}Allow MX Bikes</button>` : `<button class="btn" data-firewall-check>${icon('refresh')}Check firewall</button>`}</div></div>`;
}
// Windows Firewall: riders time out when it drops MX Bikes, even with the router port open.
function firewallLine(fw) {
  if (!fw) return 'Windows Firewall: checked when you host.';
  if (fw.state === 'blocked') return `${esc(fw.detail)}. Riders joining you will time out.`;
  return `${esc(fw.detail)}.`;
}
function firewallClass(fw) { return fw?.state === 'blocked' ? 'warn-text' : fw && fw.state !== 'unknown' ? 'ok' : 'muted'; }
async function renderPluginSettings(c) {
  c.innerHTML = `<div class="view"><div class="main"><div class="toolbar"><h2>Settings</h2>${settingsTabs()}</div><div class="scroller"><div class="settings" id="pluginSettings"><div class="loadmore"><div class="spinner"></div></div></div></div></div></div>`;
  try {
    const [online, plugins] = await Promise.all([api.invoke('online:status'), api.invoke('plugins:scan').catch(() => [])]);
    const box = $('#pluginSettings', c); if (!box) return;
    const row = (id, name, text, installed, version, update = false) => `<div class="set-card"><h3>${name}</h3><p>${text}</p><div class="path-row"><span class="${installed ? 'ok' : 'muted'}">${installed ? 'Installed' : 'Not installed'}${version ? ` · ${esc(version)}` : ''}</span><span class="grow"></span>${update || !installed ? `<button class="btn btn-primary" data-plugin-install="${id}">${icon('download')}${update ? 'Update' : 'Install'}</button>` : ''}${installed ? `<button class="btn" data-plugin-remove="${id}">${icon('trash')}Remove</button>` : ''}</div></div>`;
    box.innerHTML = `<p class="muted">Close MX Bikes before installing or removing plugins. Plugins load when the game starts.</p>
      ${row('presence', 'CoreMX presence', 'Reports your track, bike, server, riders and session stage to the manager and your friends.', online.plugin.installed, '', online.plugin.needsUpdate)}
      <p class="muted">The CoreMX plugin also saves server addresses from MX Bikes' Multiplayer list, so live servers and friends get a Join button.</p>
      ${upnpCard(online.upnp)}
      <div class="set-card"><h3>In-game overlay key</h3><p>Opens the CoreMX overlay on track, to change your outfit and bike livery. Changes apply within a second, even while MX Bikes is running.</p>
        <div class="path-row"><select id="overlayKey">${['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11'].map((k) => `<option ${k === overlayKeyName() ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        ${overlayKeyName() === 'F8' && plugins.some((p) => /^mxb_ragdoll\.dlo$/i.test(p.name) && p.enabled) ? `<div class="notice warn" style="margin-top:10px">${icon('alert')}<div>MX Bikes Ragdoll opens its own menu with F8 too. Pick another key so both don't open together.</div></div>` : ''}</div>`;
    box.addEventListener('click', async (e) => {
      const allow = e.target.closest('[data-firewall-allow]'), check = e.target.closest('[data-firewall-check]');
      if (!allow && !check) return;
      const button = allow || check; button.disabled = true;
      try {
        if (allow && !await confirmBox('Allow MX Bikes through Windows Firewall?', 'Riders joining your hosted game need MX Bikes to be let in. CoreMX adds an inbound rule for MX Bikes (UDP, all network types) and turns off any rule that blocks it. Windows will ask for administrator permission.', 'Allow MX Bikes')) { button.disabled = false; return; }
        await api.invoke(allow ? 'online:firewallAllow' : 'online:firewallCheck');
        if (allow) toast('MX Bikes is allowed through Windows Firewall', 'ok', 3000);
        await renderPluginSettings(c);
      } catch (err) { toast(esc(cleanErr(err)), 'err', 6000); button.disabled = false; }
    });
    $('#upnpToggle', box)?.addEventListener('change', async (e) => {
      try { await api.invoke('online:upnp', e.target.checked); toast(e.target.checked ? 'CoreMX opens the game port on your router while you host' : 'Router port opening turned off', 'ok', 2400); await renderPluginSettings(c); }
      catch (err) { toast(esc(cleanErr(err)), 'err'); }
    });
    $('#overlayKey', box)?.addEventListener('change', async (e) => {
      try { S.env = await api.invoke('settings:set', { overlayKey: e.target.value }); toast(`Overlay key set to <b>${esc(e.target.value)}</b>`, 'ok', 2200); await renderPluginSettings(c); }
      catch (err) { toast(esc(cleanErr(err)), 'err'); }
    });
    box.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-plugin-install], [data-plugin-remove]'); if (!button || button.disabled) return;
      const remove = !!button.dataset.pluginRemove, kind = button.dataset.pluginRemove || button.dataset.pluginInstall;
      const route = `online:plugin${remove ? 'Remove' : 'Install'}`;
      button.disabled = true;
      try { await api.invoke(route); toast(remove ? 'Plugin removed' : 'Plugin installed — restart MX Bikes to load it', 'ok'); await renderPluginSettings(c); }
      catch (e) { toast(esc(cleanErr(e)), 'err', 6000); button.disabled = false; }
    }, { once: false });
  } catch (e) { const box = $('#pluginSettings', c); if (box) box.textContent = cleanErr(e); }
}
async function addressDiscoveryDialog() {
  const m = modal({ title: 'Automatic server addresses', size: 'sm', body: '<div class="loadmore"><div class="spinner"></div></div>', foot: '<button class="btn" data-discovery-close>Close</button>' });
  $('[data-discovery-close]', m).onclick = () => m.close();
  async function draw() {
    const [st, online] = await Promise.all([api.invoke('servers:discovery'), api.invoke('online:status')]);
    if (!m.isConnected) return;
    const installed = online?.plugin?.installed && !online.plugin.needsUpdate;
    $('.modal-body', m).innerHTML = `<p>The CoreMX game plugin saves server addresses while MX Bikes' Multiplayer list loads. The manager matches your server to those addresses and shares the matching address with your friends.</p>
      ${installed ? `<div class="notice ${st.list ? 'ok' : 'info'}">${icon(st.list ? 'check' : 'info')}<div>${st.list ? `${st.list.servers.length} server addresses available.` : 'Open Multiplayer in MX Bikes. Addresses are saved automatically as the list loads.'}</div></div><p class="muted">Open the game browser again to discover new servers. Duplicate server names are left unresolved.</p><button class="btn" data-discovery-refresh>${icon('refresh')}Check again</button>`
      : `<div class="notice info">${icon('info')}<div>${online?.plugin?.needsUpdate ? 'Update the CoreMX game plugin in Settings → Plugins, then restart MX Bikes.' : 'Install the CoreMX game plugin in Settings → Plugins, then restart MX Bikes.'}</div></div>`}
      <p class="muted">Join launches the game directly into the selected server when the game is closed. Required tracks, bikes and any server password still apply.</p>`;
    const check = $('[data-discovery-refresh]', m);
    if (check) check.onclick = async () => { check.disabled = true; try { await api.invoke('online:refresh'); await draw(); await drawLiveServers(true); } catch (e) { toast(esc(cleanErr(e)), 'err'); check.disabled = false; } };
  }
  try { await draw(); } catch (e) { if (m.isConnected) $('.modal-body', m).textContent = cleanErr(e); }
}
api.on('servers:discovered', () => {
  if (S.view === 'online' && S.onlineTab === 'servers') drawLiveServers(true);
  if (S.view === 'friends') { S.live.friendsNext = 0; renderFriends($('#content')); }
});

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]');
  if (a && a.dataset.act === 'address-discovery') { await addressDiscoveryDialog(); return; }
});

function serverDialog(existing) {
  return new Promise((resolve) => {
    const s = existing || { name: '', address: '', track: '' };
    const m = modal({
      title: existing ? 'Edit server' : 'Save server', size: 'sm',
      body: `<div class="field" style="margin-bottom:12px"><label>Name</label><input class="input" id="svName" value="${esc(s.name)}" placeholder="My favourite server" style="width:100%"></div>
        <div class="field" style="margin-bottom:12px"><label>Address</label><input class="input mono" id="svAddr" value="${esc(s.address)}" placeholder="123.45.67.89:54210" style="width:100%"></div>
        <div class="field"><label>Track it runs (optional)</label><input class="input" id="svTrack" list="svTracks" value="${esc(s.track || '')}" placeholder="Pick or type a track" style="width:100%">
          <datalist id="svTracks">${S.items.filter((i) => i.group === 'tracks').map((i) => `<option value="${esc(i.title)}">`).join('')}</datalist></div>`,
      foot: `${existing ? '<button class="btn btn-danger" data-sv-del>Remove</button><span class="grow"></span>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-sv-ok>Save</button>`,
      onClose: () => resolve(null),
    });
    $('[data-sv-ok]', m).addEventListener('click', () => {
      const out = { name: $('#svName', m).value.trim(), address: $('#svAddr', m).value.trim(), track: $('#svTrack', m).value.trim() };
      if (!/^[a-z0-9.-]+:\d{2,5}$/i.test(out.address)) { toast('Address should look like 123.45.67.89:54210', 'err'); return; }
      const r = out; m.close(); resolve(r);
    });
    const del = $('[data-sv-del]', m);
    if (del) del.addEventListener('click', () => { m.close(); resolve('delete'); });
  });
}

async function saveServers() { S.servers = await api.invoke('servers:save', S.servers); renderOnline($('#content')); }

async function joinServer(address, server) {
  try { if (await confirmRiderBeforeGame('join') === 'cancel') return; }
  catch (e) { toast(esc(cleanErr(e)), 'err', 6000); return; }
  // Check the track first, so you don't land on a server without it.
  // A track counts by its name or its file id (the game's track id, e.g. DUNED.pkz for "KBOLTZ DUNED";
  // a locked track's name can't be read from its file).
  if (server && (server.track || server.trackId)) {
    const have = trackInstalled(server.track) || trackInstalled(server.trackId);
    if (!have) {
      const ok = await confirmBox('Track not installed', `<b>${esc(server.name || address)}</b> runs <b>${esc(server.track || server.trackId)}</b>, which you don't have. Find and install it first?`, 'Find the track');
      if (ok) { findTrack(server.track || server.trackId); return; }
    }
  }
  try { await api.invoke('game:join', address, server && server.name ? server.name : ''); toast(`Joining <b>${esc(server ? server.name || address : address)}</b>…`, 'ok', 3000); }
  catch (e) { toast(esc(cleanErr(e)), 'err', 6000); }
}

function findTrack(name) {
  S.getSrc = 'free'; S.browse.tab = 'tracks'; S.browse.query = name; S.browse.sort = 'relevance';
  S.browse.posts = []; S.browse.page = 0; S.browse.totalPages = 1; S.browse.req = (S.browse.req || 0) + 1;
  go('get');
}

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]');
  if (a && a.dataset.act === 'srv-join-new') { const v = $('#joinAddr').value.trim(); if (v) joinServer(v); return; }
  if (a && a.dataset.act === 'srv-save-new') {
    const r = await serverDialog({ name: '', address: $('#joinAddr').value.trim(), track: '' });
    if (r && r !== 'delete') { S.servers.push({ ...r, addedAt: Date.now() }); saveServers(); }
    return;
  }
  const j = e.target.closest('[data-srv-join]');
  if (j) { const s = S.servers[Number(j.dataset.srvJoin)]; joinServer(s.address, s); return; }
  const ed = e.target.closest('[data-srv-edit]');
  if (ed) {
    const i = Number(ed.dataset.srvEdit);
    const r = await serverDialog(S.servers[i]);
    if (r === 'delete') S.servers.splice(i, 1); else if (r) S.servers[i] = { ...S.servers[i], ...r };
    if (r) saveServers();
    return;
  }
  const lk = e.target.closest('[data-srv-link]');
  if (lk) { const s = S.servers[Number(lk.dataset.srvLink)]; navigator.clipboard.writeText(`mxbm://join/${s.address}`); toast('Join link copied — anyone with this app can click it to join', 'ok', 3000); return; }
  const f = e.target.closest('[data-srv-find]');
  if (f) findTrack(S.servers[Number(f.dataset.srvFind)].track);
});

// Join links (mxbm://join/ip:port)
async function handleJoinLink(addr) {
  if (!addr) return;
  const known = (S.servers || await api.invoke('servers:list')).find((s) => s.address === addr);
  if (await confirmBox('Join server', `Join <b>${esc(known ? known.name : addr)}</b> <span class="mono">${esc(addr)}</span>?`, 'Join')) joinServer(addr, known);
}

// Friends screen: see live.js
