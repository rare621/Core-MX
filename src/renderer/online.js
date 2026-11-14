/* global S, $, $$, esc, icon, toast, modal, confirmBox, cleanErr, render, debounce, api, go, haveMod, normName */
'use strict';
// ---------- Online: Servers (join / saved / links), Friends (front end), Ranked (mxb-ranked.com) ----------
S.onlineTab = 'servers';
S.servers = null;
S.friends = null;

function onlineTabs() {
  const t = (id, ic, l) => `<button class="${S.onlineTab === id ? 'active' : ''}" data-online-tab="${id}">${icon(ic)}${l}</button>`;
  return `<div class="seg-tabs">${t('servers', 'globe', 'Servers')}${t('host', 'play', 'Host')}${t('friends', 'user', 'Friends')}${t('ranked', 'star', 'Ranked')}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-online-tab]');
  if (b) { S.onlineTab = b.dataset.onlineTab; renderOnline($('#content')); }
});

async function renderOnline(c) {
  if (S.onlineTab === 'ranked') return renderRanked(c);
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
    <div class="toolbar"><h2>Online</h2>${onlineTabs()}</div>
    <div class="scroller"><div style="max-width:960px">
      <div id="youAreOn"></div>
      <div class="section-title" style="display:flex">Live servers<span class="grow"></span><span id="allSrvMeta" class="muted" style="text-transform:none;letter-spacing:0;font-weight:500"></span></div>
      <div id="allServers"><div class="loadmore"><div class="spinner"></div></div></div>
      <div class="section-title">Saved servers</div>
      ${S.servers.length ? `<div class="srv-list">${rows}</div>` : `<div class="set-card muted" style="text-align:center;padding:28px">Save servers you play on to join them in one click. Add the track a server runs and the app checks you have it before you join.</div>`}
      <div class="set-card" style="margin-top:18px"><h3>Join by address</h3><p>Paste a server address. The game opens and connects straight to it.</p>
        <div class="path-row"><input class="input" id="joinAddr" placeholder="e.g. 123.45.67.89:54210" style="flex:1;background:var(--raised)" spellcheck="false">
          <button class="btn" data-act="srv-save-new">${icon('star')}Save</button><button class="btn btn-primary" data-act="srv-join-new">${icon('play')}Join</button></div></div>
    </div></div></div></div>`;
  drawYouAreOn();
  drawLiveServers();
}

