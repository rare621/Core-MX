// MX Bikes model (.edf) reader: meshes (positions/uvs/normals/triangles), per-group placement,
// material -> texture binding and the textures embedded in the file.
// Port of the mesh parts of MXB App's reader (github.com/Frostn1/mxb-app, MIT, crates/core/src/edf.rs).
// The format is undocumented; nodes are found by scanning for blocks that validate as geometry.
const zlib = require('zlib');

const STRIDE = 72, HEADER_START = 0x54, MAX_COUNT = 3000000, MODEL_EXTENT = 200;
const SUB_MAT_BACKS = [148, 152], SUB_MAT_PARENT_STEP = 280, NODE_MAT_OFF = 104, NODE_MAT_END = 168;
const MAT_STRIDE = 56, MAT_TEX_FROM_REC = 44, MAX_MATERIALS = 64;
const TEX_SIZES = new Set([64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]);

const isEdf = (b) => b.length >= HEADER_START + 8 && b[0] === 69 && b[1] === 68 && b[2] === 70 && b[3] === 0;
const u32 = (b, o) => b.readUInt32LE(o);
const f32 = (b, o) => b.readFloatLE(o);
const isAlnum = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

function readMat4(b, o) {
  if (o < 0 || o + 64 > b.length) return null;
  const m = new Array(16);
  for (let i = 0; i < 16; i++) { m[i] = f32(b, o + i * 4); if (!Number.isFinite(m[i]) || Math.abs(m[i]) >= 10) return null; }
  if (m[12] !== 0 || m[13] !== 0 || m[14] !== 0 || m[15] !== 1) return null;
  const r = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  if (r.some((row) => Math.abs(row[0] * row[0] + row[1] * row[1] + row[2] * row[2] - 1) > 1e-3)) return null;
  const det = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  if (Math.abs(Math.abs(det) - 1) > 1e-3) return null;
  return m;
}
const matPoint = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
const matDir = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[4] * p[0] + m[5] * p[1] + m[6] * p[2], m[8] * p[0] + m[9] * p[1] + m[10] * p[2]];

function finitePos(b, o, ext) {
  for (let k = 0; k < 3; k++) { const v = f32(b, o + 4 * k); if (!Number.isFinite(v) || Math.abs(v) >= ext) return false; }
  return true;
}

function plausibleName(b, o) {
  if (o >= b.length || !isAlpha(b[o])) return null;
  let e = o;
  while (e < b.length && e - o < 32) {
    const c = b[e];
    if (c === 0) break;
    // Spaces occur too: 3ds Max exports the root as "Scene Root".
    if (!(isAlnum(c) || c === 46 || c === 95 || c === 45 || c === 58 || c === 32)) return null;
    e++;
  }
  const len = e - o;
  return len >= 2 && len <= 31 && b[e - 1] !== 32 ? b.toString('latin1', o, e) : null;
}

function readCname(b, o) { let e = o; while (e < b.length && b[e] >= 32 && b[e] < 127) e++; return b.toString('latin1', o, e); }

// ---- embedded textures ----
function texName(b, o) {
  let e = o;
  while (e < b.length && e - o < 40) {
    const c = b[e];
    if (c === 0) break;
    if (!(isAlnum(c) || c === 46 || c === 95 || c === 45)) return null;
    e++;
  }
  const len = e - o;
  return len >= 1 && len <= 39 ? b.toString('latin1', o, e) : null;
}

function embeddedTextures(b) {
  const out = [];
  let o = 0, resume = -1;
  scan: while (o + 104 + 40 <= b.length) {
    if (!isAlnum(b[o]) || (o > 0 && o !== resume && isAlnum(b[o - 1]))) { o++; continue; }
    const name = texName(b, o);
    if (!name) { o++; continue; }
    for (const wOff of [100, 104]) {
      if (name.length >= wOff) continue;
      const wAt = o + wOff;
      const w = u32(b, wAt), h = u32(b, wAt + 4), size = u32(b, wAt + 28), pad = wAt + 32;
      if (!TEX_SIZES.has(w) || !TEX_SIZES.has(h) || size <= 8) continue;
      const dataOff = wAt + 40, dataLen = size - 8;
      if (pad + 8 > b.length || dataOff + dataLen > b.length) continue;
      let zero = true; for (let i = 0; i < 8; i++) if (b[pad + i]) { zero = false; break; }
      if (!zero) continue;
      out.push({ name, width: w, height: h, dataOff, dataLen });
      o = dataOff + dataLen; resume = o;
      continue scan;
    }
    o++;
  }
  return out;
}

