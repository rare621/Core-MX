// Scans the MX Bikes mods folder (and the manager's disabled-mods folder) into a flat list of items.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { withZip } = require('./zipread');
const { parseIni } = require('./ini');

const ARCHIVE_EXT = new Set(['.zip', '.rar', '.7z']);
const RIDER_LABELS = {
  helmets: 'Helmets', paints: 'Rider Kits', gloves: 'Gloves', boots: 'Boots', protections: 'Protection',
  goggles: 'Goggles', riders: 'Rider Models', helmetcams: 'Helmet Cams', animations: 'Animations',
  fonts: 'Rider Fonts', 'boots paints': 'Boot Paints',
};
const TRACK_LABELS = { motocross: 'Motocross', supercross: 'Supercross', enduro: 'Enduro', supermoto: 'Supermoto' };

const iniCache = new Map(); // abs path + mtime -> info

async function isZip(file) {
  try {
    const fh = await fsp.open(file, 'r');
    const b = Buffer.alloc(4);
    await fh.read(b, 0, 4, 0);
    await fh.close();
    return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  } catch { return false; }
}

async function dirSize(dir) {
  let total = 0, files = 0;
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return { total, files }; }
  await Promise.all(ents.map(async (e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = await dirSize(p); total += r.total; files += r.files; }
    else { try { total += (await fsp.stat(p)).size; files++; } catch {} }
  }));
  return { total, files };
}

async function countFiles(dir, ext) {
  try { return (await fsp.readdir(dir)).filter((n) => n.toLowerCase().endsWith(ext)).length; } catch { return 0; }
}

function prettifyName(raw, group) {
  let name = raw.replace(/\.(pkz|pnt|zip|rar|7z)$/i, '');
  const tags = [];
  const oem = name.match(/^(MX\w*?|SM\w*?|EN\w*?)OEM_(\d{4})_(.+)$/i);
  if (oem) {
    tags.push(oem[1].toUpperCase() + ' OEM');
    return { title: `${oem[2]} ${oem[3].replace(/_/g, ' ')}`, tags };
  }
  const fac = name.match(/^FACTORY_(.+)$/i);
  if (fac) { tags.push('Factory'); return { title: `Factory ${fac[1].replace(/_/g, ' ')}`, tags }; }
  if (group !== 'rider') name = name.replace(/_/g, ' ');
  return { title: name.replace(/\s+/g, ' ').trim(), tags };
}

const BRANDS = [
  ['Honda', /\b(honda|crf?\s?\d{2,3}|cr\d{3})/i], ['Kawasaki', /\b(kawasaki|kx\s?\d|kxf)/i],
  ['KTM', /\b(ktm|\d{3}\s?sx-?f?\b|sx\d{3})/i], ['Yamaha', /\b(yamaha|yz\s?\d)/i], ['Suzuki', /\b(suzuki|rm-?z?\s?\d)/i],
  ['Husqvarna', /\b(husq|husky|fc\s?\d{3}|tc\s?\d{3})/i], ['GasGas', /\b(gas\s?gas|mc\s?\d{3})/i], ['TM', /\b(tm[_\s]|tm\d{3})/i],
  ['Fantic', /\b(fantic|xxf?\s?\d{3})/i], ['Beta', /\bbeta\b/i], ['Triumph', /\btriumph\b/i], ['Alta', /\balta\b/i],
  ['Stark', /\bstark\b/i], ['Sherco', /\bsherco\b/i],
];
const BRAND_NAMES = [['Honda', /honda/i], ['Kawasaki', /kawasaki/i], ['KTM', /\bktm/i], ['Yamaha', /yamaha/i], ['Suzuki', /suzuki/i],
  ['Husqvarna', /husq|husky/i], ['GasGas', /gas\s?gas/i], ['Fantic', /fantic/i], ['Beta', /\bbeta\b/i], ['Triumph', /triumph/i],
  ['Alta', /\balta\b/i], ['Stark', /\bstark\b/i], ['Sherco', /sherco/i], ['TM', /\btm\b/i]];
