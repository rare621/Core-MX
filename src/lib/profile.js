// Reads and edits the rider loadout stored per bike in profiles/<name>/profile.ini.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const gearAssets = require('./gear-assets');

// Loadout slots: profile.ini section, and how to list the options for it.
// key 'bike' = value stored under the bike id; 'protectionModel' = stored under the chosen protection model.
const SLOTS = [
  { id: 'bikePaint', label: 'Bike livery', section: 'paint', key: 'bike', group: 'Bike' },
  { id: 'tyres', label: 'Tyres / wheels', section: 'tyres', key: 'bike', group: 'Bike' },
  { id: 'rider', label: 'Rider model', section: 'rider', key: 'bike', group: 'Rider', default: 'default_mx' },
  { id: 'helmet', label: 'Helmet', section: 'helmet', key: 'bike', group: 'Head', default: 'default' },
  { id: 'helmetPaint', label: 'Helmet paint', section: 'helmet_paint', key: 'bike', group: 'Head' },
  { id: 'gogglesPaint', label: 'Goggles', section: 'goggles_paint', key: 'bike', group: 'Head' },
  { id: 'suitPaint', label: 'Rider kit (jersey & pants)', section: 'suit_paint', key: 'bike', group: 'Body' },
  { id: 'protection', label: 'Chest protector / neck brace', section: 'protection', key: 'bike', group: 'Body' },
  { id: 'protectionPaint', label: 'Protector paint', section: 'protection_paint', key: 'protectionModel', group: 'Body' },
  { id: 'glovesPaint', label: 'Gloves', section: 'gloves_paint', key: 'bike', group: 'Hands & feet' },
  { id: 'boots', label: 'Boots', section: 'boots', key: 'bike', group: 'Hands & feet', default: 'default' },
  { id: 'bootsPaint', label: 'Boot paint', section: 'boots_paint', key: 'bike', group: 'Hands & feet' },
];

function parseSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = {};
  let cur = null;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*\[(.+)\]\s*$/);
    if (m) { cur = m[1]; sections[cur] = sections[cur] || { start: i, values: {} }; return; }
    if (!cur) return;
    const eq = line.indexOf('=');
    if (eq > 0) sections[cur].values[line.slice(0, eq)] = line.slice(eq + 1);
  });
  return { lines, sections };
}

async function listProfiles(userDir) {
  const dir = path.join(userDir, 'profiles');
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'profile.ini'))) out.push(e.name);
  }
  let last = null;
  try { last = (await fsp.readFile(path.join(userDir, 'global.ini'), 'latin1')).match(/lastprofile=(.*)/)[1].trim(); } catch {}
  return { profiles: out, last: out.includes(last) ? last : out[0] || null };
}

async function readProfile(userDir, name) {
  const file = path.join(userDir, 'profiles', name, 'profile.ini');
  const text = await fsp.readFile(file, 'latin1');
  return { file, ...parseSections(text) };
}