function inflateTexture(b, t) {
  const expected = t.width * t.height * 4;
  try {
    const px = zlib.inflateRawSync(b.subarray(t.dataOff, t.dataOff + t.dataLen), { maxOutputLength: expected + 16 });
    return px.length >= expected ? px.subarray(0, expected) : null;
  } catch { return null; }
}

const EXPORTER_COMPANIONS = ['_normal', '_nrm', '_roughness', '_metallic', '_metalness', '_specular', '_glossiness', '_ao', '_ambientocclusion', '_bump', '_height', '_displacement', '_opacity'];
function isCompanionTexture(name) {
  const n = name.toLowerCase();
  return n.endsWith('_n') || n.endsWith('_s') || n.endsWith('_r') || EXPORTER_COMPANIONS.some((s) => n.endsWith(s));
}
function isCompanionAmong(name, all) {
  const n = name.toLowerCase();
  return isCompanionTexture(name) && !all.some((t) => ['_n', '_s', '_r'].some((s) => t.name.toLowerCase() === n + s));
}

// Colour texture slots in file order (what material indices count). `external` = names a paint supplies.
function declaredColors(b, embedded, external = []) {
  const slots = embedded.filter((t) => !isCompanionAmong(t.name, embedded)).map((t) => [t.dataOff, t.name]);
  for (const name of external) {
    if (!name || embedded.some((t) => t.name.toLowerCase() === name.toLowerCase()) || isCompanionTexture(name)) continue;
    const needle = Buffer.from(name, 'latin1');
    let from = 0, at;
    while ((at = b.indexOf(needle, from)) >= 0) {
      const inPixels = embedded.some((t) => at >= t.dataOff && at < t.dataOff + t.dataLen);
      if (b[at + needle.length] === 0 && at > 0 && b[at - 1] === 0 && !inPixels) { slots.push([at, name]); break; }
      from = at + 1;
    }
  }
  return slots.sort((x, y) => x[0] - y[0]).map((s) => s[1]);
}

// ---- material tables ----
function validMaterialRecord(b, o, textures) {
  if (o + MAT_STRIDE > b.length) return false;
  const w = (i) => u32(b, o + i * 4), f = (i) => f32(b, o + i * 4);
  if (w(0) !== 0 || w(7) !== 0) return false;
  for (let k = 1; k < 7; k++) { const v = f(k); if (!(v >= 0 && v <= 1)) return false; }
  if (w(8) || w(9) || w(10) || w(12) > 2) return false;
  return w(11) <= textures && w(13) <= textures;
}
function nodeMaterialTable(b, nodeStart, textures) {
  for (let count = 1; count <= MAX_MATERIALS; count++) {
    const o = nodeStart - (4 + MAT_STRIDE * count);
    if (o < 0) break;
    if (u32(b, o) !== count) continue;
    const rec = (k) => o + 4 + MAT_STRIDE * k;
    let ok = true, shades = false;
    for (let k = 0; k < count && ok; k++) {
      if (!validMaterialRecord(b, rec(k), textures)) ok = false;
      for (let i = 1; i < 7 && ok; i++) if (f32(b, rec(k) + i * 4) > 0) shades = true;
    }
    if (ok && shades) return Array.from({ length: count }, (_, k) => { const one = u32(b, rec(k) + MAT_TEX_FROM_REC); return one ? one - 1 : null; });
  }
  return [];
}

// ---- submesh groups ----
function readSubGroup(b, o, totTris, totVerts, keepRanges) {
  if (o < 0) return null;
  const triStart = u32(b, o), firstVs = u32(b, o + 8);
  let triTotal = 0, vcTotal = 0, k = o;
  const ranges = [];
  for (let n = 0; n < 64; n++) {
    if (k + 24 > b.length) return null;
    const a = u32(b, k), cnt = u32(b, k + 4), vstart = u32(b, k + 8), vcnt = u32(b, k + 12);
    if (!cnt || !vcnt || a !== triStart + triTotal || vstart !== firstVs + vcTotal || a + cnt > totTris || vstart + vcnt > totVerts) return null;
    ranges.push([a, cnt, vstart, vcnt]);
    triTotal += cnt; vcTotal += vcnt;
    if (u32(b, k + 16) === vcTotal && u32(b, k + 20) === firstVs) return keepRanges ? ranges : [triStart, triTotal, firstVs, vcTotal];
    k += 24;
  }
  return null;
}

