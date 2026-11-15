// Builds a 3D rider for the viewer: body + helmet + boots + protection models, each hung off the
// skeleton bone the rider's gfx.cfg names, with the chosen paints applied by texture name.
// Files come from the mods folder first and fall back to the game's own rider.pkz.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { decodeBlob } = require('./assetread');
const edf = require('./edf');
const pnt = require('./pnt');

const MAX_TEX = 1024; // textures are shrunk to this for the preview

const { chainOf, readChain } = require('./asset-sources');
const gearAssets = require('./gear-assets');
const { missingTextures } = require('./paint-compat');

// ---------- tiny parsers for gfx.cfg / .hrc ----------
function parseCfg(text) {
  const root = {};
  const stack = [root];
  let pending = null;
  for (let line of String(text).split(/\r?\n/)) {
    line = line.replace(/;.*$/, '').trim();
    if (!line) continue;
    if (line === '{') { const o = {}; stack[stack.length - 1][(pending || '').toLowerCase()] = o; stack.push(o); pending = null; continue; }
    if (line === '}') { if (stack.length > 1) stack.pop(); continue; }
    const eq = line.indexOf('=');
    if (eq > 0) { stack[stack.length - 1][line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim(); pending = null; }
    else pending = line;
  }
  return root;
}
// .hrc level0 -> { scene, name }
function hrcLevel0(text) {
  const c = parseCfg(text);
  return c.level0 && c.level0.scene ? { scene: c.level0.scene, name: c.level0.name || null } : null;
}

// ---------- caches ----------
const modelCache = new Map(); // key -> parsed edf
const paintCache = new Map(); // key -> [{name,width,height,rgba}]
function cached(map, key, make, max = 12) {
  if (map.has(key)) { const v = map.get(key); map.delete(key); map.set(key, v); return v; }
  const v = make();
  map.set(key, v);
  while (map.size > max) map.delete(map.keys().next().value);
  return v;
}

function shrink(w, h, rgba, max = MAX_TEX) {
  let s = 1;
  while (w / s > max || h / s > max) s *= 2;
  if (s === 1) return { width: w, height: h, data: rgba };
  const nw = w / s, nh = h / s, out = Buffer.alloc(nw * nh * 4), n = s * s;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < s; dy++) {
      let i = ((y * s + dy) * w + x * s) * 4;
      for (let dx = 0; dx < s; dx++, i += 4) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; }
    }
    const o = (y * nw + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
  return { width: nw, height: nh, data: out };
}

async function loadModel(chain, file, helmet = false, fitBounds = false) {
  try {
    const r = await readChain(chain, file);
    if (!r) return null;
    r.buf = decodeBlob(r.buf);
    if (!edf.isEdf(r.buf)) return null;
    const parsed = cached(modelCache, r.key + (helmet ? ':helmet' : '') + (fitBounds ? ':bounds' : ''), () => ({ buf: r.buf, model: edf.parse(r.buf, { gear: true, helmet, fitBounds }) }), 8);
    return parsed.model.nodes.length ? parsed : null;
  } catch { return null; } // One unreadable piece must not abort the entire outfit.
}
async function loadPaint(chain, rel) {
  if (!rel) return [];
  const r = await readChain(chain, rel);
  if (!r) return [];
  try { return cached(paintCache, r.key, () => pnt.decode(r.buf, (n) => !edf.isCompanionTexture(n))); } catch { return []; }
}