// Engine size bucket from a bike's name, e.g. "MX1OEM_2023_Honda_CRF450R" -> "450", electric bikes -> "Electric".
function detectCC(name) {
  const t = name.replace(/^(MX\w*?|SM\w*?|EN\w*?)OEM_/i, '').replace(/(19|20)\d{2}/g, ' ');
  if (/\b(MXE|electric|redshift|varg|e-?mx)\b|MXEOEM|alta|stark/i.test(name)) return 'Electric';
  const m = t.match(/(?:^|[^\d])(50|65|85|110|112|125|144|150|200|250|300|350|400|450|500|525|530)(?!\d)/);
  return m ? m[1] : null;
}
function detectClass(name) {
  const m = name.match(/^(MX\w*?|SM\w*?|EN\w*?)OEM_/i);
  if (m) return m[1].toUpperCase();
  if (/^FACTORY_/i.test(name)) return 'Factory';
  return null;
}

function detectBrand(s) {
  const t = s.replace(/_/g, ' ');
  for (const [b, re] of BRAND_NAMES) if (re.test(t)) return b; // explicit names win over model codes
  for (const [b, re] of BRANDS) if (re.test(t)) return b;
  return null;
}

// Find the main ini inside a track/model (zip entries or folder).
function pickIni(names) {
  // names: relative paths with '/' separators
  const inis = names.filter((n) => n.toLowerCase().endsWith('.ini') && !n.toLowerCase().endsWith('.ini.bak'));
  if (!inis.length) return null;
  inis.sort((a, b) => a.split('/').length - b.split('/').length);
  const named = inis.find((n) => {
    const parts = n.split('/');
    const base = parts[parts.length - 1].replace(/\.ini$/i, '');
    return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() === base.toLowerCase() : true;
  });
  return named || inis[0];
}

function infoFromIni(ini, iniRel, names) {
  const info = {};
  const i = ini.info || {}, ui = ini.ui || {};
  if (i.name) info.name = i.name;
  if (ui.author) info.author = ui.author;
  if (ui.location) info.location = ui.location;
  if (ui.pic_info) info.picInfo = ui.pic_info;
  if (i.length && i.length !== '1') info.length = i.length;
  const dir = iniRel.includes('/') ? iniRel.slice(0, iniRel.lastIndexOf('/') + 1) : '';
  const pic = ui.pic || 'track_image.tga';
  const picRel = dir + pic;
  if (names.some((n) => n.toLowerCase() === picRel.toLowerCase())) info.pic = names.find((n) => n.toLowerCase() === picRel.toLowerCase());
  else {
    const anyImg = names.find((n) => /(track_image|preview|thumb)[^/]*\.(tga|png|jpe?g)$/i.test(n));
    if (anyImg) info.pic = anyImg;
  }
  // count layouts (sub-tracks with their own ini)
  const layoutInis = names.filter((n) => n.toLowerCase().endsWith('.ini') && n.split('/').length > iniRel.split('/').length);
  if (layoutInis.length) info.layouts = layoutInis.length + 1;
  return info;
}

async function readInfoFromPkz(file, stat) {
  const key = file + '|' + stat.mtimeMs;
  if (iniCache.has(key)) return iniCache.get(key);
  let info = {};
  {
    try {
      info = await withZip(file, async (entries, read) => {
        const names = entries.map((e) => e.fileName);
        const iniRel = pickIni(names);
        if (!iniRel) {
          const img = names.find((n) => /(track_image|preview|thumb)[^/]*\.(tga|png|jpe?g)$/i.test(n));
          return img ? { pic: img } : {};
        }
        const buf = await read(entries.find((e) => e.fileName === iniRel), 2 * 1024 * 1024);
        return infoFromIni(parseIni(buf.toString('latin1')), iniRel, names);
      });
    } catch { info = { unreadable: true }; }
  }
  iniCache.set(key, info);
  return info;
}

async function listRecursive(dir, base = '', depth = 0, out = []) {
  if (depth > 3) return out;
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) await listRecursive(path.join(dir, e.name), rel, depth + 1, out);
    else out.push(rel);
  }
  return out;
}

async function readInfoFromDir(dir, stat) {
  const key = dir + '|' + stat.mtimeMs;
  if (iniCache.has(key)) return iniCache.get(key);
  let info = {};
  try {
    const names = await listRecursive(dir);
    const iniRel = pickIni(names);
    if (iniRel) {
      const txt = await fsp.readFile(path.join(dir, iniRel), 'latin1');
      info = infoFromIni(parseIni(txt), iniRel, names);
    } else {
      const img = names.find((n) => /(track_image|preview|thumb)[^/]*\.(tga|png|jpe?g)$/i.test(n));
      if (img) info.pic = img;
    }
  } catch {}
  iniCache.set(key, info);
  return info;
}