async function names(dir, filter) {
  const out = new Set();
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (filter === 'pnt') { if (!e.isDirectory() && /\.pnt$/i.test(e.name)) out.add(e.name.slice(0, -4)); }
    else if (e.isDirectory()) out.add(e.name);
    else if (/\.pkz$/i.test(e.name)) out.add(e.name.slice(0, -4));
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

// Only the body, kit paints and glove paints are in this rider-model folder.
function gearDir(modsDir, rider) {
  return path.join(modsDir, 'rider', 'riders', rider || 'default_mx');
}

async function bikeDirs(modsDir) {
  const out = [];
  for (const e of await fsp.readdir(modsDir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && /^bikes/i.test(e.name)) out.push(path.join(modsDir, e.name));
  }
  return out;
}

async function findBikeDir(modsDir, bike) {
  for (const d of await bikeDirs(modsDir)) {
    const p = path.join(d, bike);
    if (fs.existsSync(p) || fs.existsSync(p + '.pkz')) return p;
  }
  return null;
}

// The bike the game will actually put you on. [info] bikeid goes stale (the online/race menus don't
// update it); the game remembers the bike per class in [category] (and [bike]) keyed by [info] class.
function currentBike(prof) {
  const sec = (n) => (prof.sections[n] && prof.sections[n].values) || {};
  const info = sec('info');
  const pick = (vals, key) => { if (!key) return null; const k = Object.keys(vals).find((x) => x.toLowerCase() === String(key).toLowerCase()); return k ? vals[k] : null; };
  return pick(sec('category'), info.class) || pick(sec('bike'), info.class) || info.bikeid || null;
}

async function listBikes(modsDir, prof) {
  const set = new Map();
  for (const d of await bikeDirs(modsDir)) {
    for (const n of await names(d)) if (!set.has(n)) set.set(n, { id: n, folder: path.basename(d), installed: true });
  }
  for (const sec of ['paint', 'helmet', 'rider']) {
    for (const k of Object.keys((prof.sections[sec] || {}).values || {})) if (!set.has(k)) set.set(k, { id: k, installed: false });
  }
  const configured = new Set(Object.keys((prof.sections.paint || {}).values || {}));
  const selected = currentBike(prof);
  return [...set.values()].map((b) => ({ ...b, configured: configured.has(b.id), selected: b.id === selected }));
}

// Current values for one bike + the available choices for each slot.
async function loadout(modsDir, prof, bike, stockPkz) {
  const val = (sec, key) => (prof.sections[sec] && prof.sections[sec].values[key] !== undefined ? prof.sections[sec].values[key] : null);
  const cur = {};
  for (const s of SLOTS.filter((x) => x.key === 'bike')) cur[s.id] = val(s.section, bike);
  if (!cur.rider) cur.rider = 'default_mx';
  const protModel = cur.protection || '';
  cur.protectionPaint = val('protection_paint', protModel);

  const gd = gearDir(modsDir, cur.rider);
  const helmet = cur.helmet && cur.helmet !== 'default' ? cur.helmet : null;
  const boots = cur.boots && cur.boots !== 'default' ? cur.boots : null;
  const bikeDir = await findBikeDir(modsDir, bike);

  const opts = {
    bikePaint: bikeDir ? await names(path.join(bikeDir, 'paints'), 'pnt') : [],
    tyres: ['', ...await require('./tyres').options(modsDir, stockPkz, bikeDir, bike)],
    rider: await names(path.join(modsDir, 'rider', 'riders')),
    helmet: ['default', ...(await names(path.join(gd, 'helmets')))],
    helmetPaint: helmet ? await names(path.join(gd, 'helmets', helmet, 'paints'), 'pnt') : [],
    gogglesPaint: helmet ? await names(path.join(gd, 'helmets', helmet, 'goggles'), 'pnt') : await names(path.join(gd, 'goggles'), 'pnt'),
    suitPaint: await names(path.join(gd, 'paints'), 'pnt'),
    protection: ['', 'full', 'neck'],
    protectionPaint: await names(path.join(gd, 'protections', protModel, 'paints'), 'pnt'),
    glovesPaint: await names(path.join(gd, 'gloves'), 'pnt'),
    boots: ['default', ...(await names(path.join(gd, 'boots')))],
    bootsPaint: boots ? await names(path.join(gd, 'boots', boots, 'paints'), 'pnt') : await names(path.join(gd, 'boots'), 'pnt'),
  };
  Object.assign(opts, await gearAssets.catalog({ modsDir, rider: cur.rider, stockPkz }, cur));
  const invalidTyres = cur.tyres && !opts.tyres.includes(cur.tyres) ? cur.tyres : null;
  if (invalidTyres) cur.tyres = '';
  // Keep a current value that isn't a file on disk (built-in paints live inside the bike/gear .pkz).
  for (const s of SLOTS) {
    const v = cur[s.id];
    if (v && !opts[s.id].includes(v)) opts[s.id] = [v, ...opts[s.id]];
  }
  return { bike, slots: SLOTS, current: cur, options: opts, invalidTyres, protectionModel: protModel, selectedInGame: currentBike(prof) === bike, gearDir: gd };
}

function isGameRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq mxbikes*', '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
      resolve(!err && /^"mxbikes(?:64)?\.exe",/im.test(out || ''));
    });
  });
}

// values: [[section, key, value], ...]. Writes in place, keeping every other line untouched.
async function writeValues(userDir, name, values) {
  if (await isGameRunning()) throw new Error('MX Bikes is running. Close the game first — it rewrites the profile when it exits, which would undo these changes.');
  const prof = await readProfile(userDir, name);
  const lines = prof.lines.slice();
  applyValues(lines, values);
  await backupAndWrite(prof.file, lines);
  return { ok: true };
}

function applyValues(lines, values) {
  for (const [section, key, value] of values) {
    const re = new RegExp(`^\\[${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*$`);
    let start = lines.findIndex((l) => re.test(l));
    if (start < 0) { lines.push('', `[${section}]`); start = lines.length - 1; }
    let end = lines.findIndex((l, i) => i > start && /^\s*\[.+\]\s*$/.test(l));
    if (end < 0) end = lines.length;
    let done = false;
    for (let i = start + 1; i < end; i++) {
      if (lines[i].startsWith(key + '=')) { lines[i] = `${key}=${value}`; done = true; break; }
    }
    if (!done) {
      let at = end;
      while (at > start + 1 && lines[at - 1].trim() === '') at--;
      lines.splice(at, 0, `${key}=${value}`);
    }
  }
}

async function backupAndWrite(file, lines) {
  const backup = file + '.mxbm-backup';
  if (!fs.existsSync(backup)) await fsp.copyFile(file, backup);
  await fsp.copyFile(file, file + '.mxbm-last');
  await fsp.writeFile(file, lines.join('\r\n'), 'latin1');
}

