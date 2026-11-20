// Server addresses from the game's own server list. The CoreMX presence plugin copies the list
// MX Bikes downloads for Multiplayer and writes mxbm_servers.txt next to the game profiles:
//   coremx-serverlist 1 <unix ms>
//   <ipv4>:<port>\t<name>
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

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

// FrostMod (a game plugin by the maker of MXB App) is never changed or removed by CoreMX: it may
// belong to another tool. CoreMX only tells the player it is there, since both plugins work on the
// game's server list and network, and two such plugins can interfere.
function frostmodInstalled(installDir) {
  if (!installDir) return false;
  try { return fs.statSync(path.join(installDir, 'plugins', 'frostmod.dlo')).isFile(); } catch { return false; }
}

module.exports = { LIST, listPath, parse, read, frostmodInstalled };