// Scan a directory whose children are individual mods (pkz + same-named folder = one item; pnt files; archives).
async function scanModelDir(ctx, rootAbs, rel, group, sub, label) {
  const abs = path.join(rootAbs, rel);
  let ents;
  try { ents = await fsp.readdir(abs, { withFileTypes: true }); } catch { return []; }
  const byName = new Map();
  for (const e of ents) {
    const lower = e.name.toLowerCase();
    const ext = path.extname(lower);
    let key, kind;
    if (e.isDirectory()) { key = e.name; kind = 'dir'; }
    else if (ext === '.pkz') { key = e.name.slice(0, -4); kind = 'pkz'; }
    else if (ext === '.pnt') { key = e.name; kind = 'pnt'; }
    else if (ARCHIVE_EXT.has(ext)) { key = e.name; kind = 'archive'; }
    else continue; // loose config files etc. are part of the game, not mods
    const k = key.toLowerCase();
    if (!byName.has(k)) byName.set(k, { name: key, parts: {} });
    byName.get(k).parts[kind] = e.name;
  }

  const items = [];
  await Promise.all([...byName.values()].map(async (g) => {
    const parts = [];
    let size = 0, mtime = 0, kind;
    let info = {};
    let paints = 0, goggles = 0;
    if (g.parts.pkz) {
      const p = path.join(abs, g.parts.pkz);
      const st = await fsp.stat(p).catch(() => null);
      if (st) {
        parts.push(rel + '/' + g.parts.pkz); size += st.size; mtime = Math.max(mtime, st.mtimeMs); kind = 'pkz';
        if (group !== 'bikes') info = await readInfoFromPkz(p, st);
        else info = { encrypted: !(await isZip(p)) };
      }
    }
    if (g.parts.dir) {
      const p = path.join(abs, g.parts.dir);
      const st = await fsp.stat(p).catch(() => null);
      if (st) {
        parts.push(rel + '/' + g.parts.dir);
        const ds = await dirSize(p); size += ds.total; mtime = Math.max(mtime, st.mtimeMs);
        paints = await countFiles(path.join(p, 'paints'), '.pnt');
        goggles = await countFiles(path.join(p, 'goggles'), '.pnt');
        if (!kind) {
          kind = 'folder';
          if (group !== 'bikes') info = await readInfoFromDir(p, st);
        }
        if (!g.parts.pkz && ds.files === 0) kind = 'empty';
      }
    }
    for (const k of ['pnt', 'archive']) {
      if (g.parts[k]) {
        const p = path.join(abs, g.parts[k]);
        const st = await fsp.stat(p).catch(() => null);
        if (st) { parts.push(rel + '/' + g.parts[k]); size += st.size; mtime = Math.max(mtime, st.mtimeMs); kind = kind || k; }
      }
    }
    if (!parts.length) return;
    const { title, tags } = prettifyName(info.name || g.name, group);
    const key = parts[0];
    items.push({
      id: (ctx.disabled ? 'D:' : 'E:') + key,
      key,
      name: g.name,
      title,
      tags,
      group, sub, label,
      kind,
      parts,
      size, mtime,
      paints, goggles,
      info,
      brand: group === 'bikes' ? detectBrand(g.name) : null,
      cc: group === 'bikes' ? detectCC(g.name) : null,
      bikeClass: group === 'bikes' ? detectClass(g.name) : null,
      disabled: ctx.disabled,
      primary: path.join(rootAbs, key),
    });
  }));
  return items;
}

