const fs = require('fs/promises');
const path = require('path');
const pnt = require('./pnt');
const edf = require('./edf');
const { decodeBlob } = require('./assetread');
const { chainOf, readChain, listFiles } = require('./asset-sources');
const gear = require('./gear-assets');

const clean = (names) => [...new Set(names.filter((n) => !edf.isCompanionTexture(n)).map((n) => n.toLowerCase()))];
const cache = new Map();
async function riderModels(modsDir, stockPkz) {
  const root = path.join(modsDir, 'rider', 'riders');
  const names = new Set(['default_mx', 'default_sm']);
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() || /\.pkz$/i.test(e.name)) names.add(e.name.replace(/\.pkz$/i, ''));
  const result = [];
  for (const name of names) {
    const sources = await chainOf([{ dir: path.join(root, name) }, stockPkz ? { pkz: stockPkz, prefix: `rider/riders/${name}` } : null]);
    const textures = new Set(); let model = false;
    for (const file of (await listFiles(sources)).filter((n) => /^[^/]+\.edf$/i.test(n))) {
      const data = await readChain(sources, file);
      if (!data) continue;
      try {
        if (!cache.has(data.key)) {
          const buf = decodeBlob(data.buf);
          if (!edf.isEdf(buf)) continue;
          cache.set(data.key, edf.embeddedTextures(buf).map((t) => t.name));
          while (cache.size > 24) cache.delete(cache.keys().next().value);
        }
        model = true;
        for (const n of clean(cache.get(data.key))) textures.add(n);
      } catch {}
    }
    if (/^default_(mx|sm)$/.test(name)) { model = true; for (const n of ['rider', 'gloves', 'skin']) textures.add(n); }
    if (model) result.push({ name, textures: [...textures] });
    else if (await fs.stat(path.join(root, name + '.pkz')).then((s) => s.isFile()).catch(() => false)) result.push({ name, textures: [], unverified: true });
  }
  return result;
}

function isBodyPaint(relative, names, kind = 'custom') {
  const textures = clean(names);
  if (textures.includes('abhoodie')) return true;
  if (/(^|\/)(helmets|boots|boots paints|gloves|goggles|protections)\//i.test(relative)) return false;
  if (/^rider\/(?:riders\/[^/]+\/)?paints\//i.test(relative)) return true;
  if (kind === 'riderKit') return true;
  // Gear paints can also replace the rider's face/eyes. A shared texture name
  // alone must not override an explicit helmet/boot/bike destination.
  if (kind !== 'custom' && kind !== 'riderModel') return false;
  if (/helmet|goggles?|eyeballs?|boots?|protector/i.test(relative)) return false;
  return textures.includes('rider');
}

async function inspect(files, modsDir, stockPkz, context = 'custom') {
  const kind = context === true ? 'riderKit' : context === false ? 'custom' : context;
  const paintTextures = {}, unreadablePaints = [];
  for (const file of files.filter((f) => /\.pnt$/i.test(f.rel) && f.size <= 128 * 1024 * 1024)) {
    try { paintTextures[file.rel] = clean(pnt.names(await fs.readFile(file.abs))); } catch { unreadablePaints.push(file.rel); }
  }
  const knownBodyPaintFiles = Object.keys(paintTextures).filter((rel) => isBodyPaint(rel, paintTextures[rel], 'custom'));
  const bodyPaintFiles = Object.keys(paintTextures).filter((rel) => isBodyPaint(rel, paintTextures[rel], kind));
  const bodyPaintTextures = [...new Set(bodyPaintFiles.flatMap((rel) => paintTextures[rel]))];
  const dependencies = bodyPaintTextures.includes('abhoodie') ? [{ label: 'AB-HOODIE rider model — creator store', url: 'https://mxbikes-shop.com/downloads/rider-hoodie-abdesigns/' }] : [];
  return { paintTextures, bodyPaintTextures, bodyPaintFiles, knownBodyPaintFiles, unreadablePaints, dependencies, riderModels: bodyPaintTextures.length ? await riderModels(modsDir, stockPkz) : [] };
}

function missingTextures(names, colors) {
  const present = new Set(clean(colors));
  return clean(names).filter((name) => !present.has(name));
}

async function validateRiderPaint({ modsDir, stockPkz, current }) {
  if (!current.suitPaint) return;
  const data = await gear.paintSource({ modsDir, rider: current.rider || 'default_mx', stockPkz }, 'suitPaint', current);
  if (!data) return;
  const names = clean(pnt.names(data.buf));
  const models = await riderModels(modsDir, stockPkz);
  const selected = models.find((m) => m.name.toLowerCase() === (current.rider || 'default_mx').toLowerCase());
  if (selected?.unverified) return; // An explicitly selected protected model can still work in game.
  const missing = missingTextures(names, selected?.textures || []);
  if (missing.length) throw new Error(`This paint needs a matching rider model (${missing.join(', ')}). Install and select that model before equipping the paint.`);
}
module.exports = { inspect, riderModels, missingTextures, validateRiderPaint, isBodyPaint };
