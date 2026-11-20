// Locating the MX Bikes user folder and external tools.
const fs = require('fs');
const path = require('path');

// Every place Windows may keep Documents (moved to another drive, or OneDrive in its variants).
function userDirCandidates(documentsDir) {
  const home = process.env.USERPROFILE || '';
  const docs = [documentsDir, path.join(home, 'Documents'), process.env.OneDrive && path.join(process.env.OneDrive, 'Documents'),
    process.env.OneDriveConsumer && path.join(process.env.OneDriveConsumer, 'Documents'), process.env.OneDriveCommercial && path.join(process.env.OneDriveCommercial, 'Documents'),
    path.join(home, 'OneDrive', 'Documents')];
  try { for (const e of fs.readdirSync(home, { withFileTypes: true })) if (e.isDirectory() && /^OneDrive/i.test(e.name)) docs.push(path.join(home, e.name, 'Documents')); } catch {}
  return [...new Set(docs.filter(Boolean).map((d) => path.join(d, 'PiBoSo', 'MX Bikes')))];
}
// The folder MX Bikes really uses is the one with profiles; then global.ini; then mods.
function userDirScore(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let profiles = 0;
  try { profiles = fs.readdirSync(path.join(dir, 'profiles'), { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, 'profiles', e.name, 'profile.ini'))).length; } catch {}
  return (profiles ? 8 : 0) + (fs.existsSync(path.join(dir, 'global.ini')) ? 4 : 0) + (fs.existsSync(path.join(dir, 'mods')) ? 2 : 0) + 1;
}
function detectGameUserDir(documentsDir) {
  const candidates = userDirCandidates(documentsDir);
  let best = candidates[0], score = 0;
  for (const c of candidates) { const s = userDirScore(c); if (s > score) { best = c; score = s; } }
  return best;
}

function findExe(list) {
  for (const p of list) if (p && fs.existsSync(p)) return p;
  return null;
}

// 7-Zip ships with CoreMX (vendor/7zip: 7z.exe + 7z.dll, packaged as resources/7zip), so .zip, .rar
// and .7z mods unpack without installing anything. A 7-Zip the player installed is the fallback.
function bundledSevenZip() {
  return findExe([
    process.resourcesPath && path.join(process.resourcesPath, '7zip', '7z.exe'),
    path.join(__dirname, '..', '..', 'vendor', '7zip', '7z.exe'),
  ]);
}

function detectSevenZip() {
  return findExe([
    bundledSevenZip(),
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', '7-Zip', '7z.exe'),
  ]);
}

function detectUnrar() {
  return findExe([
    'C:\\Program Files\\WinRAR\\UnRAR.exe',
    'C:\\Program Files (x86)\\WinRAR\\UnRAR.exe',
  ]);
}

function detectTar() {
  return findExe([path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')]);
}

const MXB_APPID = '655500';

function steamRoot() {
  try {
    const { execFileSync } = require('child_process');
    for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
      try {
        const out = execFileSync('reg', ['query', key], { encoding: 'utf8', windowsHide: true });
        const m = out.match(/(?:SteamPath|InstallPath)\s+REG_SZ\s+(.+)/i);
        if (m && fs.existsSync(m[1].trim())) return path.normalize(m[1].trim());
      } catch {}
    }
  } catch {}
  return findExe(['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']);
}

// Finds the MX Bikes game install (folder with mxbikes.exe) across all Steam libraries.
function detectGameInstallDir() {
  const root = steamRoot();
  const libs = new Set();
  if (root) {
    libs.add(root);
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch {}
  }
  for (const d of ['C', 'D', 'E', 'F', 'G', 'H']) {
    libs.add(`${d}:\\SteamLibrary`); libs.add(`${d}:\\Steam`); libs.add(`${d}:\\Program Files (x86)\\Steam`);
  }
  for (const lib of libs) {
    const acf = path.join(lib, 'steamapps', `appmanifest_${MXB_APPID}.acf`);
    if (!fs.existsSync(acf)) continue;
    let dir = 'MX Bikes';
    try { dir = fs.readFileSync(acf, 'utf8').match(/"installdir"\s+"([^"]+)"/)[1]; } catch {}
    const full = path.join(lib, 'steamapps', 'common', dir);
    if (fs.existsSync(full)) return full;
  }
  for (const lib of libs) {
    const full = path.join(lib, 'steamapps', 'common', 'MX Bikes');
    if (fs.existsSync(path.join(full, 'mxbikes.exe'))) return full;
  }
  return null;
}

function findGameExe(installDir) {
  if (!installDir) return null;
  try {
    const exe = fs.readdirSync(installDir).find((n) => /^mxbikes.*\.exe$/i.test(n) && !/beta|crash/i.test(n));
    return exe ? path.join(installDir, exe) : null;
  } catch { return null; }
}

// MX Bikes can keep mods in another folder: global.ini [mods] folder=<path>. Returns that absolute
// path, or '' when the game uses its default (mods next to the profiles).
function modsFolderFromGlobalIni(text) {
  let section = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = line.match(/^\[(.+)\]$/);
    if (head) { section = head[1].trim().toLowerCase(); continue; }
    const m = section === 'mods' && line.match(/^folder\s*=\s*(.*)$/i);
    if (m) { const value = m[1].trim().replace(/^"(.*)"$/, '$1'); return /^([a-z]:[\\/]|\\\\)/i.test(value) ? value : ''; }
  }
  return '';
}

module.exports = { bundledSevenZip, modsFolderFromGlobalIni, steamRoot, detectGameUserDir, userDirScore, userDirCandidates, detectGameInstallDir, findGameExe, detectSevenZip, detectUnrar, detectTar, MXB_APPID };
