#!/usr/bin/env node
// CoreMX online service: live server list (with tracks) and friends' presence.
//
//   node server/mxbm-server.js [--port 60000] [--data ./mxbm-data.json]
//
// Each copy of the app reports what the game's plugin sees (server name, track, riders) and reads
// back the servers everyone has reported, plus where its friends are. Friends see each other only
// when BOTH have added each other. No dependencies; state is kept in one JSON file.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : process.env[`MXBM_${name.toUpperCase()}`] || def; };
const PORT = Number(arg('port', 60000));
const DATA = path.resolve(arg('data', path.join(__dirname, 'mxbm-data.json')));
const FILES = path.resolve(arg('files', path.join(path.dirname(DATA), 'mxbm-files')));
const MAX_FILE = 512 * 1024 * 1024;             // one equipped paint/model package (R2; Cloudflare caps direct uploads at 100 MB)
fs.mkdirSync(FILES, { recursive: true });
// Optional Cloudflare R2 storage for paint/model files (see r2.js). Without r2.json, files stay in FILES.
const R2_FILE = path.join(path.dirname(DATA), 'r2.json');
const R2 = (() => { const c = require('./r2').loadConfig(R2_FILE); return c ? require('./r2').createR2(c) : null; })();
const HOST_GRACE = (Number(arg('hostgraceseconds', 120)) >= 0 ? Number(arg('hostgraceseconds', 120)) : 120) * 1000; // see staleFor
const SWEEP_EVERY = (Number(arg('sweepminutes', 60)) > 0 ? Number(arg('sweepminutes', 60)) : 60) * 60 * 1000; // untracked R2 objects
const R2_GRACE = (Number(arg('unusedseconds', 120)) > 0 ? Number(arg('unusedseconds', 120)) : 120) * 1000; // an R2 file nobody wears is deleted after 2 minutes
// Synced files of users who haven't opened CoreMX for this long are removed (R2 and this PC); their
// app uploads them again when they come back. --inactivedays N (default 5).
const INACTIVE_MS = (Number(arg('inactivedays', 5)) > 0 ? Number(arg('inactivedays', 5)) : 5) * 24 * 60 * 60 * 1000;
// All synced files together (MB). Only files someone has equipped are kept, so this is a safety net,
// not a quota: on this PC's disk 4 GB, in R2 100 GB (1.5 US cents per GB-month past the free 10 GB).
const MAX_STORE = Number(arg('maxstore', R2 ? 100 * 1024 : 4 * 1024)) * 1024 * 1024;
let storeWarnedAt = 0;
function warnStore(size) {
  if (size < MAX_STORE * 0.8 || Date.now() - storeWarnedAt < 3600e3) return;
  storeWarnedAt = Date.now();
  console.warn(`Synced file storage is ${Math.round(100 * size / MAX_STORE)}% full (${(size / 1073741824).toFixed(1)} of ${(MAX_STORE / 1073741824).toFixed(0)} GB). Raise --maxstore in start-server.cmd before it fills up.`);
}
const VERSION = 22;
const ADMIN_STEAM_ID = '76561198098586128';
const ADMIN_KEY_FILE = path.join(path.dirname(DATA), 'admin.key');
const ADMIN_KEY = process.env.MXBM_ADMIN_KEY || (() => {
  try { return fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(ADMIN_KEY_FILE, key + '\n', { flag: 'wx', mode: 0o600 });
    return key;
  }
})();

const SERVER_TTL = 2 * 60 * 1000;    // live rows only: the manager reports every 30 seconds
const ONLINE_TTL = 2 * 60 * 1000;    // a rider counts as online for 2 min after their last report
const MAX_BODY = 64 * 1024, MAX_RIDERS = 128, MAX_SERVERS = 3000, MAX_FRIENDS = 300;

// ---------- state ----------
let db = { users: {}, servers: {}, announcements: [], r2: {}, activity: {}, wants: {} }, cacheCleanupSafe = false;
try {
  const saved = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  if (!saved.users || typeof saved.users !== 'object' || Array.isArray(saved.users)) throw new Error('Invalid user database');
  db = { users: {}, servers: {}, announcements: [], r2: {}, activity: {}, wants: {}, ...saved }; cacheCleanupSafe = true;
} catch (error) { if (error.code === 'ENOENT') cacheCleanupSafe = true; }
const cacheReaders = new Map();
const { liveFiles } = require('./cache-cleanup');
const sweepCache = require('./cache-cleanup').createCacheCleanup({ directory: FILES, users: () => db.users, busy: (sha) => cacheReaders.has(sha) || wanted(sha), inactiveMs: INACTIVE_MS }); // never a file a rider still waits for
async function cleanCache() {
  if (!cacheCleanupSafe) return;
  try {
    const result = await sweepCache();
    if (result?.removed) console.log(`Cache cleanup: removed ${result.removed} unused files (${(result.bytes / 1048576).toFixed(1)} MB)`);
  } catch (error) { console.warn('Cache cleanup:', error.message); }
}
cleanCache();
setInterval(cleanCache, 30000).unref();
const presence = new Map(); // steamId -> { at, share, state }
const hostIps = new Map(); // steamId -> { ip, at } (IPv4 seen on /v1/hostip)
let saveTimer = null;
// Written at most 2 seconds after a change (a steady stream of changes can't postpone it forever),
// and right away when the service is stopped (Ctrl+C, closing its window, a shutdown).
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DATA + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), (e) => { if (!e) fs.rename(tmp, DATA, () => {}); });
  }, 2000);
}
function saveNow() {
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  try { fs.writeFileSync(DATA + '.tmp', JSON.stringify(db)); fs.renameSync(DATA + '.tmp', DATA); } catch (e) { console.error('Could not save:', e.message); }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { saveNow(); process.exit(0); });