// Turn a parsed model into transferable meshes + the textures its groups use.
// paints: [{name, width, height, rgba}] override embedded textures with the same name.
function buildPart(slot, parsed, nodeFilter, bind, paints, texOut, texMax = MAX_TEX) {
  const { model, buf } = parsed;
  const meshes = [];
  for (const node of model.nodes) {
    if (nodeFilter && !nodeFilter(node.name)) continue;
    const groups = (node.submeshes.length ? node.submeshes : [{ triStart: 0, triCount: node.indices.length / 3, mat: null, uvTile: 0 }]).map((s) => {
      const colorIdx = s.mat != null && node.materials.length ? node.materials[s.mat] : (node.materials.length === 1 ? node.materials[0] : (s.mat != null ? s.mat : 0));
      const texName = colorIdx != null ? model.colors[colorIdx] : null;
      let tex = null;
      if (texName) {
        const key = `${slot}:${texName.toLowerCase()}`;
        if (!(key in texOut)) {
          const p = paints.find((x) => x.name.toLowerCase() === texName.toLowerCase());
          let img = null;
          if (p) img = shrink(p.width, p.height, p.rgba, texMax);
          else {
            const t = model.textures.find((x) => x.name.toLowerCase() === texName.toLowerCase());
            const px = t && edf.inflateTexture(buf, t);
            if (px) img = shrink(t.width, t.height, px, texMax);
          }
          texOut[key] = img ? { ...img, name: texName, painted: !!p } : null;
        }
        if (texOut[key]) tex = key;
      }
      return { start: s.triStart * 3, count: s.triCount * 3, tex, tile: s.uvTile || 0, name: texName, object: s.name || node.name };
    });
    meshes.push({ name: node.name, positions: node.positions, normals: node.normals, uvs: node.uvs, indices: node.indices, groups });
  }
  return meshes.length ? { slot, bind, meshes } : null;
}

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
};
function attachmentMatrix({ bones, locals }, name) {
  if (!name) return null;
  const parent = name.toLowerCase() === 'riderrig_armour' ? 'riderRIG_Spine4' : null;
  // Armour is an attachment marker, even when a custom export gives it skin
  // weights. Its inverse bind can belong to the pelvis; use its chest parent.
  if (parent && bones[parent] && locals[name]) return mul(bones[parent], locals[name]);
  return bones[name] || bones[parent] || null;
}

