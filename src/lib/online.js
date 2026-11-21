// Live online data: reads what the game plugin (plugin/mxbm_presence.c) writes, reports it to the
// online service (server/mxbm-server.js) and reads back the shared server list and friends.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const paintsync = require('./paintsync');
const { MAX_FILE } = require('./gear-sync');

const PLUGIN = 'mxbm_presence.dlo';
const STATE_FILE = 'mxbm_presence.json';
const REPORT_EVERY = 30 * 1000;
const PAINT_EVERY = 60 * 1000;

// Live looks file for the plugin (see doSyncLooks below and plugin/mxbm_presence.c).
const LOOK_FIELDS = ['bikePaint', 'rider', 'helmet', 'helmetPaint', 'gogglesPaint', 'suitPaint', 'glovesPaint', 'boots', 'bootsPaint', 'protection', 'protectionPaint'];
// Not fetched from MXB Mods for you: bought, or tied to the owner's account.
const UNFETCHABLE = /paid|store-protected|tied to your account|account-bound/i;
const catalogKeys = require('./gear-keys');
const RELOAD_FOR = { bikePaint: 'bikepaints', helmet: 'helmets', helmetPaint: 'helmetpaints', gogglesPaint: 'helmetpaints', suitPaint: 'riderpaints', glovesPaint: 'riderpaints', boots: 'boots', bootsPaint: 'bootpaints', protection: 'protections', protectionPaint: 'protectionpaints' };
// "wait" lines tell the overlay why a rider's item isn't in your game yet: uploading (their CoreMX is
// sending it), offline (their CoreMX is closed), paid (not shared), bike (comes with a bike you don't
// have), failed. Older plugins skip these lines. status: rider id -> sync report (items, unavailable).
const WAIT_ITEM = { waiting: 'uploading', uploading: 'uploading', offline: 'offline', failed: 'failed', stalled: 'failed' };
function waitLines(lo, report, clean) {
  if (!report) return [];
  const out = [];
  for (const it of report.items || []) if (WAIT_ITEM[it.state]) out.push([WAIT_ITEM[it.state], it.value || it.label]);
  for (const u of report.unavailable || []) {
    if (u.state === 'have') continue;
    const find = u.find && { searching: 'installing', installing: 'installing', nomatch: 'nomatch', failed: 'nomatch', installed: 'nomatch' }[u.find.state];
    if (find) { out.push([find, String(u.label || '').replace(/^[^:]*:s*/, '')]); continue; }
    const code = u.included === 'bike' ? 'bike' : /paid|store-protected|tied to your account|account-bound/i.test(u.error || '') ? 'paid' : null;
    if (code) out.push([code, String(u.label || '').replace(/^[^:]*:\s*/, '')]);
  }
  return out.slice(0, 6).map(([code, label]) => ['wait', lo.num, clean(lo.bikeId), code, clean(label).slice(0, 40)].join('\t'));
}
function looksText(loadouts, reload, stamp, reports = {}) {
  const clean = (v) => String(v || '').replace(/[\t\r\n]/g, ' ').trim().slice(0, 63);
  const lines = [`coremx-looks 1 ${stamp}`, `reload\t${reload.join(',')}`];
  for (const lo of loadouts) {
    const cur = Object.fromEntries((lo.equipped || []).map((e) => [e.slot, e.value]));
    // The CoreMX name is the last column (older plugins read only the gear columns).
    lines.push(['look', lo.num, clean(lo.bikeId), ...LOOK_FIELDS.map((f) => clean(cur[f])), clean(lo.name).slice(0, 40)].join('\t'));
    lines.push(...waitLines(lo, reports[lo.id], clean));
  }
  return lines.join('\n') + '\n';
}

const JOIN_WINDOW = 5 * 60 * 1000; // a server we see within 5 min of an app join gets that join's address
const ADMIN_STEAM_ID = '76561198098586128';