// ---------- helpers ----------
const str = (v, n = 100) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const isSteamId = (v) => /^7656119\d{10}$/.test(String(v || ''));
// The caller's public IPv4. Forwarded headers are only trusted from a proxy on this machine or the
// local network (e.g. the reverse proxy in front of coremx.app), so a client cannot fake its address.
function clientIp(req) {
  const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const local = peer === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(peer);
  if (local) {
    const fwd = String(req.headers['x-coremx-client-ip'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0]).trim().replace(/^::ffff:/, '');
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(fwd)) return fwd;
  }
  return peer;
}
// A public IPv4 game address (never a home-network, carrier-shared, link-local or loopback one).
const isAddress = (v) => /^(\d{1,3}\.){3}\d{1,3}:\d{2,5}$/.test(String(v || '')) && !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(String(v));
// A host's address on its own home network: only for riders on that same network (same public IP),
// whose router usually can't connect them to their own public address.
const isLanAddress = (v) => /^(\d{1,3}\.){3}\d{1,3}:\d{2,5}$/.test(String(v || '')) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(v));
function addressFor(srv, viewerIps = []) {
  if (srv && srv.hosted && srv.hostLan && srv.hostIp && viewerIps.includes(srv.hostIp)) return { address: srv.hostLan, sameNetwork: true };
  return { address: srv ? srv.address || null : null, sameNetwork: false };
}
// The IPv4 addresses a request may come from: the connection, and the one the app last reported over
// IPv4 (/v1/hostip; an app that reaches the service over IPv6 has no IPv4 on its requests).
const viewerIps = (req, me) => { const h = me && hostIps.get(me.id); return [clientIp(req), h && Date.now() - h.at < 30 * 60 * 1000 ? h.ip : null].filter(Boolean); };
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const serverKey = (name) => str(name, 64).toLowerCase();
// Rider names in game often carry team tags ("CaptiveDuck | CRMX"); compare on words.
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function nameOnList(steamName, riderNames) {
  const n = normName(steamName);
  if (n.length < 3) return false;
  return riderNames.some((r) => r === n || (' ' + r + ' ').includes(' ' + n + ' '));
}
// A path inside a mods folder that a paint file may be written to: relative, no "..", ends in .pnt.
const safeRel = (p) => typeof p === 'string' && /^(bikes|rider|tyres)\/.+\.(pnt|pkz)$/i.test(p) && !p.split('/').some((x) => x === '..' || x === '' || x === '.') && !/[\\:\0]/.test(p) && (!/\.pkz$/i.test(p) || /^(rider\/(?:riders\/[^/]+(?:\/(helmets|boots|protections)\/[^/]+)?|(?:helmets|boots|protections)\/[^/]+)|tyres\/[^/]+)\.pkz$/i.test(p));
function storeSize() {
  let n = 0;
  for (const f of fs.readdirSync(FILES)) { try { n += fs.statSync(path.join(FILES, f)).size; } catch {} }
  for (const sha of Object.keys(db.r2 || {})) if (!fs.existsSync(path.join(FILES, sha))) n += db.r2[sha].size || 0;
  return n;
}
// A synced file is available when it's on this PC or (checked) in R2.
const haveFile = (sha) => !!(db.r2 && db.r2[sha]) || fs.existsSync(path.join(FILES, sha));

// ---------- on-demand uploads ----------
// A synced file is uploaded only when someone needs it. A rider missing a file asks for it
// (POST /v1/want); the owner's app learns this from its next presence report (`upload`) and uploads
// it. Apps from before on-demand (no `onDemand`/`pending` flags) still upload everything, and their
// downloads count as asking, so they keep working. Every R2 file records when it was last needed.
const WANT_TTL = 10 * 60 * 1000;                  // an older app's implicit request lasts 10 minutes
// A rider's own request stays until their CoreMX says the file is installed (POST /v1/received), so
// the file is never deleted while they still need it (an interrupted download, a restart). It ends
// by itself after PENDING_MAX if they never come back. Kept in the database across restarts.
const PENDING_MAX = 2 * 24 * 60 * 60 * 1000;
const KEEP_UNUSED = (Number(arg('keepdays', 1)) > 0 ? Number(arg('keepdays', 1)) : 1) * 24 * 60 * 60 * 1000; // an R2 file nobody has needed for a day is deleted (--keepdays)
// db.wants: sha -> { <rider id or "*" for older apps>: until }
function noteUse(sha) {
  const rec = db.r2 && db.r2[sha];
  if (rec && Date.now() - (rec.used || 0) > 60 * 1000) { rec.used = Date.now(); save(); }
}
function want(sha, who = '*') {
  const until = Date.now() + (who === '*' ? WANT_TTL : PENDING_MAX);
  const w = (db.wants[sha] = db.wants[sha] || {});
  if (!w[who] || w[who] < until - 60 * 1000) { w[who] = until; save(); }
  noteUse(sha);
}
// Someone still needs this file: it must be uploaded, and kept.
const wanted = (sha) => Object.values(db.wants[sha] || {}).some((until) => until > Date.now());
function received(sha, who) {
  const w = db.wants[sha];
  if (w && w[who]) { delete w[who]; if (!Object.keys(w).length) delete db.wants[sha]; save(); }
}
setInterval(() => {
  let changed = false;
  for (const [sha, w] of Object.entries(db.wants)) {
    for (const [who, until] of Object.entries(w)) if (until <= Date.now()) { delete w[who]; changed = true; }
    if (!Object.keys(w).length) { delete db.wants[sha]; changed = true; }
  }
  if (changed) save();
}, 60 * 1000).unref();
// Owners of a file (users wearing it) who are online now and can upload it.
function ownerOnline(sha) {
  for (const [id, u] of Object.entries(db.users)) {
    if (!(u.loadout?.items || []).some((it) => it.sha256 === sha)) continue;
    const p = presence.get(id);
    if (p && Date.now() - p.at < ONLINE_TTL) return true;
  }
  return false;
}
// A loadout's items for a viewer: new apps (pending) see every item with `available`, older apps only
// the available ones, and what they can't get yet counts as asked for (so the owner uploads it).
function itemsFor(u, pending) {
  const items = (u.loadout && u.loadout.items) || [];
  if (pending) return items.map((it) => ({ ...it, available: haveFile(it.sha256) }));
  for (const it of items) if (!haveFile(it.sha256)) want(it.sha256, '*');
  return items.filter((it) => haveFile(it.sha256));
}
// Files this user wears that someone asked for and that aren't uploaded yet.
const toUpload = (u) => ((u && u.loadout && u.loadout.items) || []).filter((it) => !haveFile(it.sha256) && wanted(it.sha256)).map((it) => it.sha256);

// Only real HTTP status numbers; a connection that is already gone or answered is left alone
// (an upload cut off mid-way used to pass "ECONNRESET" here and crash the service).
function send(res, code, body) {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  if (!Number.isInteger(code) || code < 100 || code > 599) code = 500;
  const out = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(out) });
  res.end(out);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('body too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('bad JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}
