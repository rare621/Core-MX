// Server addresses from the game's own server list. The CoreMX presence plugin copies the list
// MX Bikes downloads for Multiplayer and writes mxbm_servers.txt next to the game profiles:
//   coremx-serverlist 1 <unix ms>
//   <ipv4>:<port>\t<name>
// Also removes the FrostMod build that older CoreMX versions installed for the same purpose.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const LIST = 'mxbm_servers.txt';
const LIST_TTL = 6 * 3600 * 1000;

function listPath(userDir) { return userDir ? path.join(userDir, LIST) : null; }

function parse(text) {
  const lines = String(text).split(/\r?\n/);
  const head = (lines[0] || '').match(/^coremx-serverlist\s+\d+\s+(\d+)/);
  if (!head) return null;
  const seen = new Set();
  const servers = [];
  for (const l of lines.slice(1)) {
    const m = l.match(/^(\d{1,3}(?:\.\d{1,3}){3}:\d{1,5})\t(.*)$/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    servers.push({ address: m[1], name: m[2].trim() || m[1] });
  }
  return { at: Number(head[1]), servers };
}

// The latest list, or null when there is none or it is older than 6 hours.
async function read(userDir, now = Date.now()) {
  const file = listPath(userDir);
  if (!file) return null;
  try {
    if ((await fsp.stat(file)).size > 512 * 1024) return null;
    const list = parse(await fsp.readFile(file, 'utf8'));
    if (!list || list.at > now + 60000 || now - list.at >= LIST_TTL) return null;
    return list;
  } catch { return null; }
}

// FrostMod builds that CoreMX itself installed (0.52.0, and the patched 0.52.0-mxbm builds).
// A FrostMod the player installed some other way has a different checksum and is left alone.
const BUNDLED_FROSTMOD = new Set([
  '3c71cd75cc8f5330632ee6dc14227fb5198977477c428b3a789211d0eeb8545c',
  '8e813dd3863d0391c50a234310d06edc8daf04e72c824dd68c4e09264145ed67',
  'e87516779fa06a0c2c9bf24d5dd4a7d80fec16baf61491060e2952d6f0ec50b6',
]);
const FROST_LICENSES = ['LICENSE.txt', 'MINHOOK-LICENSE.txt', 'NOTICE.txt', 'LIBCXX-LICENSE.txt', 'LIBCXXABI-LICENSE.txt', 'LIBUNWIND-LICENSE.txt', 'MINGW-LICENSE.txt', 'ZIG-LICENSE.txt'];

// Call only while the game is closed. `trash` moves a file to the Recycle Bin.
async function removeBundledFrostmod(installDir, userDir, trash) {
  if (!installDir) return false;
  const plugins = path.join(installDir, 'plugins'), dlo = path.join(plugins, 'frostmod.dlo');
  let hash;
  try { hash = crypto.createHash('sha256').update(await fsp.readFile(dlo)).digest('hex'); }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (!BUNDLED_FROSTMOD.has(hash)) return false;
  await trash(dlo);
  const rm = (p) => fsp.rm(p, { force: true }).catch(() => {});
  for (const name of FROST_LICENSES) await rm(path.join(plugins, 'frostmod-licenses', name));
  await fsp.rmdir(path.join(plugins, 'frostmod-licenses')).catch(() => {});
  for (const name of ['frostmod_filter.flag', 'frostmod_masterlist.txt', 'frostmod_masterlist.tmp', 'frostmod.dlo.part']) await rm(path.join(plugins, name));
  for (const dir of [installDir, userDir].filter(Boolean)) for (const name of ['frostmod_masterlist.txt', 'frostmod_masterlist.tmp']) await rm(path.join(dir, name));
  return true;
}

module.exports = { LIST, listPath, parse, read, removeBundledFrostmod, BUNDLED_FROSTMOD };