// changes: { [bike]: { slotId: value } }. Writes in place, keeping every other line untouched.
async function saveLoadouts(userDir, name, changes) {
  if (await isGameRunning()) throw new Error('MX Bikes is running. Close the game first — it rewrites the profile when it exits, which would undo these changes.');
  const prof = await readProfile(userDir, name);
  const lines = prof.lines.slice();
  const setValue = (section, key, value) => {
    const re = new RegExp(`^\\[${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*$`);
    let start = lines.findIndex((l) => re.test(l));
    if (start < 0) { lines.push('', `[${section}]`); start = lines.length - 1; }
    let end = lines.findIndex((l, i) => i > start && /^\s*\[.+\]\s*$/.test(l));
    if (end < 0) end = lines.length;
    for (let i = start + 1; i < end; i++) {
      if (lines[i].startsWith(key + '=')) { lines[i] = `${key}=${value}`; return; }
    }
    // insert after the last non-empty line of the section
    let at = end;
    while (at > start + 1 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, `${key}=${value}`);
  };
  for (const [bike, slots] of Object.entries(changes)) {
    // protection paint is keyed by the protection model chosen for that bike
    const protModel = slots.protection || (prof.sections.protection && prof.sections.protection.values[bike]) || 'chest';
    for (const [slotId, value] of Object.entries(slots)) {
      const s = SLOTS.find((x) => x.id === slotId);
      if (!s) continue;
      setValue(s.section, s.key === 'bike' ? bike : protModel, value == null ? '' : String(value));
    }
  }
  const backup = prof.file + '.mxbm-backup';
  if (!fs.existsSync(backup)) await fsp.copyFile(prof.file, backup);
  await fsp.copyFile(prof.file, prof.file + '.mxbm-last');
  await fsp.writeFile(prof.file, lines.join('\r\n'), 'latin1');
  return { ok: true, backup };
}

function profileName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 64 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^\.+$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Choose a profile name without reserved characters');
  return name;
}

async function createProfile(userDir, label, source, copyGear = true) {
  if (await isGameRunning()) throw new Error('Close MX Bikes before creating a profile');
  const name = profileName(label), sourceName = profileName(source || (await listProfiles(userDir)).last);
  const root = path.resolve(userDir, 'profiles'), destination = path.join(root, name);
  const current = await readProfile(userDir, sourceName);
  await fsp.mkdir(root, { recursive: true });
  if (fs.existsSync(destination)) throw new Error('A profile with that name already exists');
  await fsp.mkdir(destination);
  try {
    for (const file of await fsp.readdir(path.dirname(current.file), { withFileTypes: true })) {
      if (file.isFile() && /\.(ini|txt|cfg)$/i.test(file.name) && !/records\.ini$/i.test(file.name)) await fsp.copyFile(path.join(path.dirname(current.file), file.name), path.join(destination, file.name));
    }
    if (!copyGear) {
      const gearSections = new Set(SLOTS.map((slot) => slot.section));
      let skip = false;
      const text = (await fsp.readFile(path.join(destination, 'profile.ini'), 'latin1')).split(/\r?\n/).filter((line) => {
        const section = line.match(/^\s*\[([^\]]+)\]/);
        if (section) skip = gearSections.has(section[1]);
        return !skip;
      }).join('\r\n');
      await fsp.writeFile(path.join(destination, 'profile.ini'), text, 'latin1');
    }
    return { name, ...(await listProfiles(userDir)) };
  } catch (error) {
    if (path.dirname(destination) === root) await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function activateProfile(userDir, value) {
  if (await isGameRunning()) throw new Error('Close MX Bikes before changing its active profile');
  const name = profileName(value);
  await readProfile(userDir, name);
  const file = path.join(userDir, 'global.ini');
  const text = await fsp.readFile(file, 'latin1');
  let updated;
  if (/^lastprofile=.*$/m.test(text)) updated = text.replace(/^lastprofile=.*$/m, `lastprofile=${name}`);
  else if (/^\[profile\]\s*$/m.test(text)) updated = text.replace(/^\[profile\]\s*$/m, `[profile]\r\nlastprofile=${name}`);
  else updated = text + `\r\n[profile]\r\nlastprofile=${name}\r\n`;
  await backupAndWrite(file, updated.split(/\r?\n/));
  return { name, ...(await listProfiles(userDir)) };
}

async function deleteProfile(userDir, value, trash) {
  if (await isGameRunning()) throw new Error('Close MX Bikes before deleting a profile');
  const name = profileName(value), list = await listProfiles(userDir);
  if (!list.profiles.includes(name)) throw new Error('Profile not found');
  if (list.profiles.length < 2) throw new Error('Create another profile before deleting your only profile');
  const folder = path.resolve(userDir, 'profiles', name), parent = path.resolve(userDir, 'profiles') + path.sep;
  if (!folder.toLowerCase().startsWith(parent.toLowerCase())) throw new Error('Invalid profile path');
  const active = list.last === name;
  if (active) await activateProfile(userDir, list.profiles.find((p) => p !== name));
  try { await trash(folder); } catch (e) { if (active) await activateProfile(userDir, name); throw e; }
  return listProfiles(userDir);
}

module.exports = { SLOTS, currentBike, findBikeDir, gearDir, listProfiles, readProfile, listBikes, loadout, saveLoadouts, writeValues, isGameRunning, createProfile, activateProfile, deleteProfile };
