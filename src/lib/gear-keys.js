// Catalog keys for gear: what a file is, independent of where on a PC it lives.
//   helmets/<model>, boots/<model>, protections/<model>, riders/<model>, tyres/<name>, bikes/<bike>,
//   helmetpaints/<helmet>/<paint>, goggles/<helmet>/<paint>, bootpaints/<boots>/<paint>,
//   protectionpaints/<protection>/<paint>, suits/<rider>/<paint>, gloves/<rider>/<paint>,
//   bikepaints/<bike>/<paint>
// Lowercase. The service (server/mxbm-server.js, catalogKey) accepts only these shapes.

const clean = (s) => String(s || '').replace(/\.(pkz|pnt)$/i, '').trim().toLowerCase();
const ok = (...parts) => parts.every((p) => p && p !== '.' && p !== '..' && p.length <= 64 && !/[\u0000-\u001f\u007f\\:*?"<>|/]/.test(p));
const key = (kind, ...parts) => { const p = parts.map(clean); return ok(...p) ? [kind, ...p].join('/') : null; };
const MODEL_DIR = { helmets: 'helmets', boots: 'boots', protections: 'protections', riders: 'riders' };
const PAINT_DIR = { helmets: { paints: 'helmetpaints', goggles: 'goggles' }, boots: { paints: 'bootpaints' }, protections: { paints: 'protectionpaints' }, riders: { paints: 'suits', gloves: 'gloves' } };

// The keys for one installed file (a path relative to the mods folder), or [].
function keysForFile(rel) {
  const p = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (/^(game|user):/i.test(p)) return [];
  const s = p.split('/').filter(Boolean);
  if (s[0] === 'rider' && MODEL_DIR[s[1]] && s[2]) {
    const model = s[2];
    if (s.length === 3) return /\.pkz$/i.test(model) || !/\./.test(model) ? [key(MODEL_DIR[s[1]], model)].filter(Boolean) : [];
    const paintKind = PAINT_DIR[s[1]][s[3]];
    if (paintKind && s.length === 5 && /\.pnt$/i.test(s[4])) return [key(paintKind, model, s[4])].filter(Boolean);
    return [key(MODEL_DIR[s[1]], model)].filter(Boolean);
  }
  // The older flat layout: rider/paints, rider/gloves belong to the default rider.
  if (s[0] === 'rider' && (s[1] === 'paints' || s[1] === 'gloves') && s.length === 3 && /\.pnt$/i.test(s[2])) return [key(s[1] === 'paints' ? 'suits' : 'gloves', 'default_mx', s[2])].filter(Boolean);
  if (s[0] === 'bikes' && s[1]) {
    if (s[2] === 'paints' && s.length === 4 && /\.pnt$/i.test(s[3])) return [key('bikepaints', s[1], s[3])].filter(Boolean);
    return [key('bikes', s[1])].filter(Boolean);
  }
  if (s[0] === 'tyres' && s[1]) return [key('tyres', s[1])].filter(Boolean);
  return [];
}
const keysForFiles = (files) => [...new Set((files || []).flatMap(keysForFile))];

// The key for an item someone wears: slot and name from their loadout, cur = their equipped values.
function keyForItem(slot, name, cur = {}, bike = '') {
  const rider = cur.rider || 'default_mx';
  switch (slot) {
    case 'helmet': return key('helmets', name);
    case 'boots': return key('boots', name);
    case 'protection': return key('protections', name);
    case 'rider': return key('riders', name);
    case 'tyres': case 'tyreBase': return key('tyres', name);
    case 'helmetPaint': return cur.helmet ? key('helmetpaints', cur.helmet, name) : null;
    case 'gogglesPaint': return cur.helmet ? key('goggles', cur.helmet, name) : null;
    case 'bootsPaint': return cur.boots ? key('bootpaints', cur.boots, name) : null;
    case 'protectionPaint': return cur.protection ? key('protectionpaints', cur.protection, name) : null;
    case 'suitPaint': return key('suits', rider, name);
    case 'glovesPaint': return key('gloves', rider, name);
    case 'bikePaint': return bike ? key('bikepaints', bike, name) : null;
    default: return null;
  }
}

module.exports = { keysForFile, keysForFiles, keyForItem };
