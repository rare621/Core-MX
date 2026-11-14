// FrostMod (github.com/Frostn1/frostmod, MIT) — an MX Bikes plugin that, when you open the game's
// server browser, writes every server's address + name to frostmod_masterlist.txt.
// This module detects/installs the plugin (only when the user asks) and reads that list.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const REPO = 'Frostn1/frostmod';
const LIST = 'frostmod_masterlist.txt';
const LIST_TTL = 6 * 3600 * 1000;
const LICENSES = ['LICENSE.txt', 'MINHOOK-LICENSE.txt', 'NOTICE.txt', 'LIBCXX-LICENSE.txt', 'LIBCXXABI-LICENSE.txt', 'LIBUNWIND-LICENSE.txt', 'MINGW-LICENSE.txt', 'ZIG-LICENSE.txt'];

// Only known discovery outputs: never remove settings, mods or user-created files.
async function cleanup(installDir, userDir, { all = false, now = Date.now() } = {}) {
  let removed = 0;
  for (const file of listCandidates(installDir, userDir)) {
    for (const candidate of [file, file + '.tmp', file.replace(/\.txt$/, '.tmp')]) {
      try {
        const stat = await fsp.lstat(candidate);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        let expired = now - stat.mtimeMs > (candidate === file ? LIST_TTL : 300000);
        if (candidate === file && stat.size <= 512 * 1024) {
          const list = parse(await fsp.readFile(candidate, 'utf8'));
          expired ||= !list || list.at > now + 60000 || now - list.at >= LIST_TTL;
        }
        if (all || expired) { await fsp.unlink(candidate); removed++; }
      } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'EBUSY' && e.code !== 'EPERM') throw e; }
    }
  }
  const partialPlugin = pluginPath(installDir);
  if (partialPlugin) {
    try {
      const file = partialPlugin + '.part', stat = await fsp.lstat(file);
      if (stat.isFile() && !stat.isSymbolicLink() && (all || now - stat.mtimeMs > 300000)) { await fsp.unlink(file); removed++; }
    } catch (e) { if (!['ENOENT', 'EBUSY', 'EPERM'].includes(e.code)) throw e; }
  }
  return removed;
}

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
  await cleanup(installDir, userDir);
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

async function installBundled(appDir, installDir, replace = false) {
  if (!installDir || !fs.existsSync(installDir)) throw new Error('Set your MX Bikes install folder in Settings first.');
  const source = path.join(appDir, 'plugin', 'frostmod');
  const release = JSON.parse(await fsp.readFile(path.join(source, 'release.json'), 'utf8'));
  const bytes = await fsp.readFile(path.join(source, 'frostmod.dlo'));
  if (bytes.length !== release.size || crypto.createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw new Error('The bundled address-discovery plugin failed verification. Reinstall the manager.');
  const dest = pluginPath(installDir);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  let installed = false, matches = false;
  let existingHash = null;
  try { existingHash = crypto.createHash('sha256').update(await fsp.readFile(dest)).digest('hex'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  matches = existingHash === release.sha256;
  if (matches && LICENSES.every((name) => fs.existsSync(path.join(path.dirname(dest), 'frostmod-licenses', name)))) {
    await ensureFlag(installDir);
    return { installed: false, version: release.version, path: dest };
  }
  const upgrade = (release.replaces || []).includes(existingHash);
  if (!matches && (!existingHash || replace || upgrade)) {
    const temporary = dest + '.part';
    try {
      await fsp.writeFile(temporary, bytes);
      await fsp.rename(temporary, dest);
      installed = true;
    } finally { await fsp.rm(temporary, { force: true }); }
  }
  const licenses = path.join(path.dirname(dest), 'frostmod-licenses');
  await fsp.mkdir(licenses, { recursive: true });
  for (const name of LICENSES) await fsp.copyFile(path.join(source, name), path.join(licenses, name));
  await ensureFlag(installDir);
  return { installed, version: installed || matches ? release.version : null, path: dest };
}

module.exports = { status, install, installBundled, parse, pluginPath, flagPath, ensureFlag, listCandidates, cleanup, LICENSES };
