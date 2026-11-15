// Model swaps are visual overrides of an existing bike, never physics updates.
// Keep immutable packages and original loose files outside mods/. Apply alone
// changes live files; previews use an overlay of those same saved assets.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { validName } = require('./gear-assets');
const visual = (rel) => /\.(edf|hrc|shd|tga|dds|png|bmp)$/i.test(rel) || /(?:^|\/)gfx\.cfg$/i.test(rel);
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
function safe(root, rel) {
  if (!rel || /[:\0]/.test(rel) || path.isAbsolute(rel) || rel.split(/[\\/]/).some((p) => !p || p === '..' || p === '.')) throw new Error('Invalid model swap path');
  const base = path.resolve(root), file = path.resolve(base, rel);
  if (!file.toLowerCase().startsWith(base.toLowerCase() + path.sep)) throw new Error('Invalid model swap destination');
  for (let p = file; p !== base; p = path.dirname(p)) {
    try { if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Model swap paths cannot contain links'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return file;
}
function groups(plan) {
  const out = new Map();
  for (const e of plan.entries || []) {
    const m = e.dest?.match(/^bikes\/([^/]+)\/(.+)$/i);
    if (!m || !visual(m[2]) || /(?:^|\/)(?:paints|goggles)\//i.test(m[2])) continue;
    if (!validName(m[1])) throw new Error('Invalid model swap bike');
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push({ ...e, relative: m[2] });
  }
  return out;
}
async function validateReferences(plan, modsDir) {
  const { chainOf, readChain } = require('./asset-sources');
  for (const [bike, entries] of groups(plan)) {
    const files = Object.fromEntries(entries.map((e) => [e.relative, e.abs]));
    const chain = [{ kind: 'overlay', files }, ...await chainOf([{ dir: path.join(modsDir, 'bikes', bike) }])];
    const gfx = await readChain(chain, 'gfx.cfg');
    if (!gfx) throw new Error(`The base bike ${bike} has no readable gfx.cfg. Check the creator's install instructions.`);
    const seen = new Set();
    async function visit(data) {
      const text = data.buf.toString('latin1').replace(/(?:;|\/\/)[^\r\n]*/g, '');
      for (const match of text.matchAll(/([^\s="{};]+\.(?:edf|hrc))\b/gi)) {
        const rel = match[1].replace(/\\/g, '/');
        if (seen.has(rel.toLowerCase())) continue;
        seen.add(rel.toLowerCase());
        const source = await readChain(chain, rel);
        if (!source) throw new Error(`The model swap references a missing file: ${rel}. Follow the creator's naming instructions before installing.`);
        if (/\.hrc$/i.test(rel)) await visit(source);
      }
    }
    await visit(gfx);
    if (!entries.some((e) => /\.edf$/i.test(e.relative) && seen.has(e.relative.toLowerCase()))) throw new Error('The downloaded model filename does not match this bike’s graphics configuration. Check the creator’s required file names; the original bike has not been changed.');
  }
}
function create({ root, modsDir, isGameRunning, trash }) {
  let queue = Promise.resolve();
  const locked = (fn) => { const next = queue.catch(() => {}).then(fn); queue = next; return next; };
  const read = () => { try { return JSON.parse(fs.readFileSync(path.join(root(), 'index.json'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return { bikes: {} }; throw e; } };
  function write(data) { fs.mkdirSync(root(), { recursive: true }); const file = path.join(root(), 'index.json'); fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); }
  const cache = (rel) => safe(root(), rel);
  const live = (bike, rel) => safe(modsDir(), `bikes/${bike}/${rel}`);
  async function bytes(file) { try { return await fsp.readFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async function put(file, data) {
    if (data === null) { await fsp.unlink(file).catch((e) => { if (e.code !== 'ENOENT') throw e; }); return; }
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.mxbm-swap-' + crypto.randomUUID();
    try { await fsp.writeFile(temp, data); await fsp.rename(temp, file); }
    finally { await fsp.unlink(temp).catch(() => {}); }
  }
  async function select(bike, id) {
    if (!validName(bike)) throw new Error('Invalid bike');
    if (await isGameRunning()) throw new Error('Close MX Bikes before applying a model swap.');
    const data = read(), state = data.bikes[bike];
    if (!state) { if (!id) return; throw new Error('That model swap is not installed for this bike'); }
    const target = id ? state.packages[id] : null;
    if (id && !target) throw new Error('That model swap is not installed for this bike');
    const current = state.packages[state.active];
    const names = [...new Set([...Object.keys(current?.files || {}), ...Object.keys(target?.files || {})])];
    // Validate every input and detect manual edits before changing any live file.
    const writes = [], undo = [];
    for (const rel of names) {
      const file = live(bike, rel), before = await bytes(file);
      const expected = current?.files[rel] || state.originals[rel];
      if (Object.hasOwn(state.originals, rel) && (expected ? !before || hash(before) !== expected.hash : before !== null)) throw new Error(`The active swap's ${rel} was changed outside the manager. Reinstall or restore it before switching.`);
      if (!Object.hasOwn(state.originals, rel)) {
        const saved = `originals/${hash(bike)}/${rel}`;
        if (before) await put(cache(saved), before);
        state.originals[rel] = before ? { path: saved, hash: hash(before) } : null;
      }
      const source = target?.files[rel] || state.originals[rel];
      const after = source ? await bytes(cache(source.path)) : null;
      if (source && (!after || hash(after) !== source.hash)) throw new Error(`Saved model swap file is missing or changed: ${rel}`);
      writes.push({ file, before, after });
    }
    // Persist originals before touching the bike so recovery never loses them.
    write(data);
    try {
      for (const item of writes) { undo.push(item); await put(item.file, item.after); }
      state.active = id || ''; write(data);
    } catch (error) {
      const failures = [];
      for (const item of undo.reverse()) try { await put(item.file, item.before); } catch (e) { failures.push(e.message); }
      if (failures.length) error.message += ` Recovery files were kept in ${root()}. ${failures.join('; ')}`;
      throw error;
    }
  }
  return {
    install: (plan, metadata, signal) => locked(async () => {
      const data = read(), added = [];
      const created = [];
      try {
      for (const [bike, entries] of groups(plan)) {
        if (signal?.aborted) throw new Error('Cancelled');
        if (!fs.existsSync(path.join(modsDir(), 'bikes', bike + '.pkz')) && !fs.existsSync(path.join(modsDir(), 'bikes', bike, bike + '.ini'))) throw new Error(`Install the base bike ${bike} before its model swap.`);
        const state = data.bikes[bike] ||= { active: '', originals: {}, packages: {} };
        // A new immutable revision prevents interrupted upgrades from changing
        // files referenced by the currently active package.
        const id = crypto.randomUUID(), files = {};
        created.push(`packages/${id}`);
        for (const entry of entries) {
          if (signal?.aborted) throw new Error('Cancelled');
          const contents = await fsp.readFile(entry.abs), rel = `packages/${id}/${entry.relative}`;
          await put(cache(rel), contents); files[entry.relative] = { path: rel, hash: hash(contents) };
        }
        state.packages[id] = { id, ...metadata, files };
        added.push({ bike, id });
      }
      if (signal?.aborted) throw new Error('Cancelled');
      write(data); return added;
      } catch (error) {
        for (const dir of created) if (fs.existsSync(cache(dir))) await trash(cache(dir)).catch(() => {});
        throw error;
      }
    }),
    select: (bike, id) => locked(() => select(bike, id)),
    list(bike) {
      const state = read().bikes[bike];
      return { active: state?.active || '', options: [{ id: '', title: 'Default bike' }, ...Object.values(state?.packages || {}).map(({ id, title, link, files }) => ({ id, title, link, available: Object.values(files).every((f) => fs.existsSync(cache(f.path))) }))] };
    },
    status(url) {
      const key = (u) => { try { const p = new URL(u); return p.hostname.replace(/^www\./, '') + p.pathname.replace(/\/$/, ''); } catch { return ''; } };
      for (const [bike, state] of Object.entries(read().bikes)) for (const pack of Object.values(state.packages)) {
        if (key(url) && key(pack.link) === key(url) && Object.values(pack.files).every((f) => fs.existsSync(cache(f.path)))) return { installed: true, active: state.active === pack.id, matchedName: pack.title, bike };
      }
      return { installed: false };
    },
    shared(bike) {
      const state = read().bikes[bike], pack = state?.packages[state.active];
      return pack ? { slot: 'bikeAppearance', label: pack.title, error: `Model swap required [${hash(JSON.stringify(Object.entries(pack.files).map(([name, file]) => [name, file.hash]).sort()))}]` } : null;
    },
    sharedPreview(bike, entry) {
      if (!entry) return this.preview(bike, '');
      const fingerprint = entry.error?.match(/\[([a-f0-9]{64})\]/)?.[1];
      const state = read().bikes[bike];
      const pack = fingerprint && Object.values(state?.packages || {}).find((p) => hash(JSON.stringify(Object.entries(p.files).map(([name, file]) => [name, file.hash]).sort())) === fingerprint);
      return pack ? this.preview(bike, pack.id) : null;
    },
    preview(bike, id) {
      const state = read().bikes[bike];
      if (!state) { if (id) throw new Error('Model swap is not installed'); return {}; }
      const selected = id === undefined ? state.active : id;
      const target = selected ? state.packages[selected] : null;
      if (selected && !target) throw new Error('Model swap is not installed for this bike');
      const map = {};
      for (const [rel, file] of Object.entries(state.originals)) if (file) map[rel] = cache(file.path);
      for (const [rel, file] of Object.entries(target?.files || {})) map[rel] = cache(file.path);
      return { swapFiles: map, excludeLoose: Object.keys(state.originals) };
    },
    hasRecord(key) { return Object.values(read().bikes).some((b) => Object.values(b.packages).some((p) => p.recordKey === key)); },
    removeRecord: (key) => locked(async () => {
      let data = read();
      for (const [bike, state] of Object.entries(data.bikes)) if (state.packages[state.active]?.recordKey === key) await select(bike, '');
      data = read();
      for (const state of Object.values(data.bikes)) for (const [id, pack] of Object.entries(state.packages)) if (pack.recordKey === key) {
        await trash(cache(`packages/${id}`)); delete state.packages[id];
      }
      write(data);
    }),
  };
}
module.exports = { create, groups, visual, safe, validateReferences };