// ---------- All servers (FrostMod's copy of the game's server list) ----------
S.allSrv = { q: '', status: null };
async function drawAllServers(refresh) {
  const box = $('#allServers');
  if (!box) return;
  if (!S.allSrv.status || refresh) S.allSrv.status = await api.invoke('frostmod:status').catch((e) => ({ error: cleanErr(e) }));
  const st = S.allSrv.status;
  const meta = $('#allSrvMeta');
  if (st.error) { box.innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(st.error)}</div></div>`; return; }
  if (!st.list) {
    meta.textContent = '';
    const needsRestart = st.flagAdded || st.hookOn === false;
    box.innerHTML = st.installed
      ? `<div class="set-card"><div style="display:flex;gap:14px;align-items:flex-start">${icon('info')}<div><b>FrostMod is installed — ${needsRestart ? 'restart MX Bikes' : 'one more step'}</b>
          <div class="muted" style="font-size:13px;margin-top:3px;line-height:1.6">${needsRestart ? '<b>Close MX Bikes completely and start it again</b> — FrostMod only switches on the server list when the game starts.<br>' : ''}
            Then open <b>Multiplayer</b>, let the list load, and press the browser's <b>Refresh</b> once. FrostMod saves the list each time the browser refreshes, and it appears here automatically.</div>
          <div style="margin-top:12px;display:flex;gap:8px"><button class="btn btn-primary" data-act="frost-launch">${icon('play')}Launch MX Bikes</button><button class="btn btn-ghost" data-act="frost-remove">Remove FrostMod</button></div></div></div></div>`
      : `<div class="set-card"><h3>See every MX Bikes server</h3>
          <p>MX Bikes' full server list only comes from the game itself. <b>FrostMod</b> — a free, open-source plugin (also used by MXB App) — saves that list when you open the game's server browser, and this app reads it.</p>
          <div class="muted" style="font-size:12.5px;line-height:1.6;margin-bottom:14px">
            ${icon('info')} Installs <span class="mono">frostmod.dlo</span> into your game's <span class="mono">plugins</span> folder from its <a href="#" data-open="https://github.com/Frostn1/frostmod">official GitHub release</a>. It loads through the game's plugin system but also hooks some game functions, and includes an optional radar / rider-outline feature — some ranked or league admins may not allow mods like that. You can remove it any time.</div>
          <button class="btn btn-primary" data-act="frost-install">${icon('download')}Install FrostMod</button></div>`;
    return;
  }
  const all = st.list.servers;
  const q = S.allSrv.q.toLowerCase();
  const xs = q ? all.filter((s) => (s.name + ' ' + s.address).toLowerCase().includes(q)) : all;
  const saved = new Set((S.servers || []).map((s) => s.address));
  meta.innerHTML = `${all.length} servers · updated ${esc(timeAgo(st.list.at))}`;
  box.innerHTML = `<div class="filters" style="padding:0 0 12px"><div class="search wide">${icon('search')}<input id="allSrvQ" placeholder="Search servers by name…" value="${esc(S.allSrv.q)}" spellcheck="false"></div>
      <span class="count">${xs.length === all.length ? '' : `${xs.length} match${xs.length === 1 ? '' : 'es'}`}</span>
      <button class="btn btn-icon" data-act="frost-refresh" title="Reload list">${icon('refresh')}</button></div>
    ${Date.now() - st.list.at > 6 * 3600 * 1000 ? `<div class="notice info">${icon('info')}<div>This list is from ${esc(timeAgo(st.list.at))}. Open Multiplayer in MX Bikes to refresh it.</div></div>` : ''}
    <div class="srv-list">${xs.slice(0, 300).map((s) => `<div class="srv"><div class="srv-ico">${icon('globe')}</div>
      <div class="srv-txt"><div class="t">${esc(s.name)}</div><div class="m"><span class="mono">${esc(s.address)}</span></div></div>
      <div class="jactions">${saved.has(s.address) ? `<span class="badge ok" style="position:static">${icon('star')}Saved</span>` : `<button class="btn btn-sm btn-icon" data-all-save="${esc(s.address)}" title="Save">${icon('star')}</button>`}
        <button class="btn btn-sm btn-primary" data-all-join="${esc(s.address)}">${icon('play')}Join</button></div></div>`).join('') || '<div class="srv muted">No servers match.</div>'}</div>
    ${xs.length > 300 ? `<div class="muted" style="margin:8px 4px;font-size:12.5px">Showing 300 of ${xs.length} — search to narrow it down.</div>` : ''}`;
  const qi = $('#allSrvQ');
  qi.addEventListener('input', debounce(() => { S.allSrv.q = qi.value; drawAllServers().then(() => { const n = $('#allSrvQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 200));
}



document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]');
  if (a && a.dataset.act === 'frost-install') {
    if (!(await confirmBox('Install FrostMod', `Download <b>frostmod.dlo</b> from <a href="#" data-open="https://github.com/Frostn1/frostmod/releases/latest">github.com/Frostn1/frostmod</a> (latest release) into your MX Bikes <span class="mono">plugins</span> folder?`, 'Install'))) return;
    a.disabled = true; a.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>Installing…';
    try { const r = await api.invoke('frostmod:install'); toast(`FrostMod ${esc(r.version)} installed`, 'ok'); }
    catch (err) { toast(esc(cleanErr(err)), 'err', 6000); }
    drawAllServers(true);
    return;
  }
  if (a && a.dataset.act === 'frost-remove') {
    if (!(await confirmBox('Remove FrostMod', 'Move frostmod.dlo to the Recycle Bin?', 'Remove', true))) return;
    await api.invoke('frostmod:uninstall'); toast('FrostMod removed', 'ok'); drawAllServers(true); return;
  }
  if (a && a.dataset.act === 'frost-refresh') { drawAllServers(true); return; }
  if (a && a.dataset.act === 'frost-launch') { try { await api.invoke('game:launch'); toast('Starting MX Bikes — open Multiplayer to load the server list', 'info', 5000); } catch (err) { toast(esc(cleanErr(err)), 'err'); } return; }
  const j = e.target.closest('[data-all-join]');
  if (j) { const s = S.allSrv.status.list.servers.find((x) => x.address === j.dataset.allJoin); joinServer(s.address, { name: s.name, address: s.address }); return; }
  const sv = e.target.closest('[data-all-save]');
  if (sv) {
    const s = S.allSrv.status.list.servers.find((x) => x.address === sv.dataset.allSave);
    S.servers.push({ name: s.name, address: s.address, track: '', addedAt: Date.now() });
    S.servers = await api.invoke('servers:save', S.servers);
    toast(`Saved <b>${esc(s.name)}</b>`, 'ok', 1800);
    renderOnline($('#content'));
  }
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
  // Check the track first, so you don't land on a server without it.
  if (server && server.track) {
    const have = trackInstalled(server.track);
    if (!have) {
      const ok = await confirmBox('Track not installed', `<b>${esc(server.name || address)}</b> runs <b>${esc(server.track)}</b>, which you don't have. Find and install it first?`, 'Find the track');
      if (ok) { findTrack(server.track); return; }
    }
  }
  try { await api.invoke('game:join', address); toast(`Joining <b>${esc(server ? server.name || address : address)}</b>…`, 'ok', 3000); }
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
api.on('deeplink:join', handleJoinLink);
setTimeout(() => api.invoke('deeplink:pending').then(handleJoinLink).catch(() => {}), 1500);

// Friends screen: see live.js
