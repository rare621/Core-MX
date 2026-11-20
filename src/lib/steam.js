// Reads the Steam account(s) signed in on this PC from Steam's local config (no login needed).
const fs = require('fs');
const path = require('path');

function parseUsers(vdf) {
  const users = [];
  const re = /"(\d{17})"\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(vdf))) {
    const body = m[2];
    const get = (k) => { const x = body.match(new RegExp(`"${k}"\\s+"([^"]*)"`, 'i')); return x ? x[1] : null; };
    users.push({ steamId: m[1], account: get('AccountName'), name: get('PersonaName'), mostRecent: get('MostRecent') === '1', timestamp: Number(get('Timestamp') || 0) });
  }
  return users.sort((a, b) => (b.mostRecent - a.mostRecent) || (b.timestamp - a.timestamp));
}

function detect(steamRoot) {
  if (!steamRoot) return { found: false };
  try {
    const users = parseUsers(fs.readFileSync(path.join(steamRoot, 'config', 'loginusers.vdf'), 'utf8'));
    if (!users.length) return { found: false };
    const u = users[0];
    const avatar = ['png', 'jpg'].map((e) => path.join(steamRoot, 'config', 'avatarcache', `${u.steamId}.${e}`)).find((p) => fs.existsSync(p)) || null;
    return { found: true, ...u, avatar, profileUrl: `https://steamcommunity.com/profiles/${u.steamId}`, others: users.length - 1 };
  } catch { return { found: false }; }
}

// A Steam profile photo by its id (Steam's public image server).
const avatarUrl = (hash) => `https://avatars.steamstatic.com/${hash}_full.jpg`;

// Profile photos for Steam IDs: Steam's local avatar cache (as data for the page), else the photo id
// Steam keeps for each friend in localconfig.vdf. Missing ids are left out (the page shows a letter).
function avatars(steamRoot, steamId, ids) {
  const out = {}, known = new Map(friends(steamRoot, steamId).filter((x) => x.avatar).map((x) => [x.steamId, x.avatar]));
  for (const id of ids || []) {
    if (!/^\d{17}$/.test(String(id))) continue;
    const cached = steamRoot && ['png', 'jpg'].map((e) => path.join(steamRoot, 'config', 'avatarcache', `${id}.${e}`)).find((p) => fs.existsSync(p));
    if (cached) { try { out[id] = `data:image/${/png$/.test(cached) ? 'png' : 'jpeg'};base64,` + fs.readFileSync(cached).toString('base64'); continue; } catch {} }
    if (known.has(id)) out[id] = known.get(id);
  }
  return out;
}

// People in this Steam account's local friends cache (userdata/<account>/config/localconfig.vdf):
// Steam ID, current name and profile photo id. Nothing else is read from that file.
const STEAM64_BASE = 76561197960265728n;
function friends(steamRoot, steamId) {
  if (!steamRoot || !/^\d{17}$/.test(String(steamId || ''))) return [];
  const account = (BigInt(steamId) - STEAM64_BASE).toString();
  let text;
  try { text = fs.readFileSync(path.join(steamRoot, 'userdata', account, 'config', 'localconfig.vdf'), 'utf8'); } catch { return []; }
  const at = text.indexOf('"friends"');
  if (at < 0) return [];
  // Walk the "friends" block: entries are "<accountId>" { "name" "<name>" ... }
  // Tokens: quoted strings and braces. A string followed by "{" opens a block; two strings in a row are key/value.
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  re.lastIndex = text.indexOf('{', at);
  let m;
  for (let depth = 0; (m = re.exec(text));) {
    if (m[2] === '{') depth++;
    if (m[2] === '}') depth--;
    tokens.push(m[2] || { s: m[1] });
    if (depth <= 0) break;
  }
  const out = [];
  let depth = 0, cur = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '{') { depth++; continue; }
    if (t === '}') {
      if (depth === 2 && cur) { if (cur.name && cur.account !== account) out.push({ steamId: (BigInt(cur.account) + STEAM64_BASE).toString(), name: cur.name, ...(cur.avatar ? { avatar: avatarUrl(cur.avatar) } : {}) }); cur = null; }
      depth--; continue;
    }
    const next = tokens[i + 1];
    if (next === '{') { if (depth === 1 && /^\d{1,10}$/.test(t.s)) cur = { account: t.s }; continue; }
    if (next && next.s !== undefined) { if (depth === 2 && cur && t.s === 'name') cur.name = next.s; if (depth === 2 && cur && t.s === 'avatar' && /^[0-9a-f]{40}$/i.test(next.s)) cur.avatar = next.s.toLowerCase(); i++; }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { detect, friends, avatars, avatarUrl };