function collectSubCands(b) {
  const out = [];
  const end = b.length - 16;
  for (let p = 48; p <= end; p++) {
    if (b[p + 15] !== 0x3f || b[p + 14] !== 0x80 || b[p + 13] !== 0 || b[p + 12] !== 0) continue;
    let zero = true; for (let i = 0; i < 12; i++) if (b[p + i]) { zero = false; break; }
    if (!zero) continue;
    const mb = p - 48;
    if (!readMat4(b, mb)) continue;
    for (const back of SUB_MAT_BACKS) {
      const o = mb + back;
      if (o + 24 > b.length) continue;
      const g = readSubGroup(b, o, MAX_COUNT, MAX_COUNT);
      if (g) { out.push({ blockOff: o, triStart: g[0], triCount: g[1], vertStart: g[2], vertCount: g[3] }); break; }
    }
  }
  return out;
}

function subMatBack(b, blockOff) { return SUB_MAT_BACKS.find((back) => blockOff - back >= 0 && readMat4(b, blockOff - back)) || SUB_MAT_BACKS[0]; }
function subName(b, blockOff) { const o = blockOff - (subMatBack(b, blockOff) + 104); return o >= 0 ? readCname(b, o) : ''; }

function chainSubmeshes(b, cands, iend, totTris, totVerts) {
  const inBounds = (c) => c.triStart + c.triCount <= totTris && c.vertStart + c.vertCount <= totVerts;
  let start = null;
  for (const c of cands) if (c.triStart === 0 && c.vertStart === 0 && c.blockOff >= iend && inBounds(c) && (!start || c.blockOff - iend < start.blockOff - iend)) start = c;
  if (!start) return null;
  const out = [];
  let runT = 0, runV = 0, prev = start.blockOff;
  while (runT < totTris) {
    let next = null;
    for (const c of cands) if (c.triStart === runT && c.vertStart === runV && inBounds(c) && (!next || Math.abs(c.blockOff - prev) < Math.abs(next.blockOff - prev))) next = c;
    if (!next) return null;
    out.push({ name: subName(b, next.blockOff), triStart: runT, triCount: next.triCount, blockOff: next.blockOff, vertStart: next.vertStart, vertCount: next.vertCount, mat: null });
    runT += next.triCount; runV = next.vertStart + next.vertCount; prev = next.blockOff;
  }
  return runT === totTris && runV === totVerts ? out : null;
}

function detectSubmeshesWindow(b, iend, totTris, totVerts) {
  const win = Math.min(200000, Math.max(0, b.length - iend));
  const cand = new Map();
  for (let i = 0; i + 24 <= win; i += 4) {
    const o = iend + i;
    if (o >= 148 && readMat4(b, o - 148)) {
      const g = readSubGroup(b, o, totTris, totVerts);
      if (g) { if (!cand.has(g[0])) cand.set(g[0], []); cand.get(g[0]).push([o, g[1], g[2], g[3]]); }
    }
  }
  const out = [];
  let runT = 0, runV = 0;
  while (runT < totTris) {
    const opts = cand.get(runT);
    if (!opts) break;
    const [o, cnt, vstart, vcnt] = opts.find((x) => x[2] === runV) || opts[0];
    out.push({ name: o >= 252 ? readCname(b, o - 252) : '', triStart: runT, triCount: cnt, blockOff: o, vertStart: vstart, vertCount: vcnt, mat: null });
    runT += cnt; runV = vstart + vcnt;
  }
  return out;
}

