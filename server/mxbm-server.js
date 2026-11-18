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
const MAX_FILE = 128 * 1024 * 1024;             // one equipped paint/model package
const MAX_STORE = Number(arg('maxstore', 4 * 1024)) * 1024 * 1024; // all paint files together (MB, default 4 GB)
fs.mkdirSync(FILES, { recursive: true });
const VERSION = 11;
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
let db = { users: {}, servers: {}, announcements: [] }, cacheCleanupSafe = false;
try {
  const saved = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  if (!saved.users || typeof saved.users !== 'object' || Array.isArray(saved.users)) throw new Error('Invalid user database');
  db = { users: {}, servers: {}, announcements: [], ...saved }; cacheCleanupSafe = true;
} catch (error) { if (error.code === 'ENOENT') cacheCleanupSafe = true; }
const cacheReaders = new Map();
const sweepCache = require('./cache-cleanup').createCacheCleanup({ directory: FILES, users: () => db.users, busy: (sha) => cacheReaders.has(sha) });
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
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), (e) => { if (!e) fs.rename(tmp, DATA, () => {}); });
  }, 2000);
}

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
const isAddress = (v) => /^(\d{1,3}\.){3}\d{1,3}:\d{2,5}$/.test(String(v || '')) && !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(String(v));
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
function storeSize() { let n = 0; for (const f of fs.readdirSync(FILES)) { try { n += fs.statSync(path.join(FILES, f)).size; } catch {} } return n; }

