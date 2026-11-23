// Gear synced from other riders (paint sync, live looks) sits in the game's mods folder because MX
// Bikes has to load it to draw them. CoreMX keeps it apart for the player: it is listed under My gear >
// Synced from friends, and not offered in the Rider tab, since a synced model only carries the paints
// that rider wears. Once the player installs the same mod themselves (Get Mods), that install owns the
// files and they are ordinary gear again.
const fs = require('fs');
const path = require('path');

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
const MODEL_DIRS = { helmet: 'helmets', boots: 'boots', protection: 'protections' };

// received (online config: path -> { sha256, from, at }) minus files an install record owns, plus files
// of installs made for another rider (record.forOthers: fetched from MXB Mods for their gear).
function syncedOnly(received, installs) {
  const owned = new Set(), forOthers = new Map();
  for (const r of Object.values(installs || {})) {
    for (const f of (r && r.files) || []) {
      if (/^(game|user):/i.test(String(f))) continue;
      if (r.forOthers) { if (!forOthers.has(norm(f))) forOthers.set(norm(f), { from: r.forRider || '', install: true }); }
      else owned.add(norm(f));
    }
  }
  const out = new Map();
  for (const [p, info] of Object.entries(received || {})) if (!owned.has(norm(p))) out.set(norm(p), info || {});
  for (const [p, info] of forOthers) if (!owned.has(p) && !out.has(p)) out.set(p, info);
  return out;
}

// Rider tab choices that exist only as synced files, per slot (lower-case names). current: the
// loadout's selected values (rider, helmet, boots, protection) for the paint folders. modelElsewhere
// (kind, name): true when the model is also installed another way (then it stays a choice).
function hiddenChoices(synced, current = {}, bike = '', modelElsewhere = () => false) {
  const hide = {};
  const add = (slot, name) => { (hide[slot] = hide[slot] || new Set()).add(String(name).toLowerCase()); };
  const lc = (v) => String(v || '').toLowerCase();
  for (const p of synced.keys()) {
    let m;
    if ((m = p.match(/^rider\/riders\/([^/]+)\.pkz$/))) { if (!modelElsewhere('rider', m[1])) add('rider', m[1]); continue; }
    if ((m = p.match(/^rider\/(?:riders\/[^/]+\/)?(helmets|boots|protections)\/([^/]+)\.pkz$/))) {
      const kind = { helmets: 'helmet', boots: 'boots', protections: 'protection' }[m[1]];
      if (!modelElsewhere(kind, m[2])) add(kind, m[2]);
      continue;
    }
    if ((m = p.match(/^rider\/(?:riders\/[^/]+\/)?helmets\/([^/]+)\/(paints|goggles)\/([^/]+)\.pnt$/)) && m[1] === lc(current.helmet)) { add(m[2] === 'paints' ? 'helmetPaint' : 'gogglesPaint', m[3]); continue; }
    if ((m = p.match(/^rider\/(?:riders\/[^/]+\/)?boots\/([^/]+)\/paints\/([^/]+)\.pnt$/)) && m[1] === lc(current.boots)) { add('bootsPaint', m[2]); continue; }
    if ((m = p.match(/^rider\/(?:riders\/[^/]+\/)?protections\/([^/]+)\/paints\/([^/]+)\.pnt$/)) && m[1] === lc(current.protection)) { add('protectionPaint', m[2]); continue; }
    if ((m = p.match(/^rider\/(?:riders\/[^/]+\/)?(paints|gloves)\/([^/]+)\.pnt$/))) { add(m[1] === 'paints' ? 'suitPaint' : 'glovesPaint', m[2]); continue; }
    if ((m = p.match(/^bikes\/([^/]+)\/paints\/([^/]+)\.pnt$/)) && m[1] === lc(bike)) add('bikePaint', m[2]);
  }
  return hide;
}

