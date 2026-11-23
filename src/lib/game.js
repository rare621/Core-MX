// Game settings (profile.ini), quick-start setup and launching MX Bikes (normal, or straight into a server).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const profile = require('./profile');

// category: the bike classes the game knows on this PC (class = last bike ridden in it).
const SECTIONS = ['gfx', 'sound', 'aids', 'view', 'ext_view', 'misc', 'input', 'info', 'ui', 'category'];

async function readSettings(userDir, name) {
  const prof = await profile.readProfile(userDir, name);
  const out = {};
  for (const s of SECTIONS) out[s] = (prof.sections[s] && prof.sections[s].values) || {};
  out.currentBike = profile.currentBike(prof);
  return out;
}

// "MX2OEM_2023_Honda_CRF250R" -> "MX2 OEM" (the class the game shows in its bike list)
function classFor(bikeId) {
  const m = bikeId.match(/^(MX\w*?|SM\w*?|EN\w*?)OEM_/i);
  if (!m) return null;
  const c = m[1].toUpperCase();
  return `${c.replace(/^MXE$/, 'MX-E')} OEM`;
}

// Point the profile at a bike (and optionally a track) so the game opens with them selected.
async function quickStart(userDir, name, { bike, bikeClass, track }) {
  const values = [];
  if (bike) {
    values.push(['info', 'bikeid', bike]);
    const cls = classFor(bike) || bikeClass;
    if (cls) { values.push(['info', 'class', cls]); values.push(['category', cls, bike]); }
  }
  if (track) { values.push(['ui', 'race_track', track]); values.push(['ui', 'testing_track', track]); }
  return profile.writeValues(userDir, name, values);
}

// MX Bikes calls SteamAPI_RestartAppIfNecessary: started directly, Steam closes it and relaunches
// the game WITHOUT our launch options (-directconnect, -testing, -dedicated...). A steam_appid.txt
// next to the exe makes the game run as started (still using the signed-in Steam account).
function ensureSteamAppId(exe) {
  const f = path.join(path.dirname(exe), 'steam_appid.txt');
  try { if (!fs.existsSync(f)) fs.writeFileSync(f, '655500'); } catch {}
}

function launch(exe, args = [], { keep = false } = {}) {
  if (!exe || !fs.existsSync(exe)) return false;
  if (args.length) ensureSteamAppId(exe);
  const child = spawn(exe, args, { cwd: path.dirname(exe), detached: !keep, stdio: 'ignore', windowsHide: false });
  if (!keep) { child.unref(); return true; }
  return child;
}

// Join a server by address. The documented launch option is -directconnect ip:port.
function validAddress(a) {
  const m = String(a || '').trim().match(/^([a-z0-9.-]+):(\d{2,5})$/i);
  return m ? `${m[1]}:${m[2]}` : null;
}

module.exports = { readSettings, quickStart, launch, validAddress, classFor };