// Daily active accounts for the Admin tab: { "2026-11-19": [steamId, ...] } on this PC's calendar,
// kept for ACTIVITY_DAYS. Only account ids are kept; names come from the accounts.
const ACTIVITY_DAYS = 90;
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// The calendar day i days ago (noon, so daylight-saving changes never skip or repeat a day).
const dayAgo = (i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); return dayKey(d.getTime()); };
function markActive(id) {
  const day = dayKey(), list = (db.activity[day] = db.activity[day] || []);
  if (list.includes(id)) return;
  list.push(id);
  const keep = new Set(Array.from({ length: ACTIVITY_DAYS }, (_, i) => dayAgo(i)));
  for (const k of Object.keys(db.activity)) if (!keep.has(k)) delete db.activity[k];
  save();
}
function adminActivity(days = 30) {
  const now = Date.now(), n = Math.max(1, Math.min(ACTIVITY_DAYS, Math.round(Number(days) || 30)));
  const daily = Array.from({ length: n }, (_, i) => dayAgo(n - 1 - i)).map((date) => ({ date, count: (db.activity[date] || []).length }));
  const counted = new Map();
  for (const { date } of daily) for (const id of db.activity[date] || []) counted.set(id, (counted.get(id) || 0) + 1);
  // One row per account (Steam ID), so a name never shows twice for the same person.
  const users = Object.entries(db.users).map(([id, u]) => {
    const p = presence.get(id), online = !!(p && now - p.at < ONLINE_TTL), st = (online && p.state) || {};
    return { id, name: u.name || '', createdAt: u.createdAt || null, lastSeen: u.lastSeen || null, online, inGame: !!st.inGame, server: st.inEvent ? str(st.server, 64) : '', track: st.inEvent ? str(st.trackName || st.trackId, 64) : '', activeDays: counted.get(id) || 0 };
  }).sort((a, b) => (b.online - a.online) || ((b.lastSeen || 0) - (a.lastSeen || 0)));
  const within = (ms) => users.filter((u) => u.lastSeen && now - u.lastSeen < ms).length;
  return {
    summary: { accounts: users.length, onlineNow: users.filter((u) => u.online).length, inGame: users.filter((u) => u.online && u.inGame).length, today: (db.activity[dayKey(now)] || []).length,
      last5Days: within(5 * 86400000), last30Days: within(30 * 86400000), newThisWeek: users.filter((u) => u.createdAt && now - u.createdAt < 7 * 86400000).length },
    daily, users, trackedSince: Object.keys(db.activity).sort()[0] || null, at: now,
  };
}

function auth(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer ([a-f0-9]{48})$/);
  if (!m) return null;
  const h = hash(m[1]);
  for (const [id, u] of Object.entries(db.users)) if (u.tokenHash === h) {
    markActive(id);
    // Any signed-in request means the user has CoreMX open (synced files stay while seen within INACTIVE_MS).
    if (Date.now() - (u.lastSeen || 0) > 60000) { u.lastSeen = Date.now(); save(); }
    return { id, user: u };
  }
  return null;
}
function adminAllowed(me, key) {
  if (!me || me.id !== ADMIN_STEAM_ID || !ADMIN_KEY || typeof key !== 'string') return false;
  return crypto.timingSafeEqual(Buffer.from(hash(key)), Buffer.from(hash(ADMIN_KEY)));
}
function announcementInbox(user) {
  const cutoff = Date.now() - 30 * 86400000;
  const deleted = new Set(user.deletedAnnouncements || []), read = new Set(user.readAnnouncements || []), seen = new Set(user.seenAnnouncements || []);
  return (db.announcements || []).filter((a) => a.at >= cutoff && !deleted.has(a.id)).map((a) => ({ ...a, kind: 'announcement', read: read.has(a.id), seenPopup: seen.has(a.id) }));
}

// Signed-in riders get separate allowances even behind the same router.
// Keep an address limit for anonymous requests; never trust forwarded headers.
const hits = new Map();
function limited(key, allowance) {
  const now = Date.now(), w = hits.get(key) || { at: now, n: 0 };
  if (now - w.at > 60000) { w.at = now; w.n = 0; }
  w.n++; hits.set(key, w);
  return w.n > allowance ? Math.max(1, Math.ceil((w.at + 60000 - now) / 1000)) : 0;
}
setInterval(() => { const now = Date.now(); for (const [k, w] of hits) if (now - w.at > 120000) hits.delete(k); }, 60000).unref();

function cleanServers() {
  const now = Date.now();
  for (const [k, s] of Object.entries(db.servers)) if (now - s.lastSeen > 24 * 3600 * 1000) delete db.servers[k];
  const keys = Object.keys(db.servers);
  if (keys.length > MAX_SERVERS) keys.sort((a, b) => db.servers[a].lastSeen - db.servers[b].lastSeen).slice(0, keys.length - MAX_SERVERS).forEach((k) => delete db.servers[k]);
}

function presenceView(id, viewer = []) {
  const p = presence.get(id);
  const u = db.users[id];
  if (!p || Date.now() - p.at > ONLINE_TTL) return { id, name: u ? u.name : '', online: false, lastSeen: u ? u.lastSeen || null : null };
  const s = p.state || {};
  const srv = s.server ? db.servers[serverKey(s.server)] : null;
  return {
    id, name: u ? u.name : '', online: true, inGame: !!s.inGame, inEvent: !!s.inEvent,
    server: s.inEvent ? s.server || null : null, address: s.inEvent ? addressFor(srv, viewer).address || s.serverAddress || null : null,
    sameNetwork: !!(s.inEvent && addressFor(srv, viewer).sameNetwork),
    trackId: s.trackId || null, trackName: s.trackName || null, bikeName: s.bikeName || null, category: s.category || null,
    riders: srv ? srv.riders.length : null, lastSeen: p.at,
    session: s.inEvent ? s.session ?? null : null,
  };
}

