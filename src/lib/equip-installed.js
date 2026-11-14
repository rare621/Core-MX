const path = require('path');
const { canonical } = require('./rider-layout');
function choices(files) {
  const groups = new Map();
  const add = (key, data, paint) => { if (!groups.has(key)) groups.set(key, { ...data, paints: [] }); if (paint != null && !groups.get(key).paints.includes(paint)) groups.get(key).paints.push(paint); };
  for (let file of files) {
    if (file.startsWith('game:')) continue;
    let m = file.match(/^bikes\/([^/]+)\/paints\/([^/]+)\.pnt$/i);
    if (m) { add('bike:' + m[1], { kind: 'bike', bike: m[1], label: m[1].replace(/_/g, ' '), slot: 'bikePaint', changes: {} }, m[2]); continue; }
    file = canonical(file);
    m = file.match(/^rider\/(helmets|boots|protections)\/([^/]+?)(?:\.pkz|\/(.+))$/i);
    if (m) {
      const slot = ({ helmets: 'helmet', boots: 'boots', protections: 'protection' })[m[1]];
      const paint = m[3]?.match(/^(paints|goggles)\/([^/]+)\.pnt$/i);
      const paintSlot = paint?.[1] === 'goggles' ? 'gogglesPaint' : slot === 'helmet' ? 'helmetPaint' : slot === 'boots' ? 'bootsPaint' : 'protectionPaint';
      if (paint || /\.pkz$/i.test(file) || /\.(edf|hrc|cfg)$/i.test(file)) add(`${slot}:${m[2]}:${paintSlot}`, { kind: 'gear', label: m[2].replace(/_/g, ' '), slot: paintSlot, changes: { [slot]: m[2] } }, paint?.[2]);
      continue;
    }
    m = file.match(/^rider\/riders\/([^/]+)\/(paints|gloves)\/([^/]+)\.pnt$/i);
    if (m) { const slot = m[2] === 'gloves' ? 'glovesPaint' : 'suitPaint'; add(`${m[1]}:${slot}`, { kind: 'gear', label: m[1].replace(/_/g, ' '), slot, changes: { rider: m[1] } }, m[3]); continue; }
    m = file.match(/^rider\/riders\/([^/]+)\.pkz$/i);
    if (m) add(`${m[1]}:suitPaint`, { kind: 'gear', label: m[1].replace(/_/g, ' '), slot: 'suitPaint', changes: { rider: m[1] } });
  }
  return [...groups.values()];
}
function changesFor(choice, current, paint) {
  const out = {};
  if (choice.changes.rider && choice.changes.rider !== current.rider) Object.assign(out, { rider: choice.changes.rider, suitPaint: '', glovesPaint: '', helmet: 'default', helmetPaint: '', gogglesPaint: '', boots: 'default', bootsPaint: '', protection: '', protectionPaint: '' });
  if (choice.changes.helmet && choice.changes.helmet !== current.helmet) Object.assign(out, { helmetPaint: '', gogglesPaint: '' });
  if (choice.changes.boots && choice.changes.boots !== current.boots) out.bootsPaint = '';
  if (choice.changes.protection && choice.changes.protection !== current.protection) out.protectionPaint = '';
  Object.assign(out, choice.changes);
  if (paint != null) out[choice.slot] = paint;
  return out;
}
module.exports = { choices, changesFor };