function send(res, code, body) {
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
function auth(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer ([a-f0-9]{48})$/);
  if (!m) return null;
  const h = hash(m[1]);
  for (const [id, u] of Object.entries(db.users)) if (u.tokenHash === h) return { id, user: u };
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

function presenceView(id) {
  const p = presence.get(id);
  const u = db.users[id];
  if (!p || Date.now() - p.at > ONLINE_TTL) return { id, name: u ? u.name : '', online: false, lastSeen: u ? u.lastSeen || null : null };
  const s = p.state || {};
  const srv = s.server ? db.servers[serverKey(s.server)] : null;
  return {
    id, name: u ? u.name : '', online: true, inGame: !!s.inGame, inEvent: !!s.inEvent,
    server: s.inEvent ? s.server || null : null, address: s.inEvent ? (srv && srv.address) || s.serverAddress || null : null,
    trackId: s.trackId || null, trackName: s.trackName || null, bikeName: s.bikeName || null, category: s.category || null,
    riders: srv ? srv.riders.length : null, lastSeen: p.at,
    session: s.inEvent ? s.session ?? null : null,
  };
}

// ---------- routes ----------
const routes = {
  'GET /v1/health': async () => [200, { ok: true, version: VERSION, features: ['hosting', 'hostip'], users: Object.keys(db.users).length, activeUsers: [...presence.values()].filter((p) => Date.now() - p.at < ONLINE_TTL).length, servers: Object.values(db.servers).filter((s) => Date.now() - s.lastSeen < SERVER_TTL).length }],

  // First run of an app: claim a Steam ID and get a token. A claimed ID can't be re-claimed.
  'POST /v1/register': async (req, body) => {
    const id = String(body.steamId || '');
    if (!isSteamId(id)) return [400, { error: 'steamId must be a 17-digit Steam ID' }];
    if (db.users[id]) return [409, { error: 'This Steam ID is already registered on this service. Ask the person running it to reset it.' }];
    const token = crypto.randomBytes(24).toString('hex');
    db.users[id] = { tokenHash: hash(token), name: str(body.name, 40), friends: [], createdAt: Date.now() };
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
      trackId: str(s.trackId), trackName: str(s.trackName), category: str(s.category), bikeName: str(s.bikeName), type: Number(s.type) || 0,
      riderName: str(s.riderName, 40), riderProfile: str(s.riderProfile, 64),
      session: s.inEvent && Number.isInteger(s.session) && s.session >= 0 && s.session <= 7 ? s.session : null,
    };
    // Someone hosting from Host World: their game has no address to report, but this request comes
    // from the host's own connection, so its public IP plus the game port is where friends join.
    if (s.hosting === true && state.inEvent && state.server && !state.serverAddress) {
      const port = Number(s.hostPort) >= 1024 && Number(s.hostPort) <= 65535 ? Number(s.hostPort) : 54210;
      let addr = `${clientIp(req)}:${port}`;
      // Over IPv6 the request carries no IPv4; use the IPv4 the app recorded with /v1/hostip.
      const seen = hostIps.get(me.id);
      if (!isAddress(addr) && seen && Date.now() - seen.at < 30 * 60 * 1000) addr = `${seen.ip}:${port}`;
      if (isAddress(addr)) state.serverAddress = addr;
    }
    // The game plugin reports a fresh non-event state as soon as MX Bikes
    // closes or the rider leaves a server.  Remove that reporter from the
    // old server immediately instead of leaving a "just now" ghost entry
    // until the normal 20-minute server TTL expires.
    const previous = presence.get(me.id)?.state;
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
      const riders = (Array.isArray(s.riders) ? s.riders : []).slice(0, MAX_RIDERS).map((r) => ({ name: str(r && r.name, 64), bike: str(r && r.bike, 64), category: str(r && r.category, 40) })).filter((r) => r.name);
      db.servers[k] = {
        name: state.server, address: state.serverAddress || null,
        trackId: state.trackId || prev.trackId || '', trackName: state.trackName || prev.trackName || '',
        riders, categories: [...new Set(riders.map((r) => r.category).filter(Boolean))],
        session: state.session,
        lastSeen: Date.now(), seenBy: [...new Set([me.id, ...(prev.seenBy || [])])].slice(0, 50),
      };
      cleanServers();
    }
    save();
    return [200, { ok: true, activeUsers: [...presence.values()].filter((p) => Date.now() - p.at < ONLINE_TTL).length }];
  },

  'GET /v1/servers': async () => {
    const now = Date.now();
    const list = Object.values(db.servers).filter((s) => now - s.lastSeen < SERVER_TTL)
      .map((s) => {
        const reporters = (s.seenBy || []).map((id) => ({ id, user: db.users[id], presence: presence.get(id) }))
          .filter(({ user, presence: p }) => user && p && now - p.at < ONLINE_TTL && p.state?.inEvent && serverKey(p.state.server || '') === serverKey(s.name));
        const riders = s.riders.map((r) => {
          const matchingRows = s.riders.filter((other) => normName(other.name) === normName(r.name));
          const matchingUsers = reporters.filter(({ presence: p }) => [p.state.riderName, p.state.riderProfile].some((n) => n && normName(n) === normName(r.name)));
          return matchingRows.length === 1 && matchingUsers.length === 1
            ? { ...r, coremxName: matchingUsers[0].user.name } : r;
        });
        return { name: s.name, address: s.address, trackId: s.trackId, trackName: s.trackName, session: s.session ?? null, riders, categories: s.categories, lastSeen: s.lastSeen, reporters: (s.seenBy || []).length };
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
      return { ...presenceView(id), status: 'ok' };
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
    const unavailable = (Array.isArray(body.unavailable) ? body.unavailable : []).slice(0, 24).map((it) => ({ slot: str(it && it.slot, 30), label: str(it && it.label, 100), error: str(it && it.error, 200) }));
    me.user.loadout = { bike: str(body.bike, 100), bikeName: str(body.bikeName, 100), items, equipped, unavailable, at: Date.now() };
    save();
    return [200, { ok: true, missing: items.filter((it) => !fs.existsSync(path.join(FILES, it.sha256))).map((it) => it.sha256) }];
  },
  // Outfits of mutual friends.
  'GET /v1/loadouts': async (req, body, me) => {
    if (!me) return [401, { error: 'not signed in' }];
    const out = [];
    for (const id of me.user.friends || []) {
      const u = db.users[id];
      if (!u || !(u.friends || []).includes(me.id) || !u.loadout || u.sharePaints === false) continue;
      out.push({ id, name: u.name, ...u.loadout, items: u.loadout.items.filter((it) => fs.existsSync(path.join(FILES, it.sha256))) });
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
      const here = !!(p && now - p.at < ONLINE_TTL && p.state && p.state.inEvent && serverKey(p.state.server || '') === key);
      const byName = !here && nameOnList(u.name, riderNames);
      if (!here && !byName) continue;
      out.push({ id, name: u.name, via: here ? 'plugin' : 'name', ...u.loadout, items: u.loadout.items.filter((it) => fs.existsSync(path.join(FILES, it.sha256))) });
      if (out.length >= 32) break;
    }
    return [200, { loadouts: out }];
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
  if (fs.existsSync(file)) { req.resume(); return send(res, 200, { ok: true, existed: true }); }
  const chunks = []; let n = 0;
  try {
    await new Promise((resolve, reject) => {
      req.on('data', (c) => { n += c.length; if (n > MAX_FILE) { reject(Object.assign(new Error('file too large (32 MB max)'), { code: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', resolve); req.on('error', reject);
    });
  } catch (e) { return send(res, e.code || 400, { error: e.message }); }
  const buf = Buffer.concat(chunks);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) return send(res, 400, { error: 'file does not match its hash' });
  const owned = Object.values((auth(req).user.loadout || {}).items || []).find((it) => it.sha256 === sha);
  if (!owned || owned.size !== buf.length) return send(res, 400, { error: 'file is not in your equipped loadout' });
  const plainPaint = buf.length >= 108 && buf.toString('latin1', 0, 4) === 'PNT\0' && buf.readUInt32LE(104) <= 256;
  const sealedPaint = buf.length >= 170 && buf.toString('ascii', buf.length - 62, buf.length - 58) === 'KCOL' && buf.readUInt32LE(buf.length - 6) === buf.length - 62;
  const model = buf.length >= 22 && buf.readUInt32LE(0) === 0x04034b50;
  if (owned.modelKind ? !model : !plainPaint && !sealedPaint) return send(res, 400, { error: 'not a supported equipped paint or model file' });
  if (storeSize() + buf.length > MAX_STORE) return send(res, 507, { error: 'the online service is out of paint storage' });
  fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file);
  return send(res, 200, { ok: true });
}

server.requestTimeout = 60000;
server.listen(PORT, () => console.log(`CoreMX online service on port ${server.address().port} (data: ${DATA})`));