function create({ store, userDir, installDir, appDir, modsDir, isGameRunning, steamId, steamName, currentOutfit, haveMod, resolveServerAddress = async () => null, defaultUrl, previousServiceUrls = [], onChange, onInstalled = () => {}, findGear = () => {}, gearStatus = () => null, gearStillMissing = () => {}, portMapper = null, firewall = null }) {
  let current = null;        // parsed plugin state, or null
  let gameRunning = false, pluginUpdating = false;
  let lastSent = '';
  let lastSentAt = 0;
  let lastError = null;
  let activeUsers = null;
  let timer = null;
  let paintTimer = null, looksTimer = null;
  let retryTimer = null;
  // waiting: friends whose CoreMX is uploading files you asked for ([{ id, name, files }]).
  const paint = { busy: false, error: null, shared: null, report: null, unavailable: [], progress: null, at: null, waiting: [] };
  let waitTimer = null;
  // Gear lists the running game must reload because files arrived outside a live-looks pass (friends
  // sync, Join): the plugin tries a missing name only once itself. Sent with the next looks file.
  const pendingReload = new Set();
  // Gear a rider couldn't send (too big, locked, tied to their account) that you didn't have: once you
  // have it (installed by hand, or by CoreMX from its MXB Mods page), the running game is asked to
  // reload that list, as it loaded its lists before the file was there.
  const seenMissing = new Set();
  function noteUnavailable(results) {
    for (const r of results || []) {
      const cur = Object.fromEntries((r.equipped || []).map((e) => [e.slot, e.value]));
      for (const u of r.unavailable || []) {
        if (u.included === 'bike' || !RELOAD_FOR[u.slot]) continue;
        const key = `${r.id}|${u.slot}|${String(cur[u.slot] || '').toLowerCase()}`;
        if (u.state === 'unavailable') {
          seenMissing.add(key);
          if (!UNFETCHABLE.test(u.error || '')) {
            findGear({ slot: u.slot, name: cur[u.slot], source: u.source || null, who: r.name || '', catalogKey: catalogKeys.keyForItem(u.slot, cur[u.slot], cur, r.bike) });
            if (gearStatus(u.slot, cur[u.slot])?.state === 'installed') gearStillMissing(u.slot, cur[u.slot]);
          }
        } else if (u.state === 'have' && seenMissing.delete(key)) pendingReload.add(RELOAD_FOR[u.slot]);
      }
    }
    annotate(results);
  }
  // Each missing item's MXB Mods fetch state (u.find: searching, installing, installed, nomatch, failed).
  function annotate(results) {
    for (const r of results || []) {
      const cur = Object.fromEntries((r.equipped || []).map((e) => [e.slot, e.value]));
      for (const u of r.unavailable || []) {
        const st = u.state === 'unavailable' && cur[u.slot] ? gearStatus(u.slot, cur[u.slot]) : null;
        if (st) u.find = st; else delete u.find;
      }
    }
  }
  // Gear CoreMX couldn't get by itself, from friends and from riders on your server: the Missing gear
  // window. One row per item, with who wears it.
  let looksReports = [];
  const DONE = new Set(['nomatch', 'failed', 'installed']);
  function needsYou() {
    const rows = new Map();
    for (const r of [...(paint.report || []), ...looksReports]) {
      const cur = Object.fromEntries((r.equipped || []).map((e) => [e.slot, e.value]));
      for (const u of r.unavailable || []) {
        const name = cur[u.slot];
        if (u.state !== 'unavailable' || !name || u.included === 'bike' || /paid|store-protected/i.test(u.error || '')) continue;
        if (!(u.find ? DONE.has(u.find.state) : /tied to your account|account-bound/i.test(u.error || ''))) continue;
        const key = `${u.slot}|${String(name).toLowerCase()}`;
        const row = rows.get(key) || { slot: u.slot, name, label: u.label, error: u.error, source: u.source || null, find: u.find || null, riders: [] };
        if (r.name && !row.riders.includes(r.name)) row.riders.push(r.name);
        rows.set(key, row);
      }
    }
    return [...rows.values()];
  }
  let needsYouSig = '';
  function noteNeedsYou() { const sig = JSON.stringify(needsYou()); if (sig !== needsYouSig) { needsYouSig = sig; onChange(status()); } }
  // A fetch moved on: show it in CoreMX and in the game.
  function refreshGearStatus() {
    annotate(paint.report);
    annotate(looksReports);
    onChange(status());
    if (current?.inEvent) { looksKey = ''; syncLooks(); }
  }
  function noteDownloads(results) {
    noteUnavailable(results);
    for (const r of results || []) for (const it of r.items || []) if (it.state === 'downloaded' && RELOAD_FOR[it.slot]) pendingReload.add(RELOAD_FOR[it.slot]);
    if (pendingReload.size && current?.inEvent) { looksKey = ''; syncLooks(); }
  }
  // Who is still uploading files you need; while anyone is, sync again in 20 seconds (not a minute).
  function noteWaiting(report) {
    paint.waiting = (report || []).map((lo) => ({ id: lo.id, name: lo.name || '', files: (lo.items || []).filter((it) => it.state === 'uploading' || it.state === 'waiting').length })).filter((w) => w.files);
    if (paint.waiting.length && !waitTimer) waitTimer = setTimeout(() => { waitTimer = null; syncPaints().catch(() => {}); }, 20 * 1000);
  }
  let progressAt = 0;
  let pluginCache = { key: '' };
  const pendingCalls = new Map();
  let retryKey = '', retryAt = 0;
  let adminKey = '';
  // Host World: forward the game port on the router (UPnP) while hosting; see ./upnp.js.
  const HOST_PORT = 54210, UPNP_RENEW = 20 * 60 * 1000;
  let mapper = portMapper;
  const upnp = { state: 'off', error: null, at: null, busy: false };
  async function syncPortMapping(hosting) {
    const want = hosting && cfg().upnp !== false;
    if (upnp.busy) return;
    if (!want) {
      if (upnp.state === 'open' || upnp.state === 'failed') {
        upnp.busy = true;
        try { if (mapper) await mapper.close(); } catch {}
        upnp.busy = false; upnp.state = 'off'; upnp.error = null; upnp.at = null; onChange(status());
      }
      return;
    }
    // Renew the lease; after a failure try again every few minutes, quietly.
    if (upnp.state === 'open' && Date.now() - upnp.at < UPNP_RENEW) return;
    if (upnp.state === 'failed' && Date.now() - upnp.at < 5 * 60 * 1000) return;
    upnp.busy = true;
    try { mapper = mapper || require('./upnp').create(); const m = await mapper.open(HOST_PORT); upnp.state = 'open'; upnp.error = null; upnp.doubleNat = !!(m && m.doubleNat); }
    catch (e) { upnp.state = 'failed'; upnp.error = e.message; mapper = portMapper; }
    upnp.busy = false; upnp.at = Date.now(); onChange(status());
  }
  // While hosting: is Windows Firewall letting riders in? (Checked when hosting starts, then every
  // 5 minutes; Settings > Plugins can check any time.) A blocked game times out for everyone.
  const fw = () => firewall || require('./firewall');
  const gameExe = () => require('./paths').findGameExe(installDir());
  async function checkFirewall() {
    upnp.firewall = { ...(await fw().check(gameExe()).catch(() => ({ state: 'unknown', detail: 'Windows Firewall could not be read' }))), at: Date.now() };
    onChange(status());
    return upnp.firewall;
  }
  async function hostChecks(hosting) {
    if (!hosting) { upnp.hostingSince = 0; return; }
    if (!upnp.hostingSince) upnp.hostingSince = Date.now();
    if (!upnp.firewall || upnp.firewall.at < upnp.hostingSince || Date.now() - upnp.firewall.at > 5 * 60 * 1000) await checkFirewall();
  }
  async function allowFirewall() {
    const exe = gameExe();
    if (!exe) throw new Error('Set the MX Bikes install folder in Settings first.');
    await fw().allow(exe);
    await checkFirewall();
    return status();
  }
  async function setUpnp(on) {
    setCfg({ upnp: !!on });
    upnp.at = 0;
    await syncPortMapping(!!stateForReport().hosting);
    return status();
  }
  const progress = (value) => { paint.progress = value; if (Date.now() - progressAt > 150 || value.loaded === 0) { progressAt = Date.now(); onChange(status()); } };

  const cfg = () => store.get('online') || {};
  const setCfg = (patch) => store.set('online', { ...cfg(), ...patch });
  // Only explicitly configured aliases refer to the same service and account database.
  const sameService = (url) => url === defaultUrl || previousServiceUrls.includes(url);

  const bundledPlugin = () => path.join(appDir, 'plugin', PLUGIN);
  const pluginPath = () => (installDir() ? path.join(installDir(), 'plugins', PLUGIN) : null);
  const statePath = () => (userDir() ? path.join(userDir(), STATE_FILE) : null);
  function pluginStatus() {
    const target = pluginPath(), source = bundledPlugin();
    const signature = (file) => { try { const st = fs.statSync(file); return `${st.mtimeMs}:${st.ctimeMs}:${st.size}`; } catch { return ''; } };
    const installed = target ? signature(target) : '', available = signature(source);
    const key = JSON.stringify([target, installed, source, available]);
    if (pluginCache.key !== key) {
      let needsUpdate = false;
      if (installed && available) {
        try { needsUpdate = !fs.readFileSync(target).equals(fs.readFileSync(source)); } catch {}
      }
      pluginCache = { key, installed: !!installed, available: !!available, needsUpdate };
    }
    return { installed: pluginCache.installed, available: pluginCache.available, needsUpdate: pluginCache.needsUpdate, path: target };
  }

  // ---------- backend calls ----------
  function busyError() {
    return new Error(`Online service is busy. Retrying in ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} seconds.`);
  }
  async function request(route, options) {
    const base = (cfg().url || '').replace(/\/+$/, '');
    if (!base) throw new Error('No online service set up');
    const key = base + ':' + (cfg().token || '');
    if (key === retryKey && Date.now() < retryAt) throw busyError();
    const headers = { ...options.headers };
    if (cfg().token) headers.authorization = `Bearer ${cfg().token}`;
    const res = await fetch(base + route, { ...options, headers })
      .catch((e) => { throw new Error(`Couldn't reach the online service (${e.cause ? e.cause.code || e.cause.message : e.message})`); });
    if (res.status === 429) {
      const header = res.headers?.get('retry-after');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? (Date.parse(header) - Date.now()) / 1000 : 60;
      retryKey = key; retryAt = Date.now() + Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000;
      await res.arrayBuffer?.();
      throw busyError();
    }
    return res;
  }
  // Until the account is verified with Steam (service v25+), only these work; the rest is not sent.
  const UNVERIFIED_OK = new Set(['GET /v1/health', 'GET /v1/me', 'POST /v1/auth/steam/start', 'POST /v1/auth/steam/poll', 'POST /v1/unregister',
    'GET /v1/notifications', 'POST /v1/notifications/read', 'POST /v1/notifications/seen', 'POST /v1/notifications/delete', 'GET /v1/admin/role']);
  function call(method, route, body) {
    if (cfg().token && cfg().verified === false && !UNVERIFIED_OK.has(`${method} ${route.split('?')[0]}`)) return Promise.reject(new Error('Verify your account with Steam to use CoreMX online.'));
    // Renderer polling and sync can ask for the same list at the same time.
    const key = JSON.stringify([cfg().url, cfg().token, method, route, body]);
    const share = method === 'GET' || route === '/v1/friends';
    if (share && pendingCalls.has(key)) return pendingCalls.get(key);
    const run = jsonCall(method, route, body).finally(() => { if (share) pendingCalls.delete(key); });
    if (share) pendingCalls.set(key, run);
    return run;
  }
  async function jsonCall(method, route, body) {
    const res = await request(route, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    const data = await res.json().catch(() => ({}));
    // The token stopped working (signed in elsewhere took the account back, or the account was
    // removed): sign in with Steam again.
    if (res.status === 401 && cfg().token && !route.startsWith('/v1/auth/')) { setCfg({ token: null, id: null, verified: null }); needsSignIn = true; onChange(status()); }
    // The service wants a Steam-verified account (v25+): stop asking for the rest until verified.
    if (res.status === 403 && data.code === 'verify' && cfg().token && cfg().verified !== false) { setCfg({ verified: false }); onChange(status()); }
    if (!res.ok) throw new Error(data.error || `Online service answered ${res.status}`);
    return data;
  }
  // Paint files: raw bytes by SHA-256.
  async function upload(sha, buf) {
    // Newer services hand out a link to upload straight to cloud storage (R2), so the file doesn't
    // travel through the service PC's connection. Older services answer 404 here: upload as before.
    const ask = await request(`/v1/files/${sha}/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
    const grant = ask.ok ? await ask.json().catch(() => ({})) : null;
    if (!ask.ok && ask.status !== 404) throw new Error(((await ask.json().catch(() => ({}))).error) || `Upload failed (${ask.status})`);
    if (grant && grant.existed) return;
    if (grant && grant.url) {
      const put = await fetch(grant.url, { method: 'PUT', body: buf, signal: AbortSignal.timeout(300000) })
        .catch((e) => { throw new Error(`Upload failed (${e.cause ? e.cause.code || e.cause.message : e.message})`); });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const done = await request(`/v1/files/${sha}/uploaded`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(120000) });
      if (!done.ok) { const d = await done.json().catch(() => ({})); throw new Error(d.error || `Upload check failed (${done.status})`); }
      return;
    }
    const res = await request(`/v1/files/${sha}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf, signal: AbortSignal.timeout(120000) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Upload failed (${res.status})`); }
  }
  async function download(sha, onProgress = () => {}) {
    const res = await request(`/v1/files/${sha}`, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const chunks = []; let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_FILE) throw new Error('Shared file exceeds the sync size limit');
      chunks.push(chunk); onProgress(size);
    }
    return Buffer.concat(chunks);
  }

  // ---------- plugin state ----------
  async function readState() {
    const p = statePath();
    let next = null;
    try { next = JSON.parse(await fsp.readFile(p, 'utf8')); } catch {}
    gameRunning = await isGameRunning();
    // An app update brings a new plugin, but Windows locks it while the game runs: replace the
    // installed copy as soon as the game is closed (only if one is installed; a removed plugin
    // stays removed).
    if (!gameRunning) updatePluginIfNeeded();
    if (!gameRunning) next = null; // stale file from a game that has closed
    if (next && next.inEvent && next.server) {
      // Remember which address this server name had when we joined it from the app.
      const known = cfg().addresses || {};
      const lj = cfg().lastJoin;
      // The plugin reads the exact address of the connected server from the game; it wins over
      // the game-list lookup (several servers can share one name) and remembered joins.
      const fromGame = /^(\d{1,3}\.){3}\d{1,3}:\d{2,5}$/.test(String(next.serverAddress || '')) ? next.serverAddress : null;
      const resolved = fromGame || await resolveServerAddress(next.server).catch(() => null);
      // Only remember the join address when the game landed on the server that was clicked (a join
      // that timed out, followed by joining another server in game, must not label that server).
      const sameServer = lj && (!lj.name || lj.name.toLowerCase() === next.server.toLowerCase());
      if (lj && Date.now() - lj.at < JOIN_WINDOW && sameServer && !resolved && !known[next.server]) {
        known[next.server] = lj.address;
        setCfg({ addresses: known, lastJoin: null });
      }
      // An address seen in the game's own server list wins and corrects an older remembered one.
      if (resolved && known[next.server] && known[next.server] !== resolved) { delete known[next.server]; setCfg({ addresses: known }); }
      // Resolve locally observed browser addresses on every poll, and report
      // them to friends too. Do not persist discovered entries beyond their TTL.
      next.serverAddress = resolved || known[next.server] || null;
      next.serverAddressSource = fromGame ? 'game' : resolved ? 'browser' : next.serverAddress ? 'saved' : null;
      const recent = store.get('recentServers') || [];
      const previous = recent.find((s) => s.name.toLowerCase() === next.server.toLowerCase());
      if (!previous || current?.server !== next.server || previous.address !== next.serverAddress || Date.now() - previous.at > 10 * 60 * 1000) {
        store.set('recentServers', [{ name: next.server, address: next.serverAddress, track: next.trackName || next.trackId || '', trackId: next.trackId || '', at: Date.now() }, ...recent.filter((s) => s.name.toLowerCase() !== next.server.toLowerCase())].slice(0, 10));
      }
    }
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    const enteredServer = next?.inEvent && next.server && (!current?.inEvent || current.server !== next.server);
    const bikeChanged = next?.inEvent && next.bikeId && current?.bikeId && next.bikeId !== current.bikeId;
    current = next;
    if (enteredServer || bikeChanged) syncPaints().catch(() => {});   // share the gear for this bike now
    if (enteredServer) setTimeout(() => syncLooks(), 15000);
    else if (!next?.inEvent && looksKey) clearLooks();
    if (changed) onChange(status());
    await syncPortMapping(!!stateForReport().hosting).catch(() => {});
    await hostChecks(!!stateForReport().hosting).catch(() => {});
    await report();
  }

  function stateForReport() {
    const s = current || {};
    let riderName = '', riderProfile = '', hostName = '', profileNumber = 0;
    try {
      const global = fs.readFileSync(path.join(userDir(), 'global.ini'), 'latin1');
      riderProfile = global.match(/^lastprofile=(.*)$/m)?.[1]?.trim() || '';
      if (riderProfile && riderProfile !== '.' && riderProfile !== '..' && !/[\\/\x00-\x1f]/.test(riderProfile)) {
        const profileText = fs.readFileSync(path.join(userDir(), 'profiles', riderProfile, 'profile.ini'), 'latin1');
        riderName = profileText.match(/^name=(.*)$/m)?.[1]?.trim() || '';
        hostName = profileText.match(/^hostsetup_name=(.*)$/m)?.[1]?.trim() || '';
        profileNumber = Number(profileText.match(/^race_number=(\d{1,5})\s*$/m)?.[1]) || 0;
      }
    } catch {}
    // Hosting from Host World: the server name is the session name from Host setup ([ui]
    // hostsetup_name in the profile). The service then uses the host's public IP; any address the
    // plugin read from the game is not the address friends need, so it is not sent.
    const hosting = !!(s.inEvent && s.server && hostName && hostName.toLowerCase() === String(s.server).trim().toLowerCase());
    // On a server you didn't host and the game has received nothing for 30 seconds: the server closed or
    // dropped you (the game may sit on a "connection lost" screen, still in the event). Reported as off
    // the server so it doesn't stay on the Online list. Hosting is left out: an empty lobby is quiet.
    if (!hosting && s.inEvent && s.server && connectionLost()) {
      return { inGame: gameRunning, inEvent: false, server: null, serverAddress: null, serverAddressSource: null, trackId: '', trackName: '', category: '', bikeName: '', type: 0, session: null,
        riderName, riderProfile, gameName: '', raceNumber: null, bikeId: '', riders: [], connectionLost: true };
    }
    return {
      inGame: gameRunning, inEvent: !!s.inEvent,
      server: s.server || null, serverAddress: hosting ? null : s.serverAddress || null,
      serverAddressSource: hosting ? null : s.serverAddressSource || null,
      trackId: s.trackId || '', trackName: s.trackName || '', category: s.category || '', bikeName: s.bikeName || '', type: s.type || 0,
      session: s.inEvent && Number.isInteger(s.session) && s.session >= 0 && s.session <= 7 ? s.session : null,
      riderName, riderProfile,
      // This app's plugin notices when the server is gone (silence check), so the service may list it.
      connCheck: pluginChecksConnection(),
      // The name MX Bikes shows for you on the server (read from the game by the plugin).
      gameName: s.inEvent ? String(s.rider || '').slice(0, 64) : '',
      // Race number and bike in game, so other CoreMX users can find this rider in their game
      // (live looks). The plugin reads the number from the game; the profile is the fallback.
      raceNumber: s.inEvent ? (Number(s.raceNumber) || profileNumber || null) : null, bikeId: s.inEvent ? s.bikeId || '' : '',
      // (The plugin's server type is not a host flag: seen as 1 and 2 while hosting. Host World has
      // no port setting, so the game's default port 54210 is used.)
      ...(hosting ? { hosting: true, hostPort: 54210, ...publicAddress(), ...(lanAddress ? { hostLan: `${lanAddress}:54210` } : {}) } : {}),
      riders: (s.riders || []).map((r) => ({ name: r.name, bike: r.bike, category: r.category })),
    };
  }

  // The plugin's network status (mxbm_stun.json, written every 10 s): rxAgo = ms since the game last
  // received anything. Only a fresh status from a plugin that reports it counts.
  function pluginChecksConnection() {
    try { return 'rxAgo' in JSON.parse(fs.readFileSync(path.join(userDir(), 'mxbm_stun.json'), 'utf8')); } catch { return false; }
  }
  function connectionLost() {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(userDir(), 'mxbm_stun.json'), 'utf8'));
      return Number.isFinite(st.rxAgo) && st.rxAgo >= 30000 && Date.now() - st.at < 30000;
    } catch { return false; }
  }
  // The game's outside IP:port as seen by a STUN server (the plugin asks from the game's own socket
  // while hosting); routers often map 54210 to another outside port, which is what friends must use.
  function publicAddress() {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(userDir(), 'mxbm_public.json'), 'utf8'));
      if (/^(\d{1,3}\.){3}\d{1,3}:\d{2,5}$/.test(p.address) && Date.now() - p.at < 6 * 60 * 1000) return { hostAddress: p.address };
    } catch {}
    return {};
  }
  // MX Bikes servers are IPv4. When this PC reaches the service over IPv6, the service can't see
  // the IPv4 address friends must join, so a hosting app makes one request forced over IPv4.
  let hostIpAt = 0;
  // This PC's address on its home network (the route a UDP socket would take; nothing is sent).
  let lanAddress = null, lanAt = 0;
  function localAddress() {
    return new Promise((resolve, reject) => {
      const socket = require('dgram').createSocket('udp4');
      socket.on('error', (e) => { try { socket.close(); } catch {} reject(e); });
      socket.connect(53, '1.1.1.1', () => { const { address } = socket.address(); socket.close(); resolve(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) ? address : null); });
    });
  }
  function postOverIPv4(route) {
    const base = (cfg().url || '').replace(/\/+$/, '');
    if (!base || !cfg().token) return Promise.resolve(null);
    const url = new URL(base + route), lib = url.protocol === 'https:' ? require('https') : require('http');
    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method: 'POST', family: 4, timeout: 10000, headers: { authorization: `Bearer ${cfg().token}`, 'content-type': 'application/json', 'content-length': 2 } }, (res) => {
        let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end('{}');
    });
  }
  async function report(force) {
    const c = cfg();
    if (!c.url || !c.token) return;
    const state = stateForReport();
    if (state.hosting && Date.now() - lanAt > 5 * 60 * 1000) {
      lanAt = Date.now();
      lanAddress = await localAddress().catch(() => null);
    }
    if (state.hosting) {
      if (lanAddress) state.hostLan = `${lanAddress}:54210`;
      else delete state.hostLan;
    }
    const key = JSON.stringify(state);
    // The manager stays online even with MX Bikes closed. Keep its heartbeat alive.
    if (!force && key === lastSent && Date.now() - lastSentAt < REPORT_EVERY) return;
    // Every app tells the service its IPv4 now and then (hosts for their address; riders so a host on
    // their own home network can be joined at its local address), even when it talks over IPv6.
    if (Date.now() - hostIpAt > 5 * 60 * 1000) { hostIpAt = Date.now(); await postOverIPv4('/v1/hostip').catch(() => {}); }
    try {
      const result = await call('POST', '/v1/presence', { name: steamName() || c.name || '', share: c.share !== false, state });
      activeUsers = Number.isInteger(result.activeUsers) ? result.activeUsers : null;
      // Someone needs files you wear that aren't uploaded yet: share now (uploads only those).
      if (Array.isArray(result.upload) && result.upload.length && c.paintSync !== false) syncPaints().catch(() => {});
      lastSent = key; lastSentAt = Date.now(); lastError = null;
      onChange(status());
    } catch (e) { lastError = e.message; activeUsers = null; onChange(status()); }
  }

  function start() {
    const p = statePath();
    if (p) fs.watchFile(p, { interval: 2000 }, () => readState().catch(() => {}));
    timer = setInterval(() => readState().catch(() => {}), 10000);
    // While on a server, other riders' changes are picked up every 20 seconds.
    looksTimer = setInterval(() => { if (current?.inEvent && current.server) syncLooks(); }, 20 * 1000);
    readState().catch(() => {});
    paintTimer = setInterval(() => { syncPaints().catch(() => {}); syncLaps().catch(() => {}); }, PAINT_EVERY);
    // Not signed in yet (service was down): try again every minute, quietly.
    retryTimer = setInterval(() => { const c = cfg(); if (defaultUrl && !c.token && !c.optedOut && !needsSignIn && !signing) connect().then(() => { lastError = null; onChange(status()); }).catch(() => {}); }, 60 * 1000);
    // A built-in service address (online.config.json): connect to it without asking.
    const c = cfg();
    if (c.url && defaultUrl && c.url !== defaultUrl) setCfg({ url: defaultUrl, ...(sameService(c.url) ? {} : { token: null, id: null }) });
    if (defaultUrl && !cfg().token && !c.optedOut) connect().catch((e) => { lastError = e.message; onChange(status()); });
    else if (c.token) { syncPaints().catch(() => {}); checkVerified(); }   /* already online: is the account Steam-verified? */
    // Existing installs otherwise keep the old DLO forever after an app upgrade.
    // Windows locks loaded plugins: never replace one while the game is open.
    updatePluginIfNeeded();
  }
  function stop() { if (timer) clearInterval(timer); if (paintTimer) clearInterval(paintTimer); if (looksTimer) clearInterval(looksTimer); if (retryTimer) clearInterval(retryTimer); const p = statePath(); if (p) fs.unwatchFile(p); return closePort(); }
  // Removes the router mapping (app closing).
  async function closePort() { if (mapper && upnp.state === 'open') { upnp.state = 'off'; await mapper.close().catch(() => {}); } }

  // ---------- public ----------
  function status() {
    const c = cfg();
    return {
      plugin: pluginStatus(),
      game: { running: gameRunning },
      presence: current,
      service: { url: c.url || '', defaultUrl: defaultUrl || '', connected: !!c.token, id: c.id || null, name: steamName() || c.name || '', share: c.share !== false, error: lastError, activeUsers,
        needsSignIn: !c.token && needsSignIn, signingIn: signing ? { confirmed: signing.confirmed } : null, verified: c.token ? (c.verified ?? null) : null },
      serverShare: c.serverShare !== false,
      upnp: { enabled: c.upnp !== false, state: upnp.state, error: upnp.error, at: upnp.at, port: HOST_PORT, doubleNat: !!upnp.doubleNat, firewall: upnp.firewall || null, hosting: !!upnp.hostingSince },
      paintSync: { enabled: c.paintSync !== false, busy: paint.busy, error: paint.error, shared: paint.shared, unavailable: paint.unavailable, progress: paint.progress, friends: paint.report, at: paint.at, received: Object.keys(c.received || {}).length, waiting: paint.waiting, needsYou: needsYou() },
    };
  }

  // One plugin update at a time, whether started at app start or when the game closes.
  function updatePluginIfNeeded() {
    if (!pluginUpdating && !pluginStatus().needsUpdate && pluginStatus().installed) ensureOverlayFont().catch(() => {});
    if (pluginUpdating || !pluginStatus().needsUpdate) return pluginUpdating || Promise.resolve();
    pluginUpdating = installPlugin().catch(() => {}).finally(() => { pluginUpdating = false; onChange(status()); });
    return pluginUpdating;
  }
  async function installPlugin() {
    const src = bundledPlugin(), dst = pluginPath();
    if (!fs.existsSync(src)) throw new Error('The plugin hasn\'t been built yet (plugin/mxbm_presence.dlo is missing).');
    if (!dst) throw new Error('Set the game install folder in Settings first.');
    if (await isGameRunning()) throw new Error('Close MX Bikes first — the game only loads plugins when it starts.');
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
    await ensureOverlayFont().catch(() => {});
    return status();
  }
  // The overlay draws text with the game's own font, registered by the plugin from
  // pluginsmxbm_datamain.fnt. The plugin copies it from the loose uimain.fnt, but some installs
  // only have it inside ui.pkz, so CoreMX puts it in place (a local copy of the player's own file).
  async function ensureOverlayFont() {
    const dst = pluginPath(), gameDir = installDir();
    if (!dst || !gameDir) return;
    const font = path.join(path.dirname(dst), 'mxbm_data', 'main.fnt');
    if (fs.existsSync(font)) return;
    const loose = path.join(gameDir, 'ui', 'main.fnt');
    let data = null;
    if (fs.existsSync(loose)) data = await fsp.readFile(loose);
    else if (fs.existsSync(path.join(gameDir, 'ui.pkz'))) {
      data = await require('./zipread').withZip(path.join(gameDir, 'ui.pkz'), async (entries, read) => {
        const entry = entries.find((e) => e.fileName.split('\\').join('/').toLowerCase() === 'ui/main.fnt');
        return entry ? read(entry, 8 * 1024 * 1024) : null;
      });
    }
    if (!data) return;
    await fsp.mkdir(path.dirname(font), { recursive: true });
    await fsp.writeFile(font, data);
  }
  async function removePlugin() {
    const dst = pluginPath();
    if (await isGameRunning()) throw new Error('Close MX Bikes first.');
    if (dst && fs.existsSync(dst)) await fsp.rm(dst);
    return status();
  }

  // ---------- Friends leaderboard ----------
  // Your best laps (from MX Bikes' records) are sent when they change, at most every few minutes.
  let lapsSent = '', lapsAt = 0;
  async function syncLaps(force = false) {
    const c = cfg();
    if (!c.token || c.share === false || (!force && Date.now() - lapsAt < 4 * 60 * 1000)) return;
    lapsAt = Date.now();
    const laps = require('./laps').readBestLaps(userDir());
    const key = JSON.stringify(laps);
    if (!force && key === lapsSent) return;
    try { await call('POST', '/v1/laps', { laps }); lapsSent = key; } catch {}
  }
  async function leaderboard() {
    if (!cfg().token) throw new Error('Sign in with Steam to see your friends\' lap times.');
    await syncLaps(true).catch(() => {});
    return call('GET', '/v1/leaderboard');
  }

  // ---------- Sign in with Steam ----------
  // The service has Steam confirm the account (Steam's own sign-in page in the browser); nothing is
  // registered until the player chooses to. Older services (before v24) still use the old register.
  let needsSignIn = false, signing = null;
  const steamSignIn = (health) => Number(health?.version) >= 24 || (health?.features || []).includes('steam-signin');
  async function signIn(open) {
    if (!defaultUrl) throw new Error('This copy of the app has no online service built in.');
    const sid = steamId();
    if (!sid) throw new Error('Open Steam and sign in on this PC first: CoreMX uses the Steam account you play MX Bikes on.');
    const prev = cfg();
    if (prev.url !== defaultUrl) setCfg({ url: defaultUrl, token: null, id: null });
    const r = await call('POST', '/v1/auth/steam/start', { steamId: sid, name: steamName() || prev.name || '' });
    const mine = { state: r.state, code: null, confirmed: false };
    signing = mine; onChange(status());
    try {
      await open(r.url);
      const until = Date.now() + 10 * 60 * 1000;
      while (signing === mine && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (signing !== mine) break;
        const p = await call('POST', '/v1/auth/steam/poll', { state: r.state, secret: r.secret, ...(mine.code ? { code: mine.code } : {}) });
        if (p.done) {
          setCfg({ url: defaultUrl, token: p.token, id: p.id, name: p.name || steamName() || '', verified: true, optedOut: false });
          needsSignIn = false; lastError = null; lastSent = '';
          signing = null; onChange(status());
          await readState().catch(() => {});
          syncFriends().catch(() => {});
          syncPaints().catch(() => {});
          return status();
        }
        if (p.confirmed && !mine.confirmed) { mine.confirmed = true; onChange(status()); }
      }
      if (signing !== mine) throw new Error('Sign-in cancelled.');
      throw new Error('Steam sign-in timed out. Try again.');
    } finally { if (signing === mine) { signing = null; onChange(status()); } }
  }
  // The browser handed back the code (mxbm://signin/<state>/<code>), on this PC.
  function signInCode(state, code) { if (signing && signing.state === state) { signing.code = code; return true; } return false; }
  function cancelSignIn() { signing = null; onChange(status()); return status(); }
  // Whether Steam has confirmed this account (accounts made by apps before 1.0.48 are not).
  async function checkVerified() {
    if (!cfg().token) return;
    try { const me = await call('GET', '/v1/me'); if (cfg().verified !== !!me.verified) { setCfg({ verified: !!me.verified }); onChange(status()); } }
    catch {}
  }

  // Go online with this PC's account. Always the built-in service (online.config.json); users never
  // pick an address. Without an account yet, a current service needs Sign in with Steam (see signIn).
  async function connect(_url, name) {
    if (!defaultUrl) throw new Error('This copy of the app has no online service built in.');
    const u = defaultUrl;
    if (!/^https?:\/\/[^\s/]+(:\d+)?$/i.test(u)) throw new Error('The address should look like http://12.34.56.78:8787');
    const sid = steamId();
    if (!sid) throw new Error('Sign in to Steam on this PC first — your Steam ID is your friend code.');
    const prev = cfg();
    name = steamName() || name || prev.name || '';
    setCfg({ url: u, token: sameService(prev.url) ? prev.token : null, id: sameService(prev.url) ? prev.id : null, name, optedOut: false });
    const health = await call('GET', '/v1/health');
    if (!cfg().token) {
      if (steamSignIn(health)) { needsSignIn = true; lastError = null; onChange(status()); return status(); }
      const r = await call('POST', '/v1/register', { steamId: sid, name: name || '' });
      setCfg({ token: r.token, id: r.id });
    }
    needsSignIn = false;
    if (steamSignIn(health)) checkVerified();
    lastSent = '';
    await readState(); // reads the game state, then reports it
    await syncFriends().catch(() => {});
    syncPaints().catch(() => {});
    return status();
  }
  async function disconnect() {
    if (cfg().token) await call('POST', '/v1/unregister').catch(() => {});
    setCfg({ token: null, id: null, optedOut: true });
    adminKey = '';
    return status();
  }
  function setShare(share) { setCfg({ share: !!share }); lastSent = ''; report(true).catch(() => {}); return status(); }

  async function servers() {
    const r = await call('GET', '/v1/servers');
    const known = cfg().addresses || {};
    // Services before v5 retained server rows for twenty minutes. Treat a row
    // as live only while a manager heartbeat could still be active, so an old
    // server copy cannot make departed test sessions look real.
    const freshAfter = Date.now() - 2 * 60 * 1000;
    const servers = (r.servers || []).filter((s) => !s.lastSeen || Number(s.lastSeen) >= freshAfter)
      // A remembered address (by name) only when one server has that name: rows can share a name.
      .map((s, i, all) => ({ ...s, address: s.address || (all.filter((o) => o.name === s.name).length === 1 ? known[s.name] : null) || null }));
    return { at: r.at, servers };
  }
  async function syncFriends() {
    const ids = (store.get('friends') || []).map((f) => f.code).filter(Boolean);
    return (await call('POST', '/v1/friends', { ids })).friends || [];
  }
  // The Friends cards need the latest shared file list even between automatic
  // downloads. Reinspect local files only when a friend's loadout changes, or
  // when the player explicitly refreshes after installing something locally.
  const gearKeys = new Map();
  const gearKey = (lo) => JSON.stringify([lo.bike, (lo.items || []).map((it) => [it.slot, it.path, it.sha256]), lo.equipped, lo.unavailable]);
  async function refreshFriendGear(force = false) {
    if (!cfg().token) return paint.report || [];
    const { loadouts = [] } = await call('GET', '/v1/loadouts?pending=1');
    const previous = new Map((paint.report || []).map((lo) => [lo.id, lo]));
    const next = [];
    let changed = loadouts.length !== previous.size;
    const seen = new Set();
    for (const lo of loadouts) {
      const key = gearKey(lo) + (lo.items || []).map((it) => it.available === false ? '0' : '1').join('') + (lo.online ? 'on' : 'off');
      const previousKey = gearKeys.get(lo.id);
      seen.add(lo.id);
      if (!force && previousKey === key && previous.has(lo.id)) {
        next.push(previous.get(lo.id));
        continue;
      }
      const [checked] = await paintsync.listFriends({ call, modsDir: modsDir(), received: cfg().received || {}, have: haveMod, preloaded: [lo] });
      // Not uploaded yet: say whether their CoreMX is online to send it (asked for by the next sync).
      for (const it of checked.items) if (it.state === 'waiting' && cfg().paintSync !== false) it.state = paintsync.pendingState(it.sha256, lo.online !== false);
      next.push(checked);
      gearKeys.set(lo.id, key);
      if (!previous.has(lo.id) || previousKey !== key || JSON.stringify(previous.get(lo.id).items.map((it) => [it.state, it.needs, it.error])) !== JSON.stringify(checked.items.map((it) => [it.state, it.needs, it.error]))) changed = true;
    }
    for (const id of gearKeys.keys()) if (!seen.has(id)) gearKeys.delete(id);
    markNeeded(next);
    if (changed) { paint.report = next; onChange(status()); }
    return changed ? next : paint.report || [];
  }
  // Share your outfit's paints, then fetch mutual friends' paints you don't have.
  let paintRun = null;
  function syncPaints(friendId) {
    if (friendId && !(store.get('friends') || []).some((f) => f.code === friendId)) return Promise.reject(new Error('Add this rider as a friend first'));
    if (paintRun) return friendId ? paintRun.then(() => syncPaints(friendId)) : paintRun;
    paintRun = doSyncPaints(friendId).finally(() => { paintRun = null; });
    return paintRun;
  }
  async function doSyncPaints(friendId) {
    const c = cfg();
    if (!c.token || c.paintSync === false && !friendId) return status();
    paint.busy = true; onChange(status());
    try {
      progress({ phase: 'checking', label: 'Checking equipped files', completed: 0, total: 0, friendId });
      const health = await call('GET', '/v1/health');
      if (health.version < 5) throw new Error('Update the online server using the new mxbm-online-service.zip (version 5) to enable accurate live-server status, gear and tyre sync');
      await syncFriends();
      // In a session, share the gear for the bike you are riding (your profile keeps gear per bike;
      // its "current bike" can be another one), so riders on your server can apply it.
      const o = await currentOutfit(current?.inEvent && current.bikeId ? current.bikeId : null);
      if (o) {
        const shared = await paintsync.share({ call, upload, modsDir: modsDir(), prof: o.prof, bike: o.bike, bikeName: o.bikeName, appearance: o.appearance, protectedPaths: o.protectedPaths || [], stockPkz: o.stockPkz || null, sourceFor: o.sourceFor, onProgress: progress });
        paint.shared = shared.items; paint.unavailable = shared.unavailable;
      }
      const received = { ...(cfg().received || {}) };
      const results = await paintsync.fetchFriends({ call, download, modsDir: modsDir(), received, have: haveMod, friendId, onProgress: progress });
      paintsync.touchReceived(received, results);
      paint.report = friendId ? [...(paint.report || []).filter((p) => p.id !== friendId), ...results] : results;
      noteWaiting(paint.report);
      setCfg({ received });
      if (results.some((p) => p.items.some((it) => it.state === 'downloaded'))) await onInstalled();
      noteDownloads(results);
      paint.error = null; paint.at = Date.now();
    } catch (e) { paint.error = e.message; }
    paint.busy = false; paint.progress = null;
    onChange(status());
    return status();
  }
  async function friendLoadout(friendId) {
    if (!(store.get('friends') || []).some((f) => f.code === friendId)) throw new Error('Add this rider as a friend first');
    await syncFriends();
    const results = await paintsync.listFriends({ call, modsDir: modsDir(), received: cfg().received || {}, have: haveMod, friendId });
    annotate(results);
    if (results[0]) {
      const old = (paint.report || []).find((lo) => lo.id === friendId);
      const viewKey = (lo) => JSON.stringify([lo.bike, (lo.items || []).map((it) => [it.sha256, it.state, it.needs, it.error]), lo.equipped, lo.unavailable]);
      if (!old || viewKey(old) !== viewKey(results[0])) {
        paint.report = [...(paint.report || []).filter((lo) => lo.id !== friendId), results[0]];
        onChange(status());
      }
      gearKeys.delete(friendId);
    }
    return results[0] || null;
  }
  async function setPaintSync(on) {
    setCfg({ paintSync: !!on });
    if (cfg().token) await call('POST', '/v1/paintshare', { share: !!on }).catch(() => {});
    if (on) syncPaints().catch(() => {});
    return status();
  }
  function markNeeded(reports) {
    const received = { ...(cfg().received || {}) };
    if (paintsync.touchReceived(received, reports)) setCfg({ received });
  }
  async function removeReceived() {
    const received = { ...(cfg().received || {}) };
    const n = await paintsync.removeReceived(modsDir(), received);
    setCfg({ received });
    return { removed: n, status: status() };
  }

  // Riders on the same server who use the app (plugin report or Steam name on the rider list).
  // where: { id, address } of the server row (servers can share a name; see server/mxbm-server.js).
  async function serverRiderLoadouts(server, where = {}) {
    if (!cfg().token) throw new Error('Go online first to see riders on this server');
    const health = await call('GET', '/v1/health');
    if (health.version < 6) throw new Error('Update the online server (mxbm-online-service.zip) to sync gear from riders on a server');
    return (await call('POST', '/v1/server-riders', { server, pending: true, id: where.id, address: where.address })).loadouts || [];
  }
  async function serverRiders(server, where) {
    const loadouts = await serverRiderLoadouts(server, where);
    const report = await paintsync.listFriends({ call, modsDir: modsDir(), received: cfg().received || {}, have: haveMod, preloaded: loadouts });
    markNeeded(report);
    noteUnavailable(report);
    await paintsync.requestMissing(call, report); // their owners start uploading now
    return report.map((r) => ({ ...r, via: (loadouts.find((l) => l.id === r.id) || {}).via || 'plugin' }));
  }
  async function syncServerRiders(server, ids, where) {
    const wanted = new Set(ids || []);
    if (paintRun) await paintRun.catch(() => {});
    const loadouts = (await serverRiderLoadouts(server, where)).filter((l) => wanted.has(l.id));
    if (!loadouts.length) return [];
    paint.busy = true; onChange(status());
    try {
      const received = { ...(cfg().received || {}) };
      const results = await paintsync.fetchFriends({ call, download, modsDir: modsDir(), received, have: haveMod, preloaded: loadouts, onProgress: progress });
      paintsync.touchReceived(received, results);
      setCfg({ received });
      if (results.some((p) => p.items.some((it) => it.state === 'downloaded'))) await onInstalled();
      noteDownloads(results);
      return results;
    } finally { paint.busy = false; paint.progress = null; onChange(status()); }
  }
  // ---------- live looks ----------
  // While you ride on a server, other CoreMX users there are shown in your game with their own gear:
  // their free files are downloaded, then the plugin repaints them (liveries and paints at once) or
  // has the game rebuild them (a different helmet or boots). The plugin reads mxbm_looks.txt; see
  // plugin/mxbm_presence.c. Only riders on the bike their shared loadout is for are included.
  let looksRun = null, looksKey = '';
  function looksPath() { return path.join(userDir(), 'mxbm_looks.txt'); }
  function clearLooks() { looksKey = ''; looksReports = []; noteNeedsYou(); fsp.rm(looksPath(), { force: true }).catch(() => {}); }
  function syncLooks() {
    if (looksRun) return looksRun;
    looksRun = doSyncLooks().catch((e) => { paint.looksError = e.message; }).finally(() => { looksRun = null; });
    return looksRun;
  }
  async function doSyncLooks() {
    const c = cfg(), s = current;
    if (!c.token || c.paintSync === false || !gameRunning || !s || !s.inEvent || !s.server) { if (looksKey) clearLooks(); return; }
    const all = await serverRiderLoadouts(s.server);
    const riders = all.filter((l) => l.via === 'plugin' && Number(l.num) > 0 && l.bikeId && l.bike && l.bikeId.toLowerCase() === l.bike.toLowerCase());
    if (!riders.length) { if (looksKey) clearLooks(); return; }
    const received = { ...(cfg().received || {}) };
    const results = await paintsync.fetchFriends({ call, download, modsDir: modsDir(), received, have: haveMod, preloaded: riders, onProgress: () => {} });
    paintsync.touchReceived(received, results);
    setCfg({ received });
    noteUnavailable(results);
    looksReports = results;
    noteNeedsYou();
    const reload = new Set(pendingReload);
    pendingReload.clear();
    for (const r of results) for (const it of r.items || []) if (it.state === 'downloaded' && RELOAD_FOR[it.slot]) reload.add(RELOAD_FOR[it.slot]);
    if (reload.size) await onInstalled();
    const reports = Object.fromEntries(results.map((r) => [r.id, r]));
    const states = results.map((r) => [r.id, (r.items || []).map((it) => it.state), (r.unavailable || []).map((u) => [u.state, u.find?.state])]);
    const key = JSON.stringify([riders.map((r) => [r.num, r.bikeId, r.equipped]), states]) + [...reload].join();
    if (key === looksKey && !reload.size) return;
    looksKey = key;
    await fsp.writeFile(looksPath() + '.tmp', looksText(riders, [...reload], Date.now(), reports));
    await fsp.rename(looksPath() + '.tmp', looksPath());
  }

  // ---------- gear catalog (service v27) ----------
  // Which MXB Mods page and download each gear file comes from, shared by every CoreMX: see
  // server/mxbm-server.js. false/{} when signed out, not verified, or the service is older.
  const catalogReady = () => !!cfg().token && cfg().verified !== false;
  async function reportCatalog(entry) {
    if (!catalogReady()) return false;
    try { await call('POST', '/v1/catalog/report', entry); return true; } catch { return false; }
  }
  async function catalogLookup(keys) {
    if (!catalogReady() || !keys.length) return {};
    try { return (await call('POST', '/v1/catalog/lookup', { keys })).matches || {}; } catch { return {}; }
  }
  async function catalogBad(key, postId) {
    if (!catalogReady()) return;
    await call('POST', '/v1/catalog/bad', { key, postId }).catch(() => {});
  }

  async function setServerShare(on) {
    setCfg({ serverShare: !!on });
    if (cfg().token) await call('POST', '/v1/servershare', { share: !!on }).catch(() => {});
    return status();
  }

  // name: the server the user clicked Join on, so a failed join can't label the next server.
  function noteJoin(address, name) { setCfg({ lastJoin: { address, name: typeof name === 'string' ? name.slice(0, 64) : '', at: Date.now() } }); }

  // Admin: the owner and admins the owner adds (by friend code) on the service. The role comes from
  // the service (GET /v1/admin/role); older services only know the owner.
  let role = { admin: false, owner: false, at: 0 };
  async function adminRole(force = false) {
    const c = cfg();
    if (!c.token || !c.id || c.id !== steamId()) { role = { admin: false, owner: false, at: Date.now() }; return role; }
    if (!force && Date.now() - role.at < 60 * 1000) return role;
    try { const r = await call('GET', '/v1/admin/role'); role = { admin: !!r.admin, owner: !!r.owner, verified: r.verified !== false, at: Date.now() }; }
    catch { const owner = c.id === ADMIN_STEAM_ID; role = { admin: owner, owner, at: Date.now() }; }
    return role;
  }
  function requireAdmin(ownerOnly = false) {
    if (!role.admin || cfg().id !== steamId() || !adminKey) throw new Error('Unlock Admin with your admin account and the server admin key first.');
    if (ownerOnly && !role.owner) throw new Error('Only the owner can manage admins.');
    if (!defaultUrl?.startsWith('https://') || cfg().url !== defaultUrl) throw new Error('Connect to the official HTTPS CoreMX service before using Admin.');
  }
  async function unlockAdmin(key) {
    const r = await adminRole(true);
    if (!r.admin) throw new Error('Admin is only for admin accounts. Ask the owner to add your friend code.');
    if (r.verified === false) throw new Error('Sign in with Steam first (Online → Friends): Admin needs an account Steam has confirmed.');
    if (!defaultUrl?.startsWith('https://') || cfg().url !== defaultUrl) throw new Error('Connect to the official HTTPS CoreMX service before using Admin.');
    const value = String(key || '').trim();
    if (!value) throw new Error('Enter the server admin key.');
    const result = await call('POST', '/v1/admin/status', { key: value });
    adminKey = value;
    return result;
  }

  return { start, stop, status, installPlugin, removePlugin, connect, disconnect, signIn, signInCode, cancelSignIn, leaderboard, setShare, servers, syncFriends, refreshFriendGear, friendLoadout, noteJoin, serverRiders, syncServerRiders, setServerShare, setUpnp, checkFirewall, allowFirewall, refresh: readState, syncPaints, refreshGearStatus, reportCatalog, catalogLookup, catalogBad, setPaintSync, removeReceived, known: (ids) => call('POST', '/v1/known', { ids }),
    notifications: () => call('GET', '/v1/notifications'),
    shareMod: (to, postId, title) => call('POST', '/v1/modshare', { to, postId, title }),
    readNotification: (id) => call('POST', '/v1/notifications/read', { id }),
    seenAnnouncements: (ids) => call('POST', '/v1/notifications/seen', { ids }),
    deleteNotification: (id) => call('POST', '/v1/notifications/delete', { id }),
    unlockAdmin,
    adminStatus: () => { requireAdmin(); return call('POST', '/v1/admin/status', { key: adminKey }); },
    adminActivity: (days) => { requireAdmin(); return call('POST', '/v1/admin/activity', { key: adminKey, days }); },
    adminRole: (force) => adminRole(force).then(({ admin, owner }) => ({ admin, owner })),
    adminList: () => { requireAdmin(true); return call('POST', '/v1/admin/admins', { key: adminKey }); },
    adminAdd: (id) => { requireAdmin(true); return call('POST', '/v1/admin/admins/add', { key: adminKey, id }); },
    adminRemove: (id) => { requireAdmin(true); return call('POST', '/v1/admin/admins/remove', { key: adminKey, id }); },
    createAnnouncement: (title, message) => { requireAdmin(); return call('POST', '/v1/admin/announcements', { key: adminKey, title, message }); },
  };
}

module.exports = { create, PLUGIN, STATE_FILE, looksText, RELOAD_FOR };