// stockPkz: <install>/rider.pkz. gd: gear folder for the rider model (profile.gearDir). lo.current: loadout values.
// only: which parts to build ('body', 'helmet', 'boots', 'protection'); texMax: texture size cap
// (thumbnails use a small one). The skeleton is always read so gear lands where it belongs.
async function build({ modsDir, gd, stockPkz, current, only, texMax = MAX_TEX }) {
  const want = (k) => !only || only.includes(k);
  const t0 = Date.now();
  const cur = current || {};
  const riderName = cur.rider || 'default_mx';
  const stock = (prefix) => (stockPkz && fs.existsSync(stockPkz) ? { pkz: stockPkz, prefix } : null);
  const warnings = [];
  const unreadable = []; // slots whose chosen paint/model couldn't be read (protected or broken)
  const textures = {};
  const parts = [];

  // --- body + skeleton ---
  const bodyChain = await chainOf([{ dir: path.join(modsDir, 'rider', 'riders', riderName) }, { dir: path.join(modsDir, 'rider') }, stock(`rider/riders/${riderName}`), stock('rider/riders/default_mx')]);
  const gear = { modsDir, rider: riderName, stockPkz };
  const gearRoots = await gearAssets.roots(gear);
  const bodyRoots = await gearAssets.roots(gear, true);
  const gfxR = await readChain(bodyChain, 'gfx.cfg');
  const gfx = gfxR ? parseCfg(gfxR.buf.toString('latin1')) : {};
  let bodyFile = 'rider.edf';
  const hrcName = gfx.model && gfx.model.file;
  if (hrcName) { const h = await readChain(bodyChain, hrcName); const l = h && hrcLevel0(h.buf.toString('latin1')); if (l) bodyFile = l.scene; }
  const customBody = !/^default_(mx|sm)$/i.test(riderName);
  const selectedBody = customBody ? await chainOf([{ dir: path.join(modsDir, 'rider', 'riders', riderName) }, stock(`rider/riders/${riderName}`)]) : bodyChain;
  const body = await loadModel(selectedBody, bodyFile, false, true);
  if (!body && customBody) throw new Error(`Preview unavailable for ${riderName}. Its installed model could not be read. No substitute rider is shown.`);
  if (!body) throw new Error("Couldn't find the rider model (rider.edf) — is the game folder set in Settings?");
  const { bones, locals } = cached(modelCache, 'skel:' + bodyChain.map((f) => f.key).join('|') + bodyFile, () => edf.parseSkeleton(body.buf), 8);
  const boneMat = (name) => attachmentMatrix({ bones, locals }, name);
  if (want('body')) {
  const suitPaint = await loadPaint(await gearAssets.subchain(bodyRoots, 'paints'), cur.suitPaint ? cur.suitPaint + '.pnt' : null);
  const glovePaint = await loadPaint(await gearAssets.subchain(bodyRoots, 'gloves'), cur.glovesPaint ? cur.glovesPaint + '.pnt' : null)
    .then(async (p) => (p.length || !cur.glovesPaint ? p : loadPaint(bodyChain, `gloves/${cur.glovesPaint}.pnt`)));
  const suit2 = suitPaint.length || !cur.suitPaint ? suitPaint : await loadPaint(bodyChain, `paints/${cur.suitPaint}.pnt`);
  const missing = body.model.colors.length ? missingTextures(suit2.map((p) => p.name), body.model.colors) : [];
  if (missing.length) { unreadable.push('suitPaint'); warnings.push(`This paint requires a different rider model (${missing.join(', ')}). The current rider cannot display those parts.`); }
  if (cur.suitPaint && !suit2.length) unreadable.push('suitPaint');
  if (cur.glovesPaint && !glovePaint.length) unreadable.push('glovesPaint');
  if (cur.suitPaint && !suit2.length) warnings.push('Your rider kit paint couldn\'t be read (it may be protected), so the default kit is shown.');
  parts.push(buildPart('body', body, null, null, [...(missing.length || unreadable.includes('rider') ? [] : suit2), ...glovePaint], textures, texMax));
  }

  // --- helmet ---
  const helmetName = cur.helmet && cur.helmet !== 'default' ? cur.helmet : null;
  const helmetChain = await gearAssets.modelSources(gear, 'helmets', helmetName || 'default');
  if (want('helmet')) {
    const hg = await readChain(helmetChain, 'gfx.cfg');
    const hcfg = hg ? parseCfg(hg.buf.toString('latin1')) : {};
    const hrc = typeof hcfg.model === 'string' ? hcfg.model : (hcfg.model && hcfg.model.file) || 'helmet.hrc';
    const h = await readChain(helmetChain, hrc);
    const l = h && hrcLevel0(h.buf.toString('latin1'));
    const m = await loadModel(helmetChain, (l && l.scene) || 'helmet.edf', true);
    const paint = await loadPaint(helmetChain, cur.helmetPaint ? `paints/${cur.helmetPaint}.pnt` : null);
    let goggles = await loadPaint(helmetChain, cur.gogglesPaint ? `goggles/${cur.gogglesPaint}.pnt` : null);
    if (!goggles.length && cur.gogglesPaint) goggles = await loadPaint(await gearAssets.subchain(gearRoots, 'goggles'), cur.gogglesPaint + '.pnt');
    if (cur.gogglesPaint && !goggles.length) unreadable.push('gogglesPaint');
    if (cur.helmetPaint && !paint.length) unreadable.push('helmetPaint');
    if (cur.helmetPaint && !paint.length) warnings.push('The helmet paint couldn\'t be read (it may be protected).');
    if (m) { const p = buildPart('helmet', m, null, boneMat(gfx.helmetlinkobj || 'riderRIG_Head'), [...paint, ...goggles], textures, texMax); if (p) parts.push(p); }
    else { unreadable.push('helmet'); warnings.push('The helmet model is missing or could not be read. A helmet paint needs its matching helmet model installed.'); }
  }

  // --- boots ---
  const bootsName = cur.boots && cur.boots !== 'default' ? cur.boots : null;
  const bootsChain = await gearAssets.modelSources(gear, 'boots', bootsName || 'default');
  if (want('boots')) {
    const bg = await readChain(bootsChain, 'gfx.cfg');
    const bcfg = bg ? parseCfg(bg.buf.toString('latin1')) : {};
    let paint = await loadPaint(bootsChain, cur.bootsPaint ? `paints/${cur.bootsPaint}.pnt` : null);
    if (!paint.length && cur.bootsPaint) paint = await loadPaint(await gearAssets.subchain(gearRoots, 'boots'), cur.bootsPaint + '.pnt');
    if (!paint.length && cur.bootsPaint) paint = await loadPaint(await gearAssets.subchain(gearRoots, 'boots paints'), cur.bootsPaint + '.pnt');
    if (cur.bootsPaint && !paint.length) unreadable.push('bootsPaint');
    for (const side of ['left', 'right']) {
      const sc = bcfg[side] || {};
      const hrc = (sc.model && (sc.model.file || sc.model)) || `${side}_boot.hrc`;
      const h = typeof hrc === 'string' ? await readChain(bootsChain, hrc) : null;
      const l = h && hrcLevel0(h.buf.toString('latin1'));
      const m = await loadModel(bootsChain, (l && l.scene) || 'boots.edf');
      if (!m) { unreadable.push('boots'); warnings.push('The boots model couldn\'t be read (it may be protected).'); break; }
      const names = m.model.nodes.map((n) => n.name);
      const want = l && l.name && names.includes(l.name) ? l.name : null;
      const sideRe = side === 'left' ? /(^|_|\b)l(eft)?(\b|_|$)|left/i : /(^|_|\b)r(ight)?(\b|_|$)|right/i;
      const bySide = names.find((n) => sideRe.test(n));
      const pick = want || bySide || (side === 'left' ? names[0] : names[1] || names[0]);
      const bone = boneMat(gfx[`${side}bootlinkobj`] || `riderRIG_${side === 'left' ? 'Left' : 'Right'}KneeTwist`);
      const p = buildPart(`boot_${side}`, m, (n) => n === pick, bone, paint, textures, texMax);
      if (p) parts.push(p);
    }
  }

  // --- chest protector / neck brace ---
  const protName = cur.protection || '';
  const protChain = await gearAssets.modelSources(gear, 'protections', protName);
  if (protChain.length && want('protection')) {
    const pg = await readChain(protChain, 'gfx.cfg');
    const pcfg = pg ? parseCfg(pg.buf.toString('latin1')) : {};
    const paint = await loadPaint(protChain, cur.protectionPaint ? `paints/${cur.protectionPaint}.pnt` : null);
    if (cur.protectionPaint && !paint.length) unreadable.push('protectionPaint');
    for (const piece of ['armour', 'neckbrace']) {
      const sc = pcfg[piece];
      if (!sc) continue;
      const hrc = typeof sc.model === 'string' ? sc.model : sc.model && sc.model.file;
      const h = hrc && await readChain(protChain, hrc);
      const l = h && hrcLevel0(h.buf.toString('latin1'));
      const m = await loadModel(protChain, (l && l.scene) || `${piece}.edf`);
      if (!m) continue;
      const bone = boneMat(gfx[`${piece}linkobj`] || (piece === 'armour' ? 'riderRIG_armour' : 'riderRIG_Spine4'));
      const p = buildPart(piece, m, l && l.name ? (n) => n === l.name || m.model.nodes.length === 1 : null, bone, paint, textures, texMax);
      if (p) parts.push(p);
    }
  }

  const wrist = boneMat('riderRIG_LeftWrist');
  const focus = wrist ? { hands: [wrist[3], wrist[7] - 0.065, wrist[11]] } : {};
  // The spine's local Y axis points forward in the rider rig. Some custom
  // exports face -Z instead of +Z; compensate the camera, not the gear mesh.
  const spine = bones.riderRIG_Spine4;
  const previewYaw = spine && Math.hypot(spine[1], spine[9]) > 0.5 ? Math.atan2(-spine[1], spine[9]) : 0;
  return { parts: parts.filter(Boolean), textures, focus, previewYaw, warnings, unreadable, ms: Date.now() - t0 };
}

module.exports = { build, parseCfg, sources: { chainOf, readChain }, buildPart, attachmentMatrix };