async function scanRoot(rootAbs, disabled) {
  const ctx = { disabled };
  let ents;
  try { ents = await fsp.readdir(rootAbs, { withFileTypes: true }); } catch { return []; }
  const jobs = [];
  for (const e of ents) {
    const n = e.name, lower = n.toLowerCase();
    if (!e.isDirectory()) {
      continue;
    }
    if (lower === 'tracks') {
      const subs = await fsp.readdir(path.join(rootAbs, n), { withFileTypes: true }).catch(() => []);
      for (const s of subs) {
        if (s.isDirectory()) jobs.push(scanModelDir(ctx, rootAbs, `${n}/${s.name}`, 'tracks', s.name.toLowerCase(), TRACK_LABELS[s.name.toLowerCase()] || s.name));
      }
      // Loose files directly in tracks/ (wrong place): skip the type folders themselves
      jobs.push(scanModelDir(ctx, rootAbs, n, 'tracks', '(loose)', 'Misplaced (tracks/)')
        .then((xs) => xs.filter((x) => !TRACK_LABELS[x.name.toLowerCase()])));
    } else if (lower === 'rider') {
      const subs = await fsp.readdir(path.join(rootAbs, n), { withFileTypes: true }).catch(() => []);
      // Current layout: rider/riders/<rider model>/<gear type>/...
      const riders = subs.find((s) => s.isDirectory() && s.name.toLowerCase() === 'riders');
      let hasModern = false;
      if (riders) {
        jobs.push(scanModelDir(ctx, rootAbs, `${n}/${riders.name}`, 'rider', 'riders', 'Rider models').then((rows) => rows.filter((i) => i.kind === 'pkz' || fs.existsSync(path.join(rootAbs, n, riders.name, i.name, 'rider.edf')) || fs.existsSync(path.join(rootAbs, n, riders.name, i.name, 'rider.hrc'))).map((i) => ({ ...i, virtual: true }))));
        const models = await fsp.readdir(path.join(rootAbs, n, riders.name), { withFileTypes: true }).catch(() => []);
        for (const m of models) {
          if (!m.isDirectory()) continue;
          const gear = await fsp.readdir(path.join(rootAbs, n, riders.name, m.name), { withFileTypes: true }).catch(() => []);
          for (const g of gear) {
            if (!g.isDirectory()) continue;
            hasModern = true;
            const gl = g.name.toLowerCase();
            const label = (RIDER_LABELS[gl] || g.name) + (m.name.toLowerCase() === 'default_mx' ? '' : ` (${m.name})`);
            jobs.push(scanModelDir(ctx, rootAbs, `${n}/${riders.name}/${m.name}/${g.name}`, 'rider', `${m.name.toLowerCase()}/${gl}`, label));
          }
        }
      }
      // Older layout: rider/<gear type>/...
      for (const s of subs) {
        if (!s.isDirectory() || s === riders) continue;
        const sl = s.name.toLowerCase();
        const label = (RIDER_LABELS[sl] || s.name) + (hasModern ? ' · old layout' : '');
        jobs.push(scanModelDir(ctx, rootAbs, `${n}/${s.name}`, 'rider', (hasModern ? 'legacy/' : '') + sl, label));
      }
    } else if (lower.startsWith('bikes')) {
      jobs.push(scanModelDir(ctx, rootAbs, n, 'bikes', lower, lower === 'bikes' ? 'Bikes' : n));
    } else if (lower === 'tyres') {
      jobs.push(scanModelDir(ctx, rootAbs, n, 'tyres', 'tyres', 'Tyres'));
    } else if (lower === 'misc') {
      const subs = await fsp.readdir(path.join(rootAbs, n), { withFileTypes: true }).catch(() => []);
      for (const s of subs) if (s.isDirectory()) jobs.push(scanModelDir(ctx, rootAbs, `${n}/${s.name}`, 'misc', s.name.toLowerCase(), s.name));
    } else {
      jobs.push(scanModelDir(ctx, rootAbs, n, 'other', lower, n));
    }
  }
  return (await Promise.all(jobs)).flat();
}