// ---------- routes ----------
const routes = {
  'GET /v1/health': async () => [200, { ok: true, version: VERSION, features: ['hosting', 'hostip', 'observed-host-address', 'on-demand', ...(R2 ? ['r2-files'] : [])], users: Object.keys(db.users).length, activeUsers: [...presence.values()].filter((p) => Date.now() - p.at < ONLINE_TTL).length, servers: Object.values(db.servers).filter((s) => Date.now() - s.lastSeen < SERVER_TTL).length }],

  // First run of an app: claim a Steam ID and get a token. A claimed ID can't be re-claimed.
  'POST /v1/register': async (req, body) => {
    const id = String(body.steamId || '');
    if (!isSteamId(id)) return [400, { error: 'steamId must be a 17-digit Steam ID' }];
    if (db.users[id]) return [409, { error: 'This Steam ID is already registered on this service. Ask the person running it to reset it.' }];
    const token = crypto.randomBytes(24).toString('hex');
    db.users[id] = { tokenHash: hash(token), name: str(body.name, 40), friends: [], createdAt: Date.now(), lastSeen: Date.now() };
    markActive(id);
    save();
    return [200, { id, token }];
  },

  // What the plugin sees right now. `share: false` hides you from friends but still adds the
  // server's track to the shared list.
  // A hosting app calls this over IPv4 so the service learns the host's IPv4 address (MX Bikes
  // servers are IPv4) even when the app's other requests travel over IPv6. The address is what this
  // service sees on the connection, never a value the app supplies.
  'POST /v1/hostip': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const ip = clientIp(req);
    if (!isAddress(`${ip}:54210`)) return [200, { ok: false }];
    hostIps.set(me.id, { ip, at: Date.now() });
    return [200, { ok: true }];
  },
  'POST /v1/presence': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const s = body.state || {};
    const state = {
      inGame: !!s.inGame, inEvent: !!s.inEvent, server: str(s.server, 64) || null, serverAddress: isAddress(s.serverAddress) ? s.serverAddress : null,
      serverAddressSource: s.serverAddressSource === 'game' ? 'game' : null,
      trackId: str(s.trackId), trackName: str(s.trackName), category: str(s.category), bikeName: str(s.bikeName), type: Number(s.type) || 0,
      riderName: str(s.riderName, 40), riderProfile: str(s.riderProfile, 64), gameName: str(s.gameName, 64),
      // Race number and bike in game: other CoreMX users on the server find this rider by them (live looks).
      raceNumber: Number.isInteger(s.raceNumber) && s.raceNumber > 0 && s.raceNumber < 100000 ? s.raceNumber : null, bikeId: str(s.bikeId, 64),
      session: s.inEvent && Number.isInteger(s.session) && s.session >= 0 && s.session <= 7 ? s.session : null,
    };
    // Someone hosting from Host World: their game has no address to report, but this request comes
    // from the host's own connection, so its public IP plus the game port is where friends join.
    if (s.hosting === true && state.inEvent && state.server && !state.serverAddress) {
      const port = Number(s.hostPort) >= 1024 && Number(s.hostPort) <= 65535 ? Number(s.hostPort) : 54210;
      let addr = `${clientIp(req)}:${port}`;
      // The host's outside address from STUN (the router may map 54210 to another port). Only its
      // port is taken from the app: the IP must equal the one this service sees for that player.
      const seen = hostIps.get(me.id);
      const fresh = seen && Date.now() - seen.at < 30 * 60 * 1000;
      const stun = String(s.hostAddress || '');
      if (isAddress(stun)) {
        const ip = stun.split(':')[0];
        if (ip === clientIp(req) || (fresh && ip === seen.ip)) addr = stun;
      }
      // Over IPv6 the request carries no IPv4; use the IPv4 the app recorded with /v1/hostip.
      if (!isAddress(addr) && fresh) addr = `${seen.ip}:${port}`;
      if (isAddress(addr)) state.serverAddress = addr;
      if (isLanAddress(s.hostLan)) state.hostLan = s.hostLan;
    }
    // The game plugin reports a fresh non-event state as soon as MX Bikes
    // closes or the rider leaves a server.  Remove that reporter from the
    // old server immediately instead of leaving a "just now" ghost entry
    // until the normal 20-minute server TTL expires.
    const previousPresence = presence.get(me.id);
    const previous = previousPresence?.state;
    if (previous?.server && (!state.inEvent || previous.server !== state.server)) {
      const oldKey = serverKey(previous.server), old = db.servers[oldKey];
      if (old) {
        old.seenBy = (old.seenBy || []).filter((id) => id !== me.id);
        if (!old.seenBy.length) delete db.servers[oldKey];
      }
    }
    me.user.name = str(body.name, 40) || me.user.name;
    me.user.lastSeen = Date.now();
    presence.set(me.id, { at: Date.now(), share: body.share !== false, state });
    if (state.inEvent && state.server && (state.trackId || state.trackName)) {
      const k = serverKey(state.server);
      const prev = db.servers[k] || { seenBy: [] };
      const reported = (Array.isArray(s.riders) ? s.riders : []).slice(0, MAX_RIDERS).map((r) => ({ name: str(r && r.name, 64), bike: str(r && r.bike, 64), category: str(r && r.category, 40) })).filter((r) => r.name);
      // Every CoreMX user on the server reports the riders their own game knows. A game that joined
      // later only knows riders who came after it, so reports differ and the list used to jump between
      // them (1, 12, 8...). Each report is kept; the list shown is the one from the host, else from the
      // CoreMX user who has been on the server longest (its game has seen everyone come and go).
      const now = Date.now(), reports = {};
      for (const [id, r] of Object.entries(prev.reports || {})) {
        const p = presence.get(id);
        if (id !== me.id && p && now - p.at < ONLINE_TTL && p.state?.inEvent && serverKey(p.state.server || '') === k) reports[id] = r;
      }
      const stayed = prev.reports && prev.reports[me.id] && previous?.inEvent && serverKey(previous.server || '') === k;
      reports[me.id] = { riders: reported, since: stayed ? prev.reports[me.id].since : now };
      // A home-hosted game started again under the same name: players still "on" it since before this
      // session began (stuck on a closed game's "connection lost" screen) belong to the old game. Their
      // reports don't count for the new one (2 minutes' grace for reports arriving just before the host's).
      const continuingHost = s.hosting === true && prev.hosted && prev.hostedBy === me.id && previous?.inEvent &&
        serverKey(previous.server || '') === k && now - previousPresence.at < ONLINE_TTL;
      const hostSince = s.hosting === true ? (continuingHost ? prev.hostSince || now : now) : prev.hosted ? prev.hostSince || 0 : 0;
      const hostId = s.hosting === true ? me.id : prev.hosted ? prev.hostedBy : null;
      const staleFor = (id) => !!(hostSince && id !== hostId && reports[id] && reports[id].since < hostSince - HOST_GRACE);
      // (Stale reports are kept, so their age is remembered, but never chosen.)
      const meStale = staleFor(me.id);
      const host = s.hosting === true ? me.id : prev.hosted && reports[prev.hostedBy] ? prev.hostedBy : null;
      const best = host || (Object.entries(reports).filter(([id]) => !staleFor(id)).sort((a, b) => a[1].since - b[1].since)[0] || [])[0];
      const riders = best ? reports[best].riders : prev.riders || [];
      db.servers[k] = {
        // A rider who reached this Host World server can report the endpoint read from the game.
        // Prefer that fresh observation over the host's public-IP:54210 guess. Keep it only while
        // the same host remains in the same session; a reused server name must not inherit it.
        ...(() => {
          if (s.hosting === true && state.serverAddress) {
            const continuing = prev.hosted && prev.hostedBy === me.id && previous?.inEvent &&
              serverKey(previous.server || '') === k && Date.now() - previousPresence.at < ONLINE_TTL;
            // Keep the real address for the whole hosting session. It used to expire 2 minutes after the last
            // rider's report, which put the public-IP:54210 guess back and made later joins time out.
            const observed = continuing && prev.observedAddress;
            return {
              address: observed ? prev.observedAddress : state.serverAddress,
              hosted: true, hostedBy: me.id, hostSince, guessedAddress: state.serverAddress,
              hostLan: state.hostLan || null, hostIp: state.serverAddress.split(':')[0],
              observedAddress: observed ? prev.observedAddress : null,
              observedAt: observed ? prev.observedAt : null,
            };
          }
          const hp = prev.hosted && prev.hostedBy !== me.id ? presence.get(prev.hostedBy) : null;
          const hostStillThere = hp && Date.now() - hp.at < ONLINE_TTL && hp.state?.inEvent && serverKey(hp.state.server || '') === k;
          if (hostStillThere) {
            const sameTrack = !prev.trackId || !state.trackId || prev.trackId === state.trackId;
            const fromGame = !meStale && state.serverAddress && state.serverAddressSource === 'game' && sameTrack;
            // Same session as long as the host is still on it (hostStillThere), so keep what a game saw.
            const observed = fromGame ? state.serverAddress : prev.observedAddress || null;
            const guessedAddress = prev.guessedAddress || prev.address || null;
            return {
              address: observed || guessedAddress, hosted: true, hostedBy: prev.hostedBy, hostSince: prev.hostSince || 0, guessedAddress, hostLan: prev.hostLan || null, hostIp: prev.hostIp || null,
              observedAddress: observed, observedAt: fromGame ? Date.now() : observed ? prev.observedAt : null,
            };
          }
          // Its host left (the game is closed): stays marked as theirs, so the list leaves it out.
          if (prev.hosted && prev.hostedBy && prev.hostedBy !== me.id) return { address: null, hosted: true, hostedBy: prev.hostedBy, hostSince: prev.hostSince || 0, guessedAddress: prev.guessedAddress || null, observedAddress: null, observedAt: null };
          return { address: state.serverAddress || null, hosted: false };
        })(),
        name: state.server,
        trackId: state.trackId || prev.trackId || '', trackName: state.trackName || prev.trackName || '',
        riders, reports, categories: [...new Set(riders.map((r) => r.category).filter(Boolean))],
        session: state.session,
        lastSeen: Date.now(), seenBy: [...new Set([me.id, ...(prev.seenBy || [])])].slice(0, 50),
      };
      cleanServers();
    }
    save();
    return [200, { ok: true, activeUsers: [...presence.values()].filter((p) => Date.now() - p.at < ONLINE_TTL).length, upload: toUpload(me.user) }];
  },

  'GET /v1/servers': async (req, body, me) => {
    const viewer = viewerIps(req, me);
    const now = Date.now();
    // A home-hosted game ends when its host leaves it: other players' games can sit on a 'connection
    // lost' screen and keep reporting it, so the host's own report decides.
    const hostGone = (s) => { if (!s.hosted || !s.hostedBy) return false; const p = presence.get(s.hostedBy); return !(p && now - p.at < ONLINE_TTL && p.state?.inEvent && serverKey(p.state.server || '') === serverKey(s.name)); };
    const list = Object.values(db.servers).filter((s) => now - s.lastSeen < SERVER_TTL && !hostGone(s))
      .map((s) => {
        const reporters = (s.seenBy || []).map((id) => ({ id, user: db.users[id], presence: presence.get(id) }))
          .filter(({ user, presence: p }) => user && p && now - p.at < ONLINE_TTL && p.state?.inEvent && serverKey(p.state.server || '') === serverKey(s.name));
        const riders = s.riders.map((r) => {
          const matchingRows = s.riders.filter((other) => normName(other.name) === normName(r.name));
          const matchingUsers = reporters.filter(({ presence: p }) => [p.state.gameName, p.state.riderName, p.state.riderProfile].some((n) => n && normName(n) === normName(r.name)));
          return matchingRows.length === 1 && matchingUsers.length === 1
            ? { ...r, coremxName: matchingUsers[0].user.name } : r;
        });
        const at = addressFor(s, viewer);
        return { name: s.name, address: at.address, sameNetwork: at.sameNetwork, hosted: !!s.hosted, addressObserved: !!(s.hosted && s.observedAddress), trackId: s.trackId, trackName: s.trackName, session: s.session ?? null, riders, categories: s.categories, lastSeen: s.lastSeen, reporters: (s.seenBy || []).length };
      })
      .sort((a, b) => b.riders.length - a.riders.length || b.lastSeen - a.lastSeen);
    return [200, { servers: list, at: now }];
  },

  // Replace your friend list (Steam IDs). Returns their presence where the friendship is mutual.
  'POST /v1/friends': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    me.user.friends = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter(isSteamId))].slice(0, MAX_FRIENDS);
    save();
    return routes['GET /v1/friends'](req, body, me);
  },
  'GET /v1/friends': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const out = (me.user.friends || []).map((id) => {
      const u = db.users[id];
      if (!u) return { id, status: 'not-on-service' };
      if (!(u.friends || []).includes(me.id)) return { id, name: u.name, status: 'not-added-back' };
      const p = presence.get(id);
      if (p && !p.share) return { id, name: u.name, status: 'hidden' };
      return { ...presenceView(id, viewerIps(req, me)), status: 'ok' };
    });
    return [200, { friends: out }];
  },

  // Small, private inbox for mod links shared by mutual friends. No files are
  // uploaded here and a link never grants access to a paid download.
  'POST /v1/modshare': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const to = String(body.to || ''), recipient = db.users[to];
    if (!isSteamId(to) || !recipient || !(me.user.friends || []).includes(to) || !(recipient.friends || []).includes(me.id)) return [403, { error: 'You can only share with a mutual CoreMX friend.' }];
    const postId = str(body.postId, 90), title = str(body.title, 140);
    const validId = /^coremx:[A-Za-z0-9_-]{1,80}$/.test(postId) || /^\d{1,12}$/.test(postId);
    if (!validId || !title) return [400, { error: 'Invalid mod link.' }];
    const inbox = recipient.notifications || (recipient.notifications = []);
    inbox.unshift({ id: crypto.randomUUID(), kind: 'share', from: me.id, fromName: me.user.name, postId, title, at: Date.now(), read: false });
    recipient.notifications = inbox.slice(0, 100);
    save();
    return [200, { ok: true }];
  },
  'GET /v1/notifications': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const now = Date.now();
    const shares = (me.user.notifications || []).filter((n) => now - n.at < 30 * 86400000);
    if (shares.length !== (me.user.notifications || []).length) { me.user.notifications = shares; save(); }
    const list = [...shares.map((n) => ({ ...n, kind: 'share' })), ...announcementInbox(me.user)].sort((a, b) => b.at - a.at);
    return [200, { notifications: list, unread: list.filter((n) => !n.read).length }];
  },
  'POST /v1/notifications/read': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const notification = (me.user.notifications || []).find((n) => n.id === body.id);
    if (notification) notification.read = true;
    else if (announcementInbox(me.user).some((n) => n.id === body.id)) me.user.readAnnouncements = [...new Set([...(me.user.readAnnouncements || []), body.id])].slice(-100);
    else return [404, { error: 'Notification not found.' }];
    save(); return [200, { ok: true }];
  },
  'POST /v1/notifications/seen': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const available = new Set(announcementInbox(me.user).map((n) => n.id));
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => available.has(id)).slice(0, 100);
    me.user.seenAnnouncements = [...new Set([...(me.user.seenAnnouncements || []), ...ids])].slice(-100);
    save(); return [200, { ok: true }];
  },
  'POST /v1/notifications/delete': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const id = String(body.id || '');
    const old = me.user.notifications || [];
    if (old.some((n) => n.id === id)) me.user.notifications = old.filter((n) => n.id !== id);
    else if (announcementInbox(me.user).some((n) => n.id === id)) me.user.deletedAnnouncements = [...new Set([...(me.user.deletedAnnouncements || []), id])].slice(-100);
    else return [404, { error: 'Notification not found.' }];
    save(); return [200, { ok: true }];
  },
  'POST /v1/admin/status': async (req, body, me) => {
    if (!adminAllowed(me, body.key)) return [403, { error: 'Admin access requires the registered Steam account and server admin key.' }];
    return [200, { accounts: Object.keys(db.users).length, announcements: (db.announcements || []).length }];
  },
  // Who used CoreMX: one row per account, daily active counts and totals (Admin tab).
  'POST /v1/admin/activity': async (req, body, me) => {
    if (!adminAllowed(me, body.key)) return [403, { error: 'Admin access requires the registered Steam account and server admin key.' }];
    return [200, adminActivity(body.days)];
  },
  'POST /v1/admin/announcements': async (req, body, me) => {
    if (!adminAllowed(me, body.key)) return [403, { error: 'Admin access requires the registered Steam account and server admin key.' }];
    const title = str(body.title, 100);
    const message = String(body.message || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, 2000);
    if (title.length < 3 || message.length < 5) return [400, { error: 'Enter a title and a description.' }];
    const item = { id: crypto.randomUUID(), title, message, at: Date.now() };
    db.announcements = [item, ...(db.announcements || [])].slice(0, 100);
    save(); return [200, { ok: true, announcement: item }];
  },

  // Which of these Steam IDs use this service (for "add from Steam friends").
  'POST /v1/known': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter(isSteamId).slice(0, 500);
    return [200, { known: ids.filter((id) => db.users[id]).map((id) => ({ id, name: db.users[id].name })) }];
  },

  // ---------- paint sync ----------
  // Your current outfit: which paint files you use and where they go in a mods folder.
  'POST /v1/loadout': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 20).map((it) => ({
      slot: str(it && it.slot, 30), label: str(it && it.label, 100), path: str(it && it.path, 260), sha256: String(it && it.sha256 || ''),
      value: str(it && it.value, 100), rider: str(it && it.rider, 100), modelKind: ['rider', 'helmet', 'boots', 'protection', 'tyres'].includes(it && it.modelKind) ? it.modelKind : undefined,
      size: Number(it && it.size) || 0, needs: (Array.isArray(it && it.needs) ? it.needs : []).slice(0, 4).map((n) => ({ kind: str(n && n.kind, 20), name: str(n && n.name, 100), rider: str(n && n.rider, 100) })),
    })).filter((it) => /^[a-f0-9]{64}$/.test(it.sha256) && safeRel(it.path) && it.size > 0 && it.size <= MAX_FILE && !!it.modelKind === /\.pkz$/i.test(it.path));
    const equipped = (Array.isArray(body.equipped) ? body.equipped : []).slice(0, 24).map((it) => ({ slot: str(it && it.slot, 30), label: str(it && it.label, 100), value: str(it && it.value, 100), state: str(it && it.state, 20) }));
    const unavailable = (Array.isArray(body.unavailable) ? body.unavailable : []).slice(0, 24).map((it) => {
      const u = { slot: str(it && it.slot, 30), label: str(it && it.label, 100), error: str(it && it.error, 200), ...(it && it.included === 'bike' ? { included: 'bike' } : {}) };
      // A free MXB Mods post the item can be installed from (it can't be copied: too large or locked).
      const src = it && it.source;
      if (src && Number.isSafeInteger(src.postId) && src.postId > 0 && /^https:\/\/mxb-mods\.com\/[^\s"<>]*$/i.test(String(src.link || '')) && String(src.link).length <= 300)
        u.source = { postId: src.postId, title: str(src.title, 100), link: String(src.link), ...(/^https:\/\/[^\s"<>]+$/i.test(String(src.image || '')) && String(src.image).length <= 300 ? { image: String(src.image) } : {}),
          ...(/^https?:\/\/[^\s"<>]+$/i.test(String(src.download || '')) && String(src.download).length <= 300 ? { download: String(src.download) } : {}),
          ...(src.fileName ? { fileName: str(src.fileName, 120) } : {}) };
      return u;
    });
    me.user.loadout = { bike: str(body.bike, 100), bikeName: str(body.bikeName, 100), items, equipped, unavailable, at: Date.now() };
    save();
    // Apps with on-demand uploads get only the files someone asked for; older apps everything missing.
    const onDemand = body.onDemand === true;
    return [200, { ok: true, missing: items.filter((it) => !haveFile(it.sha256) && (!onDemand || wanted(it.sha256))).map((it) => it.sha256) }];
  },
  // Outfits of mutual friends.
  'GET /v1/loadouts': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const pending = new URL(req.url, 'http://x').searchParams.get('pending') === '1';
    const out = [];
    for (const id of me.user.friends || []) {
      const u = db.users[id];
      if (!u || !(u.friends || []).includes(me.id) || !u.loadout || u.sharePaints === false) continue;
      const p = presence.get(id);
      out.push({ id, name: u.name, ...u.loadout, items: itemsFor(u, pending), online: !!(p && Date.now() - p.at < ONLINE_TTL) });
    }
    return [200, { loadouts: out }];
  },
  // Outfits of other app users riding on the same server, friends or not. A user is "on" the
  // server when their own plugin reports it, or when their Steam name matches a name in that
  // server's rider list (for riders with the app but no plugin). Respects both share switches.
  'POST /v1/server-riders': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const name = str(body.server, 64);
    if (!name) return [400, { error: 'server name required' }];
    const key = serverKey(name), now = Date.now();
    const srv = db.servers[key] && now - db.servers[key].lastSeen < SERVER_TTL ? db.servers[key] : null;
    const riderNames = (srv?.riders || []).map((r) => normName(r.name)).filter(Boolean);
    const out = [];
    for (const [id, u] of Object.entries(db.users)) {
      if (id === me.id || !u.loadout || u.sharePaints === false || u.shareServer === false) continue;
      const p = presence.get(id);
      const online = !!(p && now - p.at < ONLINE_TTL);
      const here = !!(online && p.state && p.state.inEvent && serverKey(p.state.server || '') === key);
      // Matched only by name on the server's rider list (no plugin): skipped when their CoreMX shows
      // them on another server, or is closed with files not uploaded (they could never be sent).
      const elsewhere = online && p.state && p.state.inEvent && serverKey(p.state.server || '') !== key;
      const byName = !here && !elsewhere && nameOnList(u.name, riderNames) && (online || (u.loadout.items || []).every((it) => haveFile(it.sha256)));
      if (!here && !byName) continue;
      out.push({ id, name: u.name, via: here ? 'plugin' : 'name', ...(here ? { num: p.state.raceNumber || null, bikeId: p.state.bikeId || '' } : {}), ...u.loadout, items: itemsFor(u, body.pending === true), online: !!(p && now - p.at < ONLINE_TTL) });
      if (out.length >= 32) break;
    }
    return [200, { loadouts: out }];
  },
  // Files a rider is missing: their owners upload them on their next report. Only files some sharing
  // user wears can be asked for. Answers each file's state: ready, uploading (owner online), offline.
  'POST /v1/want': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const shas = [...new Set((Array.isArray(body.shas) ? body.shas : []).filter((x) => /^[a-f0-9]{64}$/.test(String(x))))].slice(0, 64);
    const worn = new Set();
    for (const u of Object.values(db.users)) if (u.sharePaints !== false) for (const it of (u.loadout?.items || [])) worn.add(it.sha256);
    const states = {};
    for (const sha of shas) {
      if (!worn.has(sha) && !haveFile(sha)) { states[sha] = 'gone'; continue; }
      want(sha, me.id);
      states[sha] = haveFile(sha) ? 'ready' : ownerOnline(sha) ? 'uploading' : 'offline';
    }
    return [200, { states }];
  },
  // The rider's CoreMX installed these files: their requests end (the files may be deleted later by
  // the usual rules, never before).
  'POST /v1/received': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    for (const sha of (Array.isArray(body.shas) ? body.shas : []).filter((x) => /^[a-f0-9]{64}$/.test(String(x))).slice(0, 64)) received(sha, me.id);
    return [200, { ok: true }];
  },
  'POST /v1/servershare': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    me.user.shareServer = body.share !== false; save();
    return [200, { ok: true }];
  },
  'POST /v1/paintshare': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    me.user.sharePaints = body.share !== false; save();
    return [200, { ok: true }];
  },
  // Forget this install (its token stops working, your Steam ID can be registered again).
  'POST /v1/unregister': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    delete db.users[me.id]; presence.delete(me.id); save();
    return [200, { ok: true }];
  },
};

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const me = auth(req);
  const retryAfter = limited(me ? `user:${me.id}` : `ip:${ip}`, me ? 300 : 120);
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
    req.resume();
    return send(res, 429, { error: 'Online service is busy. Please wait before retrying.', retryAfter });
  }
  const url = new URL(req.url, 'http://x');
  const fm = url.pathname.match(/^\/v1\/files\/([a-f0-9]{64})$/);
  if (fm) return fileRoute(req, res, fm[1]);
  const fu = url.pathname.match(/^\/v1\/files\/([a-f0-9]{64})\/(upload|uploaded)$/);
  if (fu && req.method === 'POST') { req.resume(); return (fu[2] === 'upload' ? uploadGrant : uploadCheck)(req, res, fu[1]); }
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: 'not found' });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const [code, out] = await route(req, body, me);
    send(res, code, out);
  } catch (e) {
    send(res, e.code >= 400 && e.code < 500 ? e.code : 500, { error: e.code ? e.message : 'server error' });
    if (!e.code) console.error(e);
  }
});
// Paint files, stored by their SHA-256 (so the same paint is kept once). Upload needs sign-in;
// the body must hash to the name and look like a readable (not sealed) MX Bikes paint.
async function fileRoute(req, res, sha) {
  const file = path.join(FILES, sha);
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!auth(req)) return send(res, 401, { error: 'not signed in' });
    noteUse(sha);
    if (R2 && db.r2[sha]) {
      // A link that works for 5 minutes. The app's fetch drops its sign-in header when it follows this.
      res.writeHead(302, { location: R2.getUrl(sha, 300), 'cache-control': 'no-store', 'content-length': 0 });
      return res.end();
    }
    if (!fs.existsSync(file)) return send(res, 404, { error: 'no such file' });
    const st = fs.statSync(file);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'cache-control': 'private, max-age=31536000, immutable' });
    if (req.method === 'HEAD') return res.end();
    cacheReaders.set(sha, (cacheReaders.get(sha) || 0) + 1);
    const stream = fs.createReadStream(file);
    stream.once('close', () => { const count = cacheReaders.get(sha) - 1; if (count) cacheReaders.set(sha, count); else cacheReaders.delete(sha); });
    stream.on('error', () => res.destroy());
    res.once('close', () => stream.destroy());
    return stream.pipe(res);
  }
  if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' });
  if (!auth(req)) return send(res, 401, { error: 'not signed in' });
  if (haveFile(sha)) { req.resume(); return send(res, 200, { ok: true, existed: true }); }
  const chunks = []; let n = 0;
  try {
    await new Promise((resolve, reject) => {
      req.on('data', (c) => { n += c.length; if (n > MAX_FILE) { reject(Object.assign(new Error('file too large (32 MB max)'), { code: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', resolve); req.on('error', reject);
    });
  } catch (e) { return send(res, Number.isInteger(e.code) ? e.code : 400, { error: e.message }); }
  const buf = Buffer.concat(chunks);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) return send(res, 400, { error: 'file does not match its hash' });
  const bad = checkFile(auth(req), sha, buf);
  if (bad) return send(res, bad[0], { error: bad[1] });
  const size = storeSize(); warnStore(size + buf.length);
  if (size + buf.length > MAX_STORE) { console.warn('Synced file storage is FULL: uploads are being refused. Raise --maxstore in start-server.cmd.'); return send(res, 507, { error: 'the online service is out of paint storage' }); }
  fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file);
  return send(res, 200, { ok: true });
}
const ownedItem = (me, sha) => Object.values((me && me.user.loadout || {}).items || []).find((it) => it.sha256 === sha);
// The bytes must hash to their name, be in the uploader's equipped loadout at that size, and look like an
// MX Bikes paint (or a model package for model slots). Returns [status, error] or null when fine.
function checkFile(me, sha, buf) {
  if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) return [400, 'file does not match its hash'];
  const owned = ownedItem(me, sha);
  if (!owned || owned.size !== buf.length) return [400, 'file is not in your equipped loadout'];
  const plainPaint = buf.length >= 108 && buf.toString('latin1', 0, 4) === 'PNT\0' && buf.readUInt32LE(104) <= 256;
  const sealedPaint = buf.length >= 170 && buf.toString('ascii', buf.length - 62, buf.length - 58) === 'KCOL' && buf.readUInt32LE(buf.length - 6) === buf.length - 62;
  const model = buf.length >= 22 && buf.readUInt32LE(0) === 0x04034b50;
  if (owned.modelKind ? !model : !plainPaint && !sealedPaint) return [400, 'not a supported equipped paint or model file'];
  return null;
}

// ---------- R2 uploads (app 1.0.42+) ----------
// Step 1: the app asks for an upload link. { direct: true } = no R2 here, upload to /v1/files as before.
async function uploadGrant(req, res, sha) {
  const me = auth(req); if (!me) return send(res, 401, { error: 'not signed in' });
  if (haveFile(sha)) return send(res, 200, { existed: true });
  if (!R2) return send(res, 200, { direct: true });
  const owned = ownedItem(me, sha);
  if (!owned) return send(res, 400, { error: 'file is not in your equipped loadout' });
  const size = storeSize(); warnStore(size + owned.size);
  if (size + owned.size > MAX_STORE) { console.warn('Synced file storage is FULL: uploads are being refused. Raise --maxstore in start-server.cmd.'); return send(res, 507, { error: 'the online service is out of paint storage' }); }
  return send(res, 200, { url: R2.putUrl(sha, 900), method: 'PUT' });
}
// Step 2: after uploading, the app asks the service to check it. Anything that fails is deleted from R2.
async function uploadCheck(req, res, sha) {
  const me = auth(req); if (!me) return send(res, 401, { error: 'not signed in' });
  if (!R2) return send(res, 404, { error: 'not found' });
  if (db.r2[sha]) return send(res, 200, { ok: true, existed: true });
  let buf;
  try { buf = await R2.read(sha, MAX_FILE); } catch (e) { return send(res, 502, { error: e.message }); }
  if (!buf) return send(res, 404, { error: 'upload not found' });
  const bad = checkFile(me, sha, buf);
  if (bad) { R2.remove(sha).catch(() => {}); return send(res, bad[0], { error: bad[1] }); }
  db.r2[sha] = { size: buf.length, at: Date.now(), used: Date.now() }; save();
  return send(res, 200, { ok: true });
}

// ---------- R2 upkeep ----------
// Moves files already on this PC up to R2 (one at a time), and deletes R2 files nobody active wears
// for 2 minutes (see INACTIVE_MS).
let r2Busy = false;
async function r2Upkeep() {
  if (!R2 || r2Busy || !cacheCleanupSafe) return;
  r2Busy = true;
  try {
    const live = liveFiles(db.users, { inactiveMs: INACTIVE_MS });
    const local = fs.readdirSync(FILES).find((f) => /^[a-f0-9]{64}$/.test(f) && !db.r2[f] && !cacheReaders.has(f) && live.has(f));
    if (local) {
      const file = path.join(FILES, local), buf = fs.readFileSync(file);
      if (crypto.createHash('sha256').update(buf).digest('hex') === local) {
        await R2.put(local, buf);
        db.r2[local] = { size: buf.length, at: Date.now() }; save();
        if (!cacheReaders.has(local)) { try { fs.unlinkSync(file); } catch {} }
        console.log(`R2: moved ${local.slice(0, 12)}… (${(buf.length / 1048576).toFixed(1)} MB)`);
      }
    }
    for (const [sha, rec] of Object.entries(db.r2)) {
      // Never while a rider who asked for it hasn't installed it yet.
      if (wanted(sha)) { if (rec.unusedSince) { delete rec.unusedSince; save(); } continue; }
      // Kept while someone active wears it and someone needed it in the last 3 days (asked again if needed later).
      const needed = Date.now() - (rec.used || rec.at || 0) < KEEP_UNUSED || wanted(sha);
      if (live.has(sha) && needed) { if (rec.unusedSince) { delete rec.unusedSince; save(); } continue; }
      if (live.has(sha) && !needed) { await R2.remove(sha); delete db.r2[sha]; save(); console.log(`R2: removed ${sha.slice(0, 12)}… (not needed for 3 days)`); continue; }
      if (!rec.unusedSince) { rec.unusedSince = Date.now(); save(); continue; }
      if (Date.now() - rec.unusedSince < R2_GRACE) continue;
      await R2.remove(sha); delete db.r2[sha]; save();
      console.log(`R2: removed unused ${sha.slice(0, 12)}…`);
    }
    await sweepUntracked();
  } catch (e) { console.warn('R2 upkeep:', e.message); }
  finally { r2Busy = false; }
}
// Objects in the bucket the service doesn't track (an upload whose check never arrived, a crash
// between upload and check, files from before a reset): deleted once they're an hour old. Hourly.
let sweptAt = 0;
async function sweepUntracked() {
  if (!R2.list || Date.now() - sweptAt < SWEEP_EVERY) return;
  sweptAt = Date.now();
  let removed = 0, bytes = 0;
  for (const obj of await R2.list()) {
    const sha = (obj.key.match(/^files\/([a-f0-9]{64})$/) || [])[1];
    if (!sha || db.r2[sha] || Date.now() - obj.modified < 60 * 60 * 1000) continue;
    await R2.remove(sha); removed++; bytes += obj.size || 0;
  }
  if (removed) console.log(`R2: removed ${removed} untracked file${removed === 1 ? '' : 's'} (${(bytes / 1048576).toFixed(1)} MB)`);
}
if (R2) { setTimeout(r2Upkeep, 5000).unref(); setInterval(r2Upkeep, Math.min(30000, R2_GRACE)).unref(); }

server.requestTimeout = 60000;
server.listen(PORT, () => console.log(`CoreMX online service on port ${server.address().port} (data: ${DATA})${R2 ? ` · files in R2 bucket ${R2.bucket}` : ''}`));