// The same for the in-game overlay (mxbm_synced.txt, read by plugin/mxbm_presence.c), which lists
// every model's paints: "kind<TAB>model<TAB>name" lines, lower case. kind: helmet, boots, protection
// (model rows; model empty), helmetPaint, gogglesPaint, bootsPaint, protectionPaint (model = the
// helmet/boots/protector), suitPaint, glovesPaint (model empty: any rider), bikePaint (model = bike id).
function overlayList(synced, modelElsewhere = () => false) {
  const lines = ['coremx-synced 1'];
  for (const p of synced.keys()) {
    let m;
    if ((m = p.match(/^rider\/(?:riders\/[^/]+\/)?(helmets|boots|protections)\/([^/]+)\.pkz$/))) {
      const kind = { helmets: 'helmet', boots: 'boots', protections: 'protection' }[m[1]];
      if (!modelElsewhere(kind, m[2])) lines.push(`${kind}\t\t${m[2]}`);
    } else if ((m = p.match(/^rider\/(?:riders\/[^/]+\/)?(helmets|boots|protections)\/([^/]+)\/(paints|goggles)\/([^/]+)\.pnt$/))) {
      const kind = m[1] === 'helmets' ? (m[3] === 'goggles' ? 'gogglesPaint' : 'helmetPaint') : m[1] === 'boots' ? 'bootsPaint' : 'protectionPaint';
      lines.push(`${kind}\t${m[2]}\t${m[4]}`);
    } else if ((m = p.match(/^rider\/(?:riders\/[^/]+\/)?(paints|gloves)\/([^/]+)\.pnt$/))) lines.push(`${m[1] === 'paints' ? 'suitPaint' : 'glovesPaint'}\t\t${m[2]}`);
    else if ((m = p.match(/^bikes\/([^/]+)\/paints\/([^/]+)\.pnt$/))) lines.push(`bikePaint\t${m[1]}\t${m[2]}`);
  }
  return lines.map((l) => l.replace(/[\r\n]/g, ' ')).join('\n') + '\n';
}

// Drops hidden choices from a loadout's options, keeping whatever is selected now.
function filterOptions(options, hide, current = {}) {
  const out = { ...options };
  for (const [slot, names] of Object.entries(hide)) {
    if (!Array.isArray(out[slot])) continue;
    out[slot] = out[slot].filter((v) => !names.has(String(v).toLowerCase()) || v === current[slot]);
  }
  return out;
}

// Is this model installed in the mods folder other than as the given synced files?
function modelInstalledElsewhere(modsDir, synced, kind, name) {
  const dirs = kind === 'rider' ? ['rider/riders'] : [`rider/${MODEL_DIRS[kind]}`, `rider/riders/default_mx/${MODEL_DIRS[kind]}`];
  for (const d of dirs) for (const rel of [`${d}/${name}`, `${d}/${name}.pkz`]) {
    if (synced.has(norm(rel))) continue;
    if (fs.existsSync(path.join(modsDir, ...rel.split('/')))) return true;
  }
  return false;
}

// After an install: synced files it replaced belong to it now, and a synced model package of the same
// model it installed another way (folder vs .pkz) would be a duplicate for the game. Returns the
// received paths to forget and the synced files to move to the Recycle Bin.
function releaseAfterInstall(received, written) {
  const forget = [], trash = [];
  const wrote = new Set((written || []).map(norm));
  const models = new Set();
  for (const w of wrote) {
    // The model itself (a package, or a mesh in its folder), not a paint pack for it.
    const m = w.match(/^rider\/(?:riders\/[^/]+\/)?(helmets|boots|protections)\/([^/]+?)(?:\.pkz|\/[^/]+\.edf)$/) || w.match(/^rider\/riders\/([^/]+?)(?:\.pkz|\/[^/]+\.edf)$/);
    if (m) models.add(m[2] ? `${m[1]}/${m[2]}` : `riders/${m[1]}`);
  }
  for (const p of Object.keys(received || {})) {
    const k = norm(p);
    if (wrote.has(k)) { forget.push(p); continue; }
    const m = k.match(/^rider\/(?:riders\/[^/]+\/)?(helmets|boots|protections)\/([^/]+)\.pkz$/) || k.match(/^rider\/riders\/([^/]+)\.pkz$/);
    const key = m && (m[2] ? `${m[1]}/${m[2]}` : `riders/${m[1]}`);
    if (key && models.has(key)) { forget.push(p); trash.push(p); }
  }
  return { forget, trash };
}

module.exports = { syncedOnly, hiddenChoices, overlayList, filterOptions, modelInstalledElsewhere, releaseAfterInstall, norm };