function submeshTransform(b, nameOff, blockOff, nodeMatrixOnce) {
  const chain = [];
  const base = blockOff - subMatBack(b, blockOff);
  if (base < 0) return chain;
  if (nodeMatrixOnce && base < nameOff + NODE_MAT_END) return chain;
  const m = readMat4(b, base);
  if (!m) return chain;
  chain.push(m);
  for (let k = base; k - SUB_MAT_PARENT_STEP >= 0;) {
    const p = k - SUB_MAT_PARENT_STEP;
    if (p < nameOff + NODE_MAT_END) break;
    const pm = readMat4(b, p);
    if (!pm) break;
    chain.push(pm); k = p;
  }
  return chain;
}

// Scene objects carry explicit child indices. Animated control pivots can sit
// between the mesh root and a lever; they are not always 280 bytes apart.
function sceneParents(b, start, subs) {
  const end = Math.max(start, ...subs.map((s) => s.blockOff));
  const objects = [];
  for (let at = start; at + 240 <= Math.min(end + 1, b.length); at++) {
    if (!isAlpha(b[at])) continue;
    const name = readCname(b, at);
    if (name.length < 2 || name.length > 99 || !/^[\w .%():-]+$/.test(name)) continue;
    let padded = true;
    for (let k = at + name.length; k < at + 100; k++) if (b[k]) { padded = false; break; }
    const matrix = (padded || at === start) && readMat4(b, at + 104);
    if (matrix) { objects.push({ at, matrix }); at += 167; }
  }
  const parent = new Map();
  objects.forEach((object, index) => {
    const count = u32(b, object.at + 236);
    if (!count || count > objects.length || object.at + 240 + count * 4 > b.length) return;
    const children = Array.from({ length: count }, (_, k) => u32(b, object.at + 240 + k * 4));
    if (children.some((child) => child <= index || child >= objects.length) || new Set(children).size !== count) return;
    for (const child of children) parent.set(child, index);
  });
  const chains = new Map();
  objects.forEach((object, index) => {
    const matrices = [object.matrix];
    for (let i = parent.get(index); i != null && i > 0; i = parent.get(i)) matrices.push(objects[i].matrix);
    chains.set(object.at + 104, index === 0 ? [] : matrices);
  });
  return chains;
}

function uvTile(uvs, vs, vc) {
  const hi = Math.min(vs + vc, uvs.length / 2);
  let tile = null;
  for (let i = vs; i < hi; i++) { const t = Math.floor(uvs[i * 2]); if (tile === null) tile = t; else if (tile !== t) return null; }
  return tile;
}

