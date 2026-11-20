const fs = require('fs/promises');
const path = require('path');
const PAINT = /^bikes\/[^/]+\/paints\/(.+\.pnt)$/i;
function previousOptions(record) {
  const first = (record.files || []).find((f) => !/^(game|user):/.test(f)) || '';
  const rider = first.match(/^rider\/riders\/([^/]+)\//i)?.[1];
  let kind = record.kind, paintTarget;
  if (PAINT.test(first)) { kind = 'bikePaint'; paintTarget = first.split('/')[1]; }
  const gear = first.match(/^rider\/(?:riders\/[^/]+\/)?(helmets|boots|protections)\/([^/]+)\/(paints|goggles)\//i);
  if (gear) { kind = ({ helmets: 'helmetPaint', boots: 'bootPaint', protections: 'protectionPaint' })[gear[1]]; paintTarget = gear[2]; }
  if (!kind) kind = /^tracks\//i.test(first) ? 'track' : /^bikes\//i.test(first) ? 'bike' : /\/gloves\//i.test(first) ? 'gloves' : /\/paints\//i.test(first) ? 'riderKit' : 'custom';
  return { ...(record.installOptions || {}), kind, ...(rider ? { riderTarget: rider } : {}), ...(paintTarget ? { paintTarget } : {}), ...(/^tracks\//i.test(first) ? { trackType: first.split('/')[1] } : {}) };
}
async function relocatePlan(plan, modsDir, signal) {
  const root = await fs.realpath(modsDir), moves = [];
  for (const entry of plan.entries) {
    if (!entry.dest) continue;
    const from = path.resolve(entry.abs), to = path.resolve(modsDir, entry.dest);
    if (!to.toLowerCase().startsWith(path.resolve(modsDir).toLowerCase() + path.sep)) throw new Error('Destination is outside the mods folder');
    for (const file of [from, to]) {
      let ancestor = file;
      while (ancestor !== path.resolve(modsDir)) {
        try { const st = await fs.lstat(ancestor); if (st.isSymbolicLink()) throw new Error('Install paths cannot contain links'); const real = await fs.realpath(ancestor); if (!real.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error('File is outside the mods folder'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('File is outside the mods folder'); ancestor = parent;
      }
    }
    if (from.toLowerCase() === to.toLowerCase()) continue;
    if (!(await fs.stat(from)).isFile()) throw new Error('An installed file is missing');
    try { await fs.lstat(to); throw new Error('A file already exists at the new location. Nothing was moved.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    moves.push({ from, to, old: path.relative(modsDir, from).replace(/\\/g, '/'), dest: entry.dest });
  }
  const done = [];
  try { for (const move of moves) { if (signal?.aborted) throw new Error('Cancelled'); await fs.mkdir(path.dirname(move.to), { recursive: true }); await fs.rename(move.from, move.to); done.push(move); if (signal?.aborted) throw new Error('Cancelled'); } }
  catch (e) { for (const move of done.reverse()) await fs.rename(move.to, move.from).catch(() => {}); throw e; }
  return new Map(moves.map((move) => [move.old, move.dest]));
}
function pruneHistory(jobs, limit = 10) {
  const completed = [...jobs.values()].filter((j) => ['done', 'error'].includes(j.status)).sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt));
  const removed = completed.slice(limit).map((j) => j.id);
  for (const id of removed) jobs.delete(id);
  return removed;
}
async function moveBikePaints({ modsDir, record, bike, installedBikes }) {
  if (!installedBikes.includes(bike) || !bike || /[\\/:\0]/.test(bike) || bike === '..') throw new Error('Choose an installed bike');
  const root = await fs.realpath(modsDir);
  async function safe(relative) {
    if (relative.split(/[\\/]/).some((p) => p === '..' || !p) || /[\0:]/.test(relative)) throw new Error('Invalid paint path');
    const abs = path.resolve(modsDir, relative);
    if (!abs.toLowerCase().startsWith(path.resolve(modsDir).toLowerCase() + path.sep)) throw new Error('Paint is outside the mods folder');
    let parent = abs;
    while (parent !== path.resolve(modsDir)) {
      try {
        const stat = await fs.lstat(parent);
        if (stat.isSymbolicLink()) throw new Error('Paint paths cannot contain links');
        const real = await fs.realpath(parent);
        if (!real.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error('Paint is outside the mods folder');
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      parent = path.dirname(parent);
    }
    return abs;
  }
  const moves = [];
  for (const rel of record.files || []) {
    const match = rel.match(PAINT); if (!match) continue;
    const dest = `bikes/${bike}/paints/${match[1]}`;
    if (rel.toLowerCase() === dest.toLowerCase()) continue;
    const from = await safe(rel), to = await safe(dest);
    if (!(await fs.stat(from)).isFile()) throw new Error('The installed paint file is missing');
    try { await fs.lstat(to); throw new Error('That bike already has a paint with the same filename. Nothing was moved.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    moves.push({ rel, dest, from, to });
  }
  if (!moves.length) throw new Error('No bike paints need to be moved');
  const done = [];
  try {
    for (const move of moves) { await fs.mkdir(path.dirname(move.to), { recursive: true }); await fs.rename(move.from, move.to); done.push(move); }
  } catch (e) { for (const move of done.reverse()) await fs.rename(move.to, move.from).catch(() => {}); throw e; }
  const changed = new Map(moves.map((m) => [m.rel, m.dest]));
  return { files: record.files.map((rel) => changed.get(rel) || rel), moved: moves.length, changes: changed };
}
module.exports = { pruneHistory, moveBikePaints, previousOptions, relocatePlan, isBikePaintFile: (file) => PAINT.test(file) };
