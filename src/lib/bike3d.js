// Assemble installed bike parts at their .geom mount points and apply a PNT
// livery by texture name. Geometry conventions follow MXB App (MIT; see notices).
const fs = require('fs');
const path = require('path');
const edf = require('./edf');
const pnt = require('./pnt');
const { decodeBlob } = require('./assetread');
const { compactMesh } = require('./mesh-util');
const { parseCfg, sources: { chainOf, readChain }, buildPart } = require('./rider3d');

const models = new Map();
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const rot = (p, degrees) => {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
};
const mount = (position, degrees = 0) => {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, position[0], 0, c, -s, position[1], 0, s, c, position[2], 0, 0, 0, 1];
};

async function relativeNames(chain) {
  const names = new Set();
  for (const source of chain) {
    if (source.kind === 'dir') {
      for (const e of await fs.promises.readdir(source.dir, { withFileTypes: true })) {
        if (e.isFile()) names.add(e.name);
        else if (e.name.toLowerCase() === 'paints') {
          for (const n of await fs.promises.readdir(path.join(source.dir, e.name))) names.add(`paints/${n}`);
        }
      }
    } else {
      for (const name of source.entries.keys()) if (name.startsWith(source.prefix)) names.add(name.slice(source.prefix.length));
    }
  }
  return [...names];
}

async function bikeSources({ modsDir, installDir, bikeDir, bike }) {
  return chainOf([
    bikeDir ? { dir: bikeDir } : { dir: path.join(modsDir, 'bikes', bike) },
    installDir ? { pkz: path.join(installDir, 'bikes.pkz'), prefix: `bikes/${bike}` } : null,
  ]);
}

async function paints(options) {
  const names = await relativeNames(await bikeSources(options));
  return [...new Set(names.filter((n) => /^paints\/[^/]+\.pnt$/i.test(n)).map((n) => n.slice(7, -4)))];
}

async function model(chain, file, external = []) {
  const data = await readChain(chain, file.replace(/\\/g, '/'));
  if (!data) return null;
  const key = data.key + '|' + external.join('|');
  if (models.has(key)) return models.get(key);
  const buf = decodeBlob(data.buf), parsed = { buf, model: edf.parse(buf, { gear: true, fitBounds: true, external }) };
  models.set(key, parsed);
  while (models.size > 4) models.delete(models.keys().next().value);
  return parsed;
}

function geometry(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.split(';')[0].match(/^\s*([\w-]+)\s*=\s*(.+)/);
    if (!match) continue;
    const values = match[2].split(',').map((v) => Number(v.trim()));
    if ((values.length === 1 || values.length === 3) && values.every(Number.isFinite)) out[match[1].toLowerCase()] = values.length === 1 ? values[0] : values;
  }
  return out;
}

function mounts(g, wheelRadii = {}) {
  if (![g.chassis_steer, g.chassis_rsusp_min, g.front_upper, g.steer_joint, g.rsusp_joint].every(Array.isArray)) return null;
  const rake = -(g.rakeangle_min || 0), head = g.chassis_steer, pivot = g.chassis_rsusp_min;
  const front = g.front_lower && Number.isFinite(g.front_length) ? sub(sub(g.front_upper, g.front_lower), [0, g.front_length, 0]) : g.front_upper;
  const fork = add(rot(sub(front, g.steer_joint), rake), head);
  const rearWheel = g.rwheel_min && g.rwheel_min.map((v, i) => (v + (g.rwheel_max || g.rwheel_min)[i]) / 2);
  const frontWheel = g.fwheel && add(rot(g.fwheel, rake), fork);
  let rearAngle = 0;
  if (frontWheel && rearWheel) {
    const local = sub(rearWheel, g.rsusp_joint), radius = Math.hypot(local[1], local[2]);
    const target = frontWheel[1] - (wheelRadii.front || 0.345) + (wheelRadii.rear || 0.335) - pivot[1];
    if (radius > 0 && Math.abs(target) <= radius) rearAngle = (Math.asin(target / radius) - Math.atan2(local[1], -local[2])) * 180 / Math.PI;
  }
  return {
    chassis: null,
    steer: mount(sub(head, rot(g.steer_joint, rake)), rake),
    front_susp: mount(fork, rake), rear_susp: mount(sub(pivot, rot(g.rsusp_joint, rearAngle)), rearAngle),
    front_wheel: frontWheel ? mount(frontWheel) : null,
    rear_wheel: rearWheel ? mount(add(pivot, rot(sub(rearWheel, g.rsusp_joint), rearAngle))) : null,
  };
}

function selectNode(nodes, requested, expected) {
  const names = [...new Set([requested, expected, expected + 'a'].filter(Boolean).map((n) => n.toLowerCase()))];
  for (const name of names) {
    const exact = nodes.find((node) => node.name.toLowerCase() === name);
    if (exact) return exact;
  }
  // Some HRC files use a generic role ("steer") while the exporter adds the
  // bike variant to the EDF node ("steer450f"). Accept a unique role match.
  for (const name of [...new Set([requested, expected].filter(Boolean).map((n) => n.toLowerCase()))]) {
    const variants = nodes.filter((node) => node.name.toLowerCase().startsWith(name));
    if (variants.length === 1) return variants[0];
  }
  // A separately exported part may have an arbitrary root name. A combined
  // scene must never be used wholesale when its requested part is unresolved.
  return nodes.length === 1 ? nodes[0] : null;
}