function readNode(b, cands, vs, vc, rawIdx, iend, rawTris, name, materials, nodeMatrixOnce, absoluteGroups = false, faceRotation = 0, sharedFaceBasis = false) {
  const positions = new Float32Array(vc * 3), uvs = new Float32Array(vc * 2), normals = new Float32Array(vc * 3);
  for (let i = 0; i < vc * 3; i++) positions[i] = f32(b, vs + i * 4);
  const uvBase = vs + vc * 12, nBase = vs + vc * 44;
  for (let i = 0; i < vc; i++) {
    uvs[i * 2] = f32(b, uvBase + i * 8); uvs[i * 2 + 1] = f32(b, uvBase + i * 8 + 4);
    normals[i * 3] = f32(b, nBase + i * 12); normals[i * 3 + 1] = f32(b, nBase + i * 12 + 4); normals[i * 3 + 2] = f32(b, nBase + i * 12 + 8);
  }
  const groups = chainSubmeshes(b, cands, iend, rawTris, vc) || detectSubmeshesWindow(b, iend, rawTris, vc);
  const rawSubs = [];
  for (const s of groups) {
    const ranges = readSubGroup(b, s.blockOff, rawTris, vc, true);
    if (!ranges || ranges.length <= 1) { rawSubs.push(s); continue; }
    ranges.forEach(([ts, tc, vs2, vc2], i) => rawSubs.push({ name: s.name, triStart: ts, triCount: tc, blockOff: s.blockOff, vertStart: vs2, vertCount: vc2, mat: s.blockOff + 24 * i - 4 >= 0 ? u32(b, s.blockOff + 24 * i - 4) : null }));
  }
  const covers = rawSubs.length > 0 && rawSubs.reduce((a, s) => a + s.triCount, 0) === rawTris;
  const parents = sceneParents(b, iend, rawSubs);
  const shell = sharedFaceBasis && rawSubs.filter((s) => !/^face$|^cam(?:era)?$/i.test(s.name)).sort((a, b) => b.triCount - a.triCount)[0];
  const shellBasis = shell && readMat4(b, shell.blockOff - subMatBack(b, shell.blockOff));

  const placedVert = new Uint8Array(vc);
  let placed = false;
  const nodeMat = readMat4(b, iend + NODE_MAT_OFF);
  if (nodeMat) {
    placed = true;
    const ranges = rawSubs.length ? rawSubs.map((s) => {
      const base = s.blockOff - subMatBack(b, s.blockOff);
      const own = absoluteGroups && (shellBasis && /^face$/i.test(s.name) ? shellBasis : readMat4(b, base));
      return [s.vertStart, Math.min(s.vertStart + s.vertCount, vc), own ? [own] : parents.get(base) || submeshTransform(b, iend, s.blockOff, nodeMatrixOnce), /^face$/i.test(s.name)];
    }) : [[0, vc, []]];
    for (const [lo, hi, chain, face] of ranges) {
      for (let i = lo; i < hi; i++) {
        placedVert[i] = 1;
        let p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
        let n = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
        for (const m of chain) { p = matPoint(m, p); n = matDir(m, n); }
        if (absoluteGroups && face && faceRotation) {
          const a = faceRotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
          const rotate = (v) => [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
          p = rotate(p); n = rotate(n);
        }
        if (!absoluteGroups || !chain.length) { p = matPoint(nodeMat, p); n = matDir(nodeMat, n); }
        positions.set(p, i * 3); normals.set(n, i * 3);
      }
    }
  }
  const drop = (a, c, d) => a === c || c === d || a === d || (placed && (!placedVert[a] || !placedVert[c] || !placedVert[d]));
  const indices = [];
  const submeshes = [];
  if (covers) {
    let keptStart = 0;
    for (const s of rawSubs) {
      let kept = 0;
      for (let t = s.triStart; t < s.triStart + s.triCount; t++) {
        const a = rawIdx[t * 3], c = rawIdx[t * 3 + 1], d = rawIdx[t * 3 + 2];
        if (!drop(a, c, d)) { indices.push(a, c, d); kept++; }
      }
      if (kept) {
        const mat = s.mat != null ? s.mat : (s.blockOff - 4 >= 0 ? u32(b, s.blockOff - 4) : null);
        submeshes.push({ name: s.name, triStart: keptStart, triCount: kept, uvTile: uvTile(uvs, s.vertStart, s.vertCount), mat });
        keptStart += kept;
      }
    }
  } else {
    for (let t = 0; t < rawIdx.length; t += 3) if (!drop(rawIdx[t], rawIdx[t + 1], rawIdx[t + 2])) indices.push(rawIdx[t], rawIdx[t + 1], rawIdx[t + 2]);
  }
  return { name, positions, uvs, normals, indices: Uint32Array.from(indices), submeshes, materials };
}

// Keep the highest-detail LOD of each part (level0 = untagged name; `b`/`c` mark lower LODs).
function level0Only(nodes) {
  const base = (name) => {
    const d = name.search(/\d/);
    if (d >= 1 && (name[d - 1] === 'b' || name[d - 1] === 'c')) return name.slice(0, d - 1) + name.slice(d);
    if (d < 0 && name.length > 1 && /[bc]$/.test(name)) return name.slice(0, -1);
    return name;
  };
  const best = new Map();
  nodes.forEach((nd, i) => {
    const k = base(nd.name), isL0 = nd.name === k;
    const j = best.get(k);
    if (j === undefined) return best.set(k, i);
    const prevL0 = nodes[j].name === k;
    if ((isL0 && !prevL0) || (isL0 === prevL0 && nd.indices.length > nodes[j].indices.length)) best.set(k, i);
  });
  const keep = new Set(best.values());
  return nodes.filter((_, i) => keep.has(i));
}

// opts: { gear: bool (node matrix applied once), external: [texture names a paint supplies] }
function parse(b, opts = {}) {
  if (!isEdf(b)) throw new Error('not a readable model (.edf)');
  const textures = embeddedTextures(b);
  const cands = collectSubCands(b);
  const nodes = [];
  const absoluteNodes = [];
  const helmetSpecs = [];
  const n = b.length;
  let o = HEADER_START;
  while (o + 8 <= n) {
    const vc = u32(b, o);
    if (vc >= 8 && vc <= MAX_COUNT && o + 4 + vc * STRIDE + 8 <= n) {
      const vs = o + 4;
      if ([0, 1, 2, vc >> 1, vc - 1].every((i) => finitePos(b, vs + i * 12, MODEL_EXTENT))) {
        const ic = vs + vc * STRIDE;
        const tc = u32(b, ic);
        if (tc >= 1 && tc <= MAX_COUNT && ic + 8 + tc * 12 <= n) {
          const raw = new Uint32Array(tc * 3);
          let ok = true;
          for (let t = 0; t < tc * 3; t++) { const i = u32(b, ic + 4 + t * 4); if (i >= vc) { ok = false; break; } raw[t] = i; }
          const iend = ic + 8 + tc * 12;
          const name = ok && plausibleName(b, iend);
          if (name) {
            nodes.push(readNode(b, cands, vs, vc, raw, iend, tc, name, nodeMaterialTable(b, o, textures.length), !!opts.gear));
            if (opts.helmet || opts.fitBounds) absoluteNodes.push(readNode(b, cands, vs, vc, raw, iend, tc, name, nodeMaterialTable(b, o, textures.length), true, true));
            if (opts.helmet || opts.fitBounds) helmetSpecs.push([b, cands, vs, vc, raw, iend, tc, name, nodeMaterialTable(b, o, textures.length), true]);
            o = iend;
            continue;
          }
        }
      }
    }
    o++;
  }
  const colors = declaredColors(b, textures, opts.external || []);
  let selected = level0Only(nodes);
  if ((opts.helmet || (opts.fitBounds && nodes.length === 1)) && absoluteNodes.length) {
    // Some exporters flatten independent scene objects under a camera/light.
    // Its matrix must not rotate every sibling. Pick the interpretation that
    // agrees with the file's recorded bounds, without model-name overrides.
    const expected = Array.from({ length: 6 }, (_, i) => f32(b, 4 + i * 4));
    if (expected.every((v) => Number.isFinite(v) && Math.abs(v) < MODEL_EXTENT) && [0, 1, 2].every((i) => expected[i] < expected[i + 3])) {
      const score = (ns) => {
        const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const node of ns) for (let i = 0; i < node.positions.length; i++) {
          const k = i % 3, value = node.positions[i];
          bounds[k] = Math.min(bounds[k], value); bounds[k + 3] = Math.max(bounds[k + 3], value);
        }
        return Math.max(...bounds.map((v, i) => Math.abs(v - expected[i])));
      };
      const absolute = level0Only(absoluteNodes);
      if (score(absolute) + 0.0001 < score(selected)) selected = absolute;
      // An independently exported face can retain a different axial basis.
      // Accept a quarter-turn only when the file's own bounds confirm it.
      if (opts.fitBounds && score(selected) > 0.0001) {
        const candidate = level0Only(helmetSpecs.map((args) => readNode(...args.slice(0, -1), false)));
        if (score(candidate) + 0.0001 < score(selected)) selected = candidate;
      }
    }
  }
  if (opts.helmet && selected.some((n) => n.submeshes.some((s) => /^face$/i.test(s.name)))) {
    // A flattened multi-object export may store its face in the shell's vertex
    // basis while retaining the face object's old matrix. Prefer the shared
    // basis only when it demonstrably places the head inside the helmet.
    const enclosure = (ns) => {
      let inside = 0, total = 0;
      for (const node of ns) {
        const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const s of node.submeshes.filter((s) => !/^face$|^cam(?:era)?$/i.test(s.name))) {
          for (let i = s.triStart * 3; i < (s.triStart + s.triCount) * 3; i++) for (let k = 0; k < 3; k++) {
            const v = node.positions[node.indices[i] * 3 + k]; box[k] = Math.min(box[k], v); box[k + 3] = Math.max(box[k + 3], v);
          }
        }
        for (const s of node.submeshes.filter((s) => /^face$/i.test(s.name))) {
          for (let i = s.triStart * 3; i < (s.triStart + s.triCount) * 3; i++) {
            total++;
            if ([0, 1, 2].every((k) => { const v = node.positions[node.indices[i] * 3 + k]; return v >= box[k] - 0.02 && v <= box[k + 3] + 0.02; })) inside++;
          }
        }
      }
      return total ? inside / total : 0;
    };
    const candidate = level0Only(helmetSpecs.map((args) => readNode(...args, true, 0, true)));
    if (enclosure(candidate) > 0.8 && enclosure(candidate) > enclosure(selected) + 0.08) selected = candidate;
  }
  return { nodes: selected, textures, colors };
}

