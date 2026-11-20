const path = require('path');
const { canonical } = require('./rider-layout');
const { chainOf, listFiles } = require('./asset-sources');
function choices(files) {
  const groups = new Map();
  const add = (key, data, paint) => {
    key = key.toLowerCase();
    if (!groups.has(key)) groups.set(key, { ...data, paints: [] });
    const group = groups.get(key);
    if (paint == null) group.hasModel = true;
    else if (!group.paints.some((name) => name.toLowerCase() === paint.toLowerCase())) group.paints.push(paint);
  };
  for (let file of files) {
    if (/^(game|user):/.test(file)) continue;
    file = canonical(file);
    let m = file.match(/^bikes\/([^/]+)\/paints\/([^/]+)\.pnt$/i);
    if (m) { add('bike:' + m[1], { kind: 'bike', bike: m[1], label: m[1].replace(/_/g, ' '), slot: 'bikePaint', changes: {} }, m[2]); continue; }
    m = file.match(/^rider\/(helmets|boots|protections)\/([^/]+?)(?:\.pkz|\/(.+))$/i);
    if (m) {
      const slot = ({ helmets: 'helmet', boots: 'boots', protections: 'protection' })[m[1].toLowerCase()];
      const paint = m[3]?.match(/^(paints|goggles)\/([^/]+)\.pnt$/i);
      const paintSlot = paint?.[1].toLowerCase() === 'goggles' ? 'gogglesPaint' : slot === 'helmet' ? 'helmetPaint' : slot === 'boots' ? 'bootsPaint' : 'protectionPaint';
      if (paint || /\.pkz$/i.test(file) || /\.(edf|hrc|cfg)$/i.test(file)) add(`${slot}:${m[2]}:${paintSlot}`, { kind: 'gear', label: m[2].replace(/_/g, ' '), slot: paintSlot, changes: { [slot]: m[2] } }, paint?.[2]);
      continue;
    }
    m = file.match(/^rider\/riders\/([^/]+)\/(paints|gloves)\/([^/]+)\.pnt$/i);
    if (m) { const slot = m[2].toLowerCase() === 'gloves' ? 'glovesPaint' : 'suitPaint'; add(`${m[1]}:${slot}`, { kind: 'gear', label: m[1].replace(/_/g, ' '), slot, changes: { rider: m[1] } }, m[3]); continue; }
    m = file.match(/^rider\/riders\/([^/]+)\.pkz$/i);
    if (m) add(`${m[1]}:suitPaint`, { kind: 'gear', label: m[1].replace(/_/g, ' '), slot: 'suitPaint', changes: { rider: m[1] } });
  }
  return [...groups.values()];
}
async function choicesFromFiles(files, modsDir) {
  const expanded = [...files];
  // Read only packages written by this install, never sibling paints already
  // in the library. The catalog uses the same package-root resolution.
  for (const file of files) {
    if (!/^(?:rider\/(?:riders|helmets|boots|protections)|bikes)\/[^/]+\.pkz$/i.test(canonical(file))) continue;
    const root = path.resolve(modsDir), target = path.resolve(root, file);
    if (!target.toLowerCase().startsWith(root.toLowerCase() + path.sep)) continue;
    const sources = await chainOf([{ pkz: target }]);
    for (const rel of await listFiles(sources)) {
      if (/^(paints|gloves|goggles)\/[^/]+\.pnt$/i.test(rel)) expanded.push(file.replace(/\.pkz$/i, '') + '/' + rel);
    }
  }
  return choices(expanded);
}
function availablePaints(choice, available) {
  // Windows/package names are case-insensitive. Return the catalog spelling.
  return [...new Set(choice.paints.map((name) => available.find((value) => value.toLowerCase() === name.toLowerCase())).filter((value) => value != null))];
}
function changesFor(choice, current, paint) {
  const out = {};
  if (choice.changes.rider && choice.changes.rider !== current.rider) Object.assign(out, { rider: choice.changes.rider, suitPaint: '', glovesPaint: '' });
  if (choice.changes.helmet && choice.changes.helmet !== current.helmet) Object.assign(out, { helmetPaint: '', gogglesPaint: '' });
  if (choice.changes.boots && choice.changes.boots !== current.boots) out.bootsPaint = '';
  if (choice.changes.protection && choice.changes.protection !== current.protection) out.protectionPaint = '';
  Object.assign(out, choice.changes);
  if (paint != null) out[choice.slot] = paint;
  return out;
}
module.exports = { choices, choicesFromFiles, availablePaints, changesFor };
