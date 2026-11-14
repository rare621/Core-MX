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
const JOIN_WINDOW = 5 * 60 * 1000; // a server we see within 5 min of an app join gets that join's address

function create({ store, userDir, installDir, appDir, modsDir, isGameRunning, steamId, steamName, currentOutfit, haveMod, defaultUrl, previousServiceUrls = [], onChange, onInstalled = () => {} }) {
  let current = null;        // parsed plugin state, or null
  let gameRunning = false;
  let lastSent = '';
  let lastSentAt = 0;
  let lastError = null;
  let timer = null;
  let paintTimer = null;
  let retryTimer = null;
  const paint = { busy: false, error: null, shared: null, report: null, unavailable: [], progress: null, at: null };
  let progressAt = 0;
  const progress = (value) => { paint.progress = value; if (Date.now() - progressAt > 150 || value.loaded === 0) { progressAt = Date.now(); onChange(status()); } };

  const cfg = () => store.get('online') || {};
  const setCfg = (patch) => store.set('online', { ...cfg(), ...patch });
  // Only explicitly configured aliases refer to the same service and account database.
  const sameService = (url) => url === defaultUrl || previousServiceUrls.includes(url);

  const bundledPlugin = () => path.join(appDir, 'plugin', PLUGIN);
  const pluginPath = () => (installDir() ? path.join(installDir(), 'plugins', PLUGIN) : null);
  const statePath = () => (userDir() ? path.join(userDir(), STATE_FILE) : null);

  // ---------- backend calls ----------
  async function call(method, route, body) {
    const base = (cfg().url || '').replace(/\/+$/, '');
    if (!base) throw new Error('No online service set up');
    const headers = { 'content-type': 'application/json' };
    if (cfg().token) headers.authorization = `Bearer ${cfg().token}`;
    const res = await fetch(base + route, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) })
      .catch((e) => { throw new Error(`Couldn't reach the online service (${e.cause ? e.cause.code || e.cause.message : e.message})`); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Online service answered ${res.status}`);
    return data;
  }
  // Paint files: raw bytes by SHA-256.
  async function upload(sha, buf) {
    const res = await fetch(`${cfg().url}/v1/files/${sha}`, { method: 'PUT', headers: { authorization: `Bearer ${cfg().token}`, 'content-type': 'application/octet-stream' }, body: buf, signal: AbortSignal.timeout(120000) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Upload failed (${res.status})`); }
  }
  async function download(sha, onProgress = () => {}) {
    const res = await fetch(`${cfg().url}/v1/files/${sha}`, { headers: { authorization: `Bearer ${cfg().token}` }, signal: AbortSignal.timeout(120000) });
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
    if (!gameRunning) next = null; // stale file from a game that has closed
    if (next && next.inEvent && next.server) {
      // Remember which address this server name had when we joined it from the app.
      const known = cfg().addresses || {};
      const lj = cfg().lastJoin;
      if (lj && Date.now() - lj.at < JOIN_WINDOW && !known[next.server]) {
        known[next.server] = lj.address;
        setCfg({ addresses: known, lastJoin: null });
      }
      next.serverAddress = known[next.server] || null;
    }
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    current = next;
    if (changed) onChange(status());
    await report();
  }

  function stateForReport() {
    const s = current || {};
    return {
      inGame: gameRunning, inEvent: !!s.inEvent,
      server: s.server || null, serverAddress: s.serverAddress || null,
      trackId: s.trackId || '', trackName: s.trackName || '', category: s.category || '', bikeName: s.bikeName || '', type: s.type || 0,
      riders: (s.riders || []).map((r) => ({ name: r.name, bike: r.bike, category: r.category })),
    };
  }

  async function report(force) {
    const c = cfg();
    if (!c.url || !c.token) return;
    const state = stateForReport();
    const key = JSON.stringify(state);
    // The manager stays online even with MX Bikes closed. Keep its heartbeat alive.
    if (!force && key === lastSent && Date.now() - lastSentAt < REPORT_EVERY) return;
    try {
      await call('POST', '/v1/presence', { name: steamName() || c.name || '', share: c.share !== false, state });
      lastSent = key; lastSentAt = Date.now(); lastError = null;
    } catch (e) { lastError = e.message; }
  }

  function start() {
    const p = statePath();
    if (p) fs.watchFile(p, { interval: 2000 }, () => readState().catch(() => {}));
    timer = setInterval(() => readState().catch(() => {}), 10000);
    readState().catch(() => {});
    paintTimer = setInterval(() => syncPaints().catch(() => {}), PAINT_EVERY);
    // Not signed in yet (service was down): try again every minute, quietly.
    retryTimer = setInterval(() => { const c = cfg(); if (defaultUrl && !c.token && !c.optedOut) connect().then(() => { lastError = null; onChange(status()); }).catch(() => {}); }, 60 * 1000);
    // A built-in service address (online.config.json): connect to it without asking.
    const c = cfg();
    if (c.url && defaultUrl && c.url !== defaultUrl) setCfg({ url: defaultUrl, ...(sameService(c.url) ? {} : { token: null, id: null }) });
    if (defaultUrl && !cfg().token && !c.optedOut) connect().catch((e) => { lastError = e.message; onChange(status()); });
    else if (c.token) syncPaints().catch(() => {});
  }
  function stop() { if (timer) clearInterval(timer); if (paintTimer) clearInterval(paintTimer); if (retryTimer) clearInterval(retryTimer); const p = statePath(); if (p) fs.unwatchFile(p); }

  // ---------- public ----------
  function status() {
    const c = cfg();
    const pp = pluginPath();
    return {
      plugin: { installed: !!(pp && fs.existsSync(pp)), available: fs.existsSync(bundledPlugin()), path: pp },
      game: { running: gameRunning },
      presence: current,
      service: { url: c.url || '', defaultUrl: defaultUrl || '', connected: !!c.token, id: c.id || null, name: steamName() || c.name || '', share: c.share !== false, error: lastError },
      paintSync: { enabled: c.paintSync !== false, busy: paint.busy, error: paint.error, shared: paint.shared, unavailable: paint.unavailable, progress: paint.progress, friends: paint.report, at: paint.at, received: Object.keys(c.received || {}).length },
    };
  }

  async function installPlugin() {
    const src = bundledPlugin(), dst = pluginPath();
    if (!fs.existsSync(src)) throw new Error('The plugin hasn\'t been built yet (plugin/mxbm_presence.dlo is missing).');
    if (!dst) throw new Error('Set the game install folder in Settings first.');
    if (await isGameRunning()) throw new Error('Close MX Bikes first — the game only loads plugins when it starts.');
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
    return status();
  }
  async function removePlugin() {
    const dst = pluginPath();
    if (await isGameRunning()) throw new Error('Close MX Bikes first.');
    if (dst && fs.existsSync(dst)) await fsp.rm(dst);
    return status();
  }

  // Point the app at a service and register this PC's Steam account with it.
  // Always the built-in service (online.config.json); users never pick an address.
  async function connect(_url, name) {
    if (!defaultUrl) throw new Error('This copy of the app has no online service built in.');
    const u = defaultUrl;
    if (!/^https?:\/\/[^\s/]+(:\d+)?$/i.test(u)) throw new Error('The address should look like http://12.34.56.78:8787');
    const sid = steamId();
    if (!sid) throw new Error('Sign in to Steam on this PC first — your Steam ID is your friend code.');
    const prev = cfg();
    name = steamName() || name || prev.name || '';
    setCfg({ url: u, token: sameService(prev.url) ? prev.token : null, id: sameService(prev.url) ? prev.id : null, name, optedOut: false });
    await call('GET', '/v1/health');
    if (!cfg().token) {
      const r = await call('POST', '/v1/register', { steamId: sid, name: name || '' });
      setCfg({ token: r.token, id: r.id });
    }
    lastSent = '';
    await readState(); // reads the game state, then reports it
    await syncFriends().catch(() => {});
    syncPaints().catch(() => {});
    return status();
  }
  async function disconnect() {
    if (cfg().token) await call('POST', '/v1/unregister').catch(() => {});
    setCfg({ token: null, id: null, optedOut: true });
    return status();
  }
  function setShare(share) { setCfg({ share: !!share }); lastSent = ''; report(true).catch(() => {}); return status(); }

  async function servers() {
    const r = await call('GET', '/v1/servers');
    const known = cfg().addresses || {};
    return { at: r.at, servers: (r.servers || []).map((s) => ({ ...s, address: s.address || known[s.name] || null })) };
  }
  async function syncFriends() {
    const ids = (store.get('friends') || []).map((f) => f.code).filter(Boolean);
    return (await call('POST', '/v1/friends', { ids })).friends || [];
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
      if (health.version < 2) throw new Error('Update the online server using the new mxbm-online-service.zip to enable gear sync');
      await syncFriends();
      const o = await currentOutfit();
      if (o) {
        const shared = await paintsync.share({ call, upload, modsDir: modsDir(), prof: o.prof, bike: o.bike, bikeName: o.bikeName, onProgress: progress });
        paint.shared = shared.items; paint.unavailable = shared.unavailable;
      }
      const received = { ...(cfg().received || {}) };
      const results = await paintsync.fetchFriends({ call, download, modsDir: modsDir(), received, have: haveMod, friendId, onProgress: progress });
      paint.report = friendId ? [...(paint.report || []).filter((p) => p.id !== friendId), ...results] : results;
      setCfg({ received });
      if (results.some((p) => p.items.some((it) => it.state === 'downloaded'))) await onInstalled();
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
    return results[0] || null;
  }
  async function setPaintSync(on) {
    setCfg({ paintSync: !!on });
    if (cfg().token) await call('POST', '/v1/paintshare', { share: !!on }).catch(() => {});
    if (on) syncPaints().catch(() => {});
    return status();
  }
  async function removeReceived() {
    const received = { ...(cfg().received || {}) };
    const n = await paintsync.removeReceived(modsDir(), received);
    setCfg({ received });
    return { removed: n, status: status() };
  }

  function noteJoin(address) { setCfg({ lastJoin: { address, at: Date.now() } }); }

  return { start, stop, status, installPlugin, removePlugin, connect, disconnect, setShare, servers, syncFriends, friendLoadout, noteJoin, refresh: readState, syncPaints, setPaintSync, removeReceived, known: (ids) => call('POST', '/v1/known', { ids }) };
}

module.exports = { create, PLUGIN, STATE_FILE };