// ---- rider skeleton (bind pose) ----
// Records: [marker 0x1000|0x1800][matrix][inverse bind if 0x1800][index words][AABB 24B][next bone's name].
function affineAt(b, o) {
  if (o + 64 > b.length) return false;
  for (let i = 0; i < 16; i++) { const v = f32(b, o + i * 4); if (!Number.isFinite(v) || Math.abs(v) >= 100) return false; }
  return f32(b, o + 48) === 0 && f32(b, o + 52) === 0 && f32(b, o + 56) === 0 && f32(b, o + 60) === 1;
}
function boneName(b, o) {
  if (o >= b.length || !isAlpha(b[o])) return null;
  let e = o;
  while (e < b.length && e - o < 64) {
    const c = b[e];
    if (c === 0) break;
    if (!(isAlnum(c) || c === 46 || c === 95 || c === 45)) return null;
    e++;
  }
  return e - o >= 2 && e - o <= 63 ? b.toString('latin1', o, e) : null;
}
function readBoneTail(b, nameOff, invBind) {
  const aabb = nameOff - 24;
  if (aabb < 0) return null;
  const c = [];
  for (let i = 0; i < 6; i++) { const v = f32(b, aabb + i * 4); if (!Number.isFinite(v) || Math.abs(v) > 10) return null; c.push(v); }
  if (c[0] > c[3] || c[1] > c[4] || c[2] > c[5]) return null;
  const name = boneName(b, nameOff);
  return name ? { nextName: name, invBind, nameEnd: nameOff + name.length } : null;
}
function readBoneBlock(b, o) {
  const marker = u32(b, o);
  if (marker !== 0x1000 && marker !== 0x1800) return null;
  const two = marker === 0x1800, first = o + 4;
  if (!affineAt(b, first)) return null;
  let invBind = null;
  if (two) { invBind = readMat4(b, first + 64); if (!invBind) return null; }
  const fields = first + (two ? 128 : 64);
  for (let step = 0; step <= 200; step += 4) {
    const nameOff = fields + step + 24;
    if (nameOff >= b.length) return null;
    const t = readBoneTail(b, nameOff, invBind);
    if (t) { t.local = Array.from({ length: 16 }, (_, i) => f32(b, first + i * 4)); return t; }
  }
  return null;
}
function rigidInverse(m) {
  const t = [m[3], m[7], m[11]], out = new Array(16).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out[i * 4 + j] = m[j * 4 + i];
    out[i * 4 + 3] = -(m[i] * t[0] + m[4 + i] * t[1] + m[8 + i] * t[2]);
  }
  out[15] = 1;
  return out;
}
// -> { bones: { name: bind matrix (bone -> model space, row-major, translation in column 4) },
//      locals: { name: matrix relative to its parent } } (locals cover marker bones that bind no mesh)
function parseSkeleton(b) {
  if (!isEdf(b)) return { bones: {}, locals: {} };
  const blocks = [];
  for (let o = 0; o + 16 <= b.length;) {
    if (b[o] === 0 && (b[o + 1] === 0x10 || b[o + 1] === 0x18) && b[o + 2] === 0 && b[o + 3] === 0) {
      const bl = readBoneBlock(b, o);
      if (bl) { blocks.push(bl); o = bl.nameEnd; continue; }
    }
    o++;
  }
  const bones = {}, locals = {};
  for (let i = 0; i + 1 < blocks.length; i++) {
    const name = blocks[i].nextName, rec = blocks[i + 1];
    if (locals[name]) break; // the rig repeats once per LOD; the first copy matches LOD0
    locals[name] = rec.local;
    if (rec.invBind) bones[name] = rigidInverse(rec.invBind);
  }
  return { bones, locals };
}

module.exports = { isEdf, parse, parseSkeleton, embeddedTextures, inflateTexture, isCompanionTexture };