function markDuplicates(items) {
  const groups = new Map();
  for (const it of items) {
    const norm = it.name.replace(/\s*\(\d+\)\s*$/, '').toLowerCase().trim();
    const k = `${it.group}|${it.sub}|${norm}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.name.length - b.name.length || a.mtime - b.mtime);
    const original = list[0];
    for (const it of list.slice(1)) {
      it.duplicateOf = original.key;
      it.duplicateExact = it.size === original.size;
    }
    original.hasDuplicates = list.length - 1;
  }
}

// The game's built-in tracks live inside <install>/tracks.pkz, not in mods/.
const stockCache = new Map();
async function scanStock(installDir) {
  if (!installDir) return [];
  const file = path.join(installDir, 'tracks.pkz');
  const st = await fsp.stat(file).catch(() => null);
  if (!st) return [];
  const ck = file + '|' + st.mtimeMs;
  if (stockCache.has(ck)) return stockCache.get(ck);
  let out = [];
  try {
    out = await withZip(file, async (entries, read) => {
      const names = entries.map((e) => e.fileName);
      const items = [];
      for (const e of entries) {
        const m = e.fileName.match(/^tracks\/([^/]+)\/([^/]+)\/\2\.ini$/i);
        if (!m) continue;
        const [, type, folder] = m;
        const ini = parseIni((await read(e, 1024 * 1024)).toString('latin1'));
        const sub = names.filter((n) => n.startsWith(`tracks/${type}/${folder}/`));
        const info = infoFromIni(ini, e.fileName, sub);
        // alternate layouts are their own .ini files deeper in the track folder
        const layoutNames = [];
        for (const le of entries) {
          if (le === e || !le.fileName.startsWith(`tracks/${type}/${folder}/`) || !/\.ini$/i.test(le.fileName)) continue;
          const li = parseIni((await read(le, 1024 * 1024)).toString('latin1'));
          if (li.info && li.info.name) layoutNames.push(li.info.name);
        }
        info.layoutNames = layoutNames;
        const t = type.toLowerCase();
        items.push({
          id: `S:stock/${t}/${folder}`, key: `stock/${t}/${folder}`, name: folder,
          title: info.name || folder, tags: [], group: 'tracks', sub: t,
          label: TRACK_LABELS[t] || type.replace(/\b\w/g, (c) => c.toUpperCase()),
          kind: 'stock', stock: true, parts: [], size: 0, mtime: 0, paints: 0, goggles: 0,
          info, brand: null, disabled: false, abs: file,
        });
      }
      return items;
    });
  } catch { out = []; }
  stockCache.set(ck, out);
  return out;
}

async function scanAll(modsDir, disabledDir, installDir) {
  const t0 = Date.now();
  const [enabled, disabled, stock] = await Promise.all([scanRoot(modsDir, false), scanRoot(disabledDir, true), scanStock(installDir)]);
  const items = [...enabled, ...disabled, ...stock];
  for (const model of items.filter((i) => i.group === 'rider' && i.sub === 'riders')) {
    const nested = items.filter((i) => i !== model && i.disabled === model.disabled && i.group === 'rider'
      && i.parts.some((part) => model.parts.some((base) => !/\.pkz$/i.test(base) && part.startsWith(base + '/'))));
    model.accountedSize = Math.max(0, model.size - nested.reduce((sum, i) => sum + i.size, 0));
  }
  // Bike paints are also individual manageable items in My gear. They remain
  // included in their parent bike's size, so accounting skips these child rows.
  const paints = [];
  for (const bike of items.filter((i) => i.group === 'bikes' && !i.stock)) {
    const parent = bike.parts.find((p) => !/\.(pkz|pnt|zip|rar|7z)$/i.test(p));
    if (!parent) continue;
    const root = bike.disabled ? disabledDir : modsDir;
    const dir = path.join(root, parent, 'paints');
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isFile() || !/\.pnt$/i.test(e.name)) continue;
      const key = `${parent}/paints/${e.name}`, st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
      if (!st) continue;
      paints.push({ id: (bike.disabled ? 'D:' : 'E:') + key, key, name: e.name.slice(0, -4), title: e.name.slice(0, -4).replace(/_/g, ' '),
        group: 'bikePaints', sub: 'bikePaints', label: 'Bike livery', kind: 'pnt', parts: [key], size: st.size, mtime: st.mtimeMs,
        bike: bike.name, bikeTitle: bike.title, brand: bike.brand, cc: bike.cc, bikeClass: bike.bikeClass,
        disabled: bike.disabled, virtual: true, info: {}, tags: [bike.title], paints: 0, goggles: 0, primary: path.join(dir, e.name) });
    }
  }
  items.push(...paints);
  markDuplicates(items.filter((i) => !i.disabled && !i.stock));
  return { items, ms: Date.now() - t0 };
}

module.exports = { scanAll, prettifyName, detectBrand, detectCC, detectClass, readInfoFromPkz, readInfoFromDir, isZip, dirSize };