async function build(options) {
  const { modsDir, installDir, bike, paint = '', tyresOverride, texMax = 1024 } = options;
  const chain = await bikeSources(options);
  const names = await relativeNames(chain);
  const configData = await readChain(chain, 'gfx.cfg');
  if (!configData) throw new Error('The selected bike has no readable gfx.cfg');
  const cfg = parseCfg(configData.buf.toString('latin1'));
  const geomName = names.find((n) => !n.includes('/') && /\.geom$/i.test(n));
  const geomData = geomName && await readChain(chain, geomName);
  const geom = geomData && geometry(geomData.buf.toString('latin1'));
  const assembly = geom && mounts(geom);
  const warnings = [], textures = {}, parts = [], unreadable = [];
  const loadPaint = async (name) => {
    const data = await readChain(chain, `paints/${name}.pnt`);
    return data ? pnt.decode(data.buf, (n) => !edf.isCompanionTexture(n)) : [];
  };
  let paintTextures = [];
  try { paintTextures = await loadPaint(paint || 'stock'); }
  catch (e) { if (paint) { warnings.push('The selected livery cannot be read.'); unreadable.push('bikePaint'); } }
  if (paint && !paintTextures.length) { unreadable.push('bikePaint'); warnings.push('The selected livery was not found; the model’s base textures are shown.'); }
  const external = paintTextures.map((t) => t.name);
  const addPiece = async (slot, partConfig, source, expected) => {
    if (!partConfig) return;
    const ref = typeof partConfig.model === 'string' ? partConfig.model : partConfig.model && partConfig.model.file;
    if (!ref) return;
    let scene = ref, nodeName = partConfig.model && partConfig.model.name;
    if (/\.hrc$/i.test(scene)) {
      const h = await readChain(source, scene);
      const level = h && parseCfg(h.buf.toString('latin1')).level0;
      if (!level || !level.scene) { warnings.push(`The ${slot.replace(/_/g, ' ')} model is unavailable.`); return; }
      scene = level.scene; nodeName = level.name;
    }
    const parsed = await model(source, scene, external);
    if (!parsed) return;
    const nodes = parsed.model.nodes;
    const chosen = selectNode(nodes, nodeName, expected);
    if (!chosen) { warnings.push(`The ${slot.replace(/_/g, ' ')} part could not be identified in its model.`); return; }
    const piece = buildPart(slot, parsed, (n) => n === chosen.name, assembly && assembly[slot], paintTextures, textures, texMax);
    if (piece) {
      // The game procedurally poses its chain and display stand. Their export
      // templates are not static bike parts and otherwise float beside it.
      for (const mesh of piece.meshes) mesh.groups = mesh.groups.filter((g) => !/^chain$/i.test(g.name || '') && !/(?:^|[ _.-])(chain|stand|kickstand)(?:$|[ _.-])/i.test(g.object || ''));
      piece.meshes = piece.meshes.map(compactMesh).filter((m) => m.indices.length);
      parts.push(piece);
    }
  };
  for (const [slot, expected] of [['chassis', 'chassis'], ['steer', 'steer'], ['front_susp', 'fsusp'], ['rear_susp', 'rsusp']]) await addPiece(slot, cfg[slot], chain, expected);
  if (!parts.length) throw new Error('No readable bike geometry was found');
  if (!assembly) warnings.push('This bike’s mounting geometry is unavailable; some parts may be misplaced.');
  const tyreName = tyresOverride || cfg.tyres;
  if (assembly && typeof tyreName === 'string') {
    const tyreChain = await chainOf([{ dir: path.join(modsDir, 'tyres', tyreName) }, installDir ? { pkz: path.join(installDir, 'tyres.pkz'), prefix: `tyres/${tyreName}` } : null]);
    const tyreCfgData = await readChain(tyreChain, 'gfx.cfg');
    if (tyreCfgData) {
      const tyreCfg = parseCfg(tyreCfgData.buf.toString('latin1'));
      await addPiece('front_wheel', tyreCfg.front_wheel, tyreChain, 'fwheel');
      await addPiece('rear_wheel', tyreCfg.rear_wheel, tyreChain, 'rwheel');
    } else warnings.push('The bike’s tyre model is not installed.');
  }
  if (assembly && geom) {
    const radii = {};
    for (const side of ['front', 'rear']) {
      const wheel = parts.find((p) => p.slot === `${side}_wheel`);
      if (wheel) radii[side] = Math.max(...wheel.meshes.map((m) => {
        let radius = 0; for (let i = 1; i < m.positions.length; i += 3) radius = Math.max(radius, Math.abs(m.positions[i])); return radius;
      }));
    }
    const fitted = mounts(geom, radii);
    for (const part of parts) part.bind = fitted[part.slot];
  }
  return { parts, textures, warnings, unreadable, bike, paint, focus: {}, kind: 'bike' };
}

module.exports = { build, paints, geometry, mounts, selectNode };
