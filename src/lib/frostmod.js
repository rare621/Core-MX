// FrostMod (github.com/Frostn1/frostmod, MIT) — an MX Bikes plugin that, when you open the game's
// server browser, writes every server's address + name to frostmod_masterlist.txt.
// This module detects/installs the plugin (only when the user asks) and reads that list.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const REPO = 'Frostn1/frostmod';
const LIST = 'frostmod_masterlist.txt';

function pluginPath(installDir) { return installDir ? path.join(installDir, 'plugins', 'frostmod.dlo') : null; }

// FrostMod only installs its server-browser hook (which writes the server list) when an empty
// frostmod_filter.flag sits next to it. Its own launcher writes that file; in plugin mode nothing
// does, so we do. (Read once at game start.)
function flagPath(installDir) { return installDir ? path.join(installDir, 'plugins', 'frostmod_filter.flag') : null; }
async function ensureFlag(installDir) {
  const f = flagPath(installDir);
  if (!f || !fs.existsSync(pluginPath(installDir))) return false;
  if (fs.existsSync(f)) return false;
  await fsp.writeFile(f, '');
  return true; // newly created: the game must be restarted to pick it up
}

function listCandidates(installDir, userDir) {
  return [
    installDir && path.join(installDir, 'plugins', LIST),
    installDir && path.join(installDir, LIST),
    userDir && path.join(userDir, LIST),
  ].filter(Boolean);
}

// Format: "frostmod-masterlist 1 <unix ms>" then "<ipv4>:<port>\t<name>" per line.
function parse(text) {
  const lines = String(text).split(/\r?\n/);
  const head = (lines[0] || '').match(/^frostmod-masterlist\s+\d+\s+(\d+)/);
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

async function status(installDir, userDir) {
  const plugin = pluginPath(installDir);
  const installed = !!plugin && fs.existsSync(plugin);
  const flagAdded = installed ? await ensureFlag(installDir).catch(() => false) : false;
  let list = null, listPath = null;
  for (const p of listCandidates(installDir, userDir)) {
    try {
      const st = await fsp.stat(p);
      if (st.size > 512 * 1024) continue;
      const parsed = parse(await fsp.readFile(p, 'utf8'));
      if (parsed && (!list || parsed.at > list.at)) { list = parsed; listPath = p; }
    } catch {}
  }
  // Did FrostMod (in the running/last game session) actually switch the list hook on?
  let hookOn = null;
  try {
    const log = await fsp.readFile(path.join(installDir, 'plugins', 'frostmod.log'), 'utf8');
    const lastStart = log.lastIndexOf('Startup(');
    const tail = lastStart >= 0 ? log.slice(lastStart) : log;
    hookOn = /rules loaded \(inert\)/.test(tail) ? false : /\[filter\]|\[masterlist\]/.test(tail) ? true : null;
  } catch {}
  return { installed, plugin, list, listPath, flagAdded, hookOn };
}

// Download frostmod.dlo from the latest official GitHub release into <install>/plugins.
async function install(ses, installDir) {
  if (!installDir || !fs.existsSync(installDir)) throw new Error('Set your MX Bikes install folder in Settings first.');
  const rel = await ses.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MXBikesManager' } });
  if (!rel.ok) throw new Error(`GitHub returned HTTP ${rel.status}`);
  const r = await rel.json();
  const asset = (r.assets || []).find((a) => a.name.toLowerCase() === 'frostmod.dlo');
  if (!asset) throw new Error('This FrostMod release has no frostmod.dlo');
  const res = await ses.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'MXBikesManager' } });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (asset.size && buf.length !== asset.size) throw new Error('Download was incomplete');
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) throw new Error("Downloaded file isn't a Windows plugin");
  const dir = path.join(installDir, 'plugins');
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, 'frostmod.dlo');
  await fsp.writeFile(dest + '.part', buf);
  await fsp.rename(dest + '.part', dest);
  await ensureFlag(installDir);
  return { version: r.tag_name, size: buf.length, path: dest };
}

module.exports = { status, install, parse, pluginPath, flagPath, ensureFlag, listCandidates };
