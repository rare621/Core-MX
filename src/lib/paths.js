// Locating the MX Bikes user folder and external tools.
const fs = require('fs');
const path = require('path');

function detectGameUserDir(documentsDir) {
  const candidates = [
    path.join(documentsDir, 'PiBoSo', 'MX Bikes'),
    path.join(process.env.USERPROFILE || '', 'Documents', 'PiBoSo', 'MX Bikes'),
    path.join(process.env.USERPROFILE || '', 'OneDrive', 'Documents', 'PiBoSo', 'MX Bikes'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'mods'))) return c;
  }
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return candidates[0];
}

function findExe(list) {
  for (const p of list) if (p && fs.existsSync(p)) return p;
  return null;
}

function detectSevenZip() {
  return findExe([
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

module.exports = { steamRoot, detectGameUserDir, detectGameInstallDir, findGameExe, detectSevenZip, detectUnrar, detectTar, MXB_APPID };
