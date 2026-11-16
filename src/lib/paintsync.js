// Sync only the currently equipped models and paints. Original paint bytes stay intact.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const profile = require('./profile');
const pnt = require('./pnt');
const gear = require('./gear-assets');
const { chainOf, readChain } = require('./asset-sources');
const { modelBundle, validateModel, MAX_FILE } = require('./gear-sync');
const { validateRiderPaint } = require('./paint-compat');
const tyres = require('./tyres');
const layout = require('./rider-layout');
const { withLocalPreview } = require('./assetread');
const PAID_MESSAGE = 'Paid mod — not installing.';
const syncError = (e) => e.code === 'MXBM_ACCOUNT_BOUND' ? PAID_MESSAGE : e.message;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const safeRel = (p) => typeof p === 'string' && /^(bikes|rider|tyres)\/.+\.(pnt|pkz)$/i.test(p) && !p.split('/').some((x) => !x || x === '.' || x === '..') && !/[\\:\0]/.test(p) && (!/\.pkz$/i.test(p) || /^(rider\/(?:riders\/[^/]+|(?:helmets|boots|protections)\/[^/]+)|tyres\/[^/]+)\.pkz$/i.test(p));
const readable = (buf) => { try { return pnt.names(buf).length > 0; } catch { return false; } };
const modelOf = { helmetPaint: 'helmet', gogglesPaint: 'helmet', bootsPaint: 'boots', protectionPaint: 'protection' };
const defaults = (kind, name) => kind === 'rider' ? /^(default_mx|default_sm)$/i.test(name) : kind === 'protection' ? /^(full|neck)$/i.test(name) : name === 'default';

async function outfitFiles(modsDir, prof, bike, protectedPaths = []) {
  const protectedSet = new Set(protectedPaths.map((p) => String(p).replace(/^game:/, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()));
  const protectedItem = (target) => protectedSet.has(String(target).replace(/\\/g, '/').toLowerCase());
  const lo = await profile.loadout(modsDir, prof, bike);
  const c = lo.current, rider = c.rider || 'default_mx', prefix = 'rider/riders/' + rider;
  const bikeDir = await profile.findBikeDir(modsDir, bike);
  const items = [], unavailable = [];
  const equipped = profile.SLOTS.map((s) => ({ slot: s.id, label: s.label, value: s.id === 'protection' && !c[s.id] ? 'None' : c[s.id] || s.default || '', state: 'default' }));
  let riderPaintError = null;
  try { await validateRiderPaint({ modsDir, current: c }); } catch (e) { riderPaintError = e.message; }
  for (const kind of ['rider', 'helmet', 'boots', 'protection']) {
    if (kind === 'protection' && !c.protection) continue;
    const name = c[kind] || (kind === 'rider' ? 'default_mx' : 'default');
    if (defaults(kind, name)) continue;
    try {
      const target = kind === 'rider' ? 'rider/riders/' + name + '.pkz' : 'rider/' + { helmet: 'helmets', boots: 'boots', protection: 'protections' }[kind] + '/' + name + '.pkz';
      if (protectedItem(target)) throw new Error(PAID_MESSAGE);
      const buf = await modelBundle({ modsDir, rider, kind, name });
      if (!buf) throw new Error('Model files are missing or unreadable');
      items.push({ slot: kind, label: lo.slots.find((s) => s.id === kind).label + ': ' + name, value: name, rider, modelKind: kind, path: target, sha256: sha256(buf), size: buf.length, buf, needs: [] });
    } catch (e) { unavailable.push({ slot: kind, label: name, error: syncError(e) }); }
  }
  for (const s of profile.SLOTS.filter((s) => /Paint$/.test(s.id))) {
    const name = c[s.id];
    if (!name) continue;
    try {
      const modelKind = modelOf[s.id];
      const modelFolder = { helmet: 'helmets', boots: 'boots', protection: 'protections' }[modelKind];
      const expectedTarget = s.id === 'bikePaint' ? `bikes/${bike}/paints/${name}.pnt`
        : ['suitPaint', 'glovesPaint'].includes(s.id) ? `${prefix}/${s.id === 'suitPaint' ? 'paints' : 'gloves'}/${name}.pnt`
        : modelFolder ? `rider/${modelFolder}/${c[modelKind] || 'default'}/${s.id === 'gogglesPaint' ? 'goggles' : 'paints'}/${name}.pnt` : '';
      if (protectedItem(expectedTarget)) throw new Error(PAID_MESSAGE);
      if (s.id === 'suitPaint' && riderPaintError) throw new Error(riderPaintError);
      let data, target;
      if (s.id === 'bikePaint') {
        data = bikeDir && await readChain(await chainOf([{ dir: bikeDir }]), 'paints/' + name + '.pnt');
        target = 'bikes/' + bike + '/paints/' + name + '.pnt';
      } else {
        data = await gear.paintSource({ modsDir, rider }, s.id, c);
        target = data && (['suitPaint', 'glovesPaint'].includes(s.id) ? prefix : 'rider') + '/' + data.relative;
      }
      if (!data || !readable(data.buf) || !safeRel(target)) throw new Error('Paint file is missing, damaged, or account-bound');
      const needs = [];
      if (s.id === 'bikePaint') needs.push({ kind: 'bike', name: bike });
      if (modelOf[s.id] && c[modelOf[s.id]] && !defaults(modelOf[s.id], c[modelOf[s.id]])) needs.push({ kind: modelOf[s.id], name: c[modelOf[s.id]], rider });
      if (['suitPaint', 'glovesPaint'].includes(s.id) && !defaults('rider', rider)) needs.push({ kind: 'rider', name: rider });
      if (protectedItem(target)) unavailable.push({ slot: s.id, label: s.label + ': ' + name, error: PAID_MESSAGE });
      else items.push({ slot: s.id, label: s.label + ': ' + name, value: name, rider, path: target, sha256: sha256(data.buf), size: data.buf.length, buf: data.buf, needs });
    } catch (e) { unavailable.push({ slot: s.id, label: s.label + ': ' + name, error: syncError(e) }); }
  }
  const tyre = await tyres.selected(modsDir, prof, bike, bikeDir);
  for (const name of [...new Set([tyre.selected, tyre.base].filter(gear.validName))]) {
    const slot = name === tyre.selected ? 'tyres' : 'tyreBase';
    const existingSlot = equipped.find((e) => e.slot === slot);
    if (existingSlot) existingSlot.value = name;
    else equipped.push({ slot, label: slot === 'tyres' ? 'Bike tyres' : 'Bike tyre dependency', value: name, state: 'default' });
    const exists = await fsp.stat(path.join(modsDir, 'tyres', name)).then(() => true).catch(() => false) || await fsp.stat(path.join(modsDir, 'tyres', name + '.pkz')).then(() => true).catch(() => false);
    if (!exists) continue; // Built-in game tyres are already available on both PCs.
    try {
      const target = 'tyres/' + name + '.pkz';
      if (protectedItem(target)) throw new Error(PAID_MESSAGE);
      const buf = await modelBundle({ modsDir, kind: 'tyres', name }); if (!buf) throw new Error('Tyre model is unavailable');
      items.push({ slot, label: 'Tyres: ' + name, value: name, modelKind: 'tyres', path: target, sha256: sha256(buf), size: buf.length, buf, needs: [] });
    } catch (e) { unavailable.push({ slot, label: name, error: syncError(e) }); }
  }
  for (const e of equipped) {
    if (items.some((i) => i.slot === e.slot)) e.state = 'shared';
    else if (unavailable.some((i) => i.slot === e.slot)) e.state = 'unavailable';
  }
  return { bike, items, unavailable, equipped };
}

async function share({ call, upload, modsDir, prof, bike, bikeName, appearance, protectedPaths = [], onProgress = () => {} }) {
  const outfit = await outfitFiles(modsDir, prof, bike, protectedPaths);
  if (appearance) outfit.unavailable.push(appearance);
  const items = outfit.items, meta = items.map(({ buf, ...m }) => m);
  const payload = { bike, bikeName, items: meta, equipped: outfit.equipped, unavailable: outfit.unavailable };
  const r = await call('POST', '/v1/loadout', payload);
  const missing = items.filter((i) => (r.missing || []).includes(i.sha256));
  let completed = 0;
  for (const it of missing) {
    onProgress({ phase: 'uploading', label: it.label, completed, total: missing.length, loaded: 0, size: it.size });
    await upload(it.sha256, it.buf);
    onProgress({ phase: 'uploading', label: it.label, completed: ++completed, total: missing.length, loaded: it.size, size: it.size });
  }
  if (missing.length) await call('POST', '/v1/loadout', payload);
  // Keep the former array return shape for the Sharing summary.
  return { items: meta, equipped: outfit.equipped, unavailable: outfit.unavailable };
}

async function inspectItem(it, { modsDir, have = () => true, received = {} }) {
  const entry = { ...it, requirements: it.needs || [], needs: [], state: 'ready' };
  delete entry.buf;
  if (!safeRel(it.path) || !/^[a-f0-9]{64}$/.test(it.sha256) || !Number.isSafeInteger(it.size) || it.size <= 0 || it.size > MAX_FILE) return { ...entry, state: 'skipped', error: 'Invalid shared file' };
  for (const n of it.needs || []) if (!await have(n)) entry.needs.push(n);
  const dst = path.resolve(modsDir, ...it.path.split('/'));
  let existing;
  try { existing = await fsp.readFile(dst); } catch {}
  const owned = existing && received[it.path] && sha256(existing) === received[it.path].sha256;
  if (existing && sha256(existing) === it.sha256) return { ...entry, state: 'have', needs: [] };
  // The same content in the legacy layout or inside a model package also counts.
  if (it.modelKind && gear.validName(it.value)) {
    const local = await modelBundle({ modsDir, rider: it.rider || 'default_mx', kind: it.modelKind, name: it.value }).catch(() => null);
    if (local && sha256(local) === it.sha256) return { ...entry, state: 'have', needs: [] };
    if (local && !owned) return { ...entry, state: 'name-taken', error: 'A different version of this model is already installed' };
  } else if (gear.validName(it.value)) {
    let data;
    if (it.path.startsWith('tyres/')) {
      const data = await readChain(await chainOf([{ dir: path.join(modsDir, 'tyres', it.path.split('/')[1]) }]), 'paints/' + it.value + '.pnt');
      if (data && sha256(data.buf) === it.sha256) return { ...entry, state: 'have' };
    } else if (it.slot === 'bikePaint') {
      const bike = it.path.split('/')[1], dir = await profile.findBikeDir(modsDir, bike);
      if (dir) data = await readChain(await chainOf([{ dir }]), 'paints/' + it.value + '.pnt');
    } else {
      const pieces = it.path.split('/');
      const current = { [it.slot]: it.value };
      const kind = modelOf[it.slot];
      const sub = { helmet: 'helmets', boots: 'boots', protection: 'protections' }[kind];
      const at = pieces.indexOf(sub);
      if (at >= 0) current[kind] = pieces[at + 1];
      data = await gear.paintSource({ modsDir, rider: it.rider || 'default_mx' }, it.slot, current);
    }
    if (data && sha256(data.buf) === it.sha256) return { ...entry, state: 'have' };
    if (data && !owned) return { ...entry, state: 'name-taken', error: 'A different paint with this name is already installed' };
  }
  if (existing && (!received[it.path] || sha256(existing) !== received[it.path].sha256)) return { ...entry, state: 'name-taken', error: 'A different file with this name is already installed' };
  return entry;
}

// preloaded: loadouts already fetched elsewhere (riders on the same server), instead of mutual friends.
async function listFriends({ call, modsDir, received = {}, have, friendId, preloaded }) {
  const { loadouts = [] } = preloaded ? { loadouts: preloaded } : await call('GET', '/v1/loadouts');
  const report = [];
  for (const lo of loadouts.filter((l) => !friendId || l.id === friendId)) {
    const items = [];
    for (const it of lo.items || []) items.push(await inspectItem({ ...it, path: typeof it.path === 'string' ? layout.canonical(it.path) : it.path }, { modsDir, received, have }));
    const current = Object.fromEntries((lo.equipped || []).map((e) => [e.slot, e.value]));
    const unavailable = [];
    for (const entry of lo.unavailable || []) {
      const paid = /paid|store-protected|account-bound/i.test(entry.error || '');
      let installed = false;
      const name = current[entry.slot], rider = current.rider || 'default_mx';
      if (paid && gear.validName(name)) {
        if (['rider', 'helmet', 'boots', 'protection'].includes(entry.slot)) {
          installed = await gear.hasModel({ modsDir, rider }, { rider: 'riders', helmet: 'helmets', boots: 'boots', protection: 'protections' }[entry.slot], name);
        } else if (/Paint$/.test(entry.slot) && entry.slot !== 'bikePaint') {
          installed = !!await withLocalPreview(() => gear.paintSource({ modsDir, rider }, entry.slot, current));
        } else if (entry.slot === 'bikePaint' && gear.validName(lo.bike)) {
          const dir = await profile.findBikeDir(modsDir, lo.bike);
          installed = !!(dir && await withLocalPreview(async () => readChain(await chainOf([{ dir }]), 'paints/' + name + '.pnt')));
        }
      }
      unavailable.push({ ...entry, state: installed ? 'have' : 'unavailable', error: paid ? PAID_MESSAGE : entry.error });
    }
    report.push({ ...lo, items, unavailable });
  }
  return report;
}

async function fetchFriends({ call, download, modsDir, received, have, friendId, preloaded, onProgress = () => {} }) {
  const report = await listFriends({ call, modsDir, received, have, friendId, preloaded });
  const pending = report.flatMap((lo) => lo.items.filter((it) => it.state === 'ready').map((it) => ({ lo, it })));
  let completed = 0;
  for (const { lo, it } of pending) {
    const progress = (loaded) => onProgress({ phase: 'downloading', friendId: lo.id, label: it.label, completed, total: pending.length, loaded, size: it.size });
    progress(0);
    try {
      const buf = await download(it.sha256, progress);
      if (sha256(buf) !== it.sha256 || buf.length !== it.size || (it.modelKind ? !await validateModel(buf, it.modelKind) : !readable(buf))) throw new Error('Shared file failed validation');
      const dst = path.resolve(modsDir, ...it.path.split('/'));
      // Recheck immediately before writing, including symlink ancestors.
      const root = await fsp.realpath(modsDir);
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      const parent = await fsp.realpath(path.dirname(dst));
      if (!parent.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error('Destination is outside your mods folder');
      const latest = await inspectItem(it, { modsDir, received, have });
      if (latest.state !== 'ready') { Object.assign(it, latest); }
      else {
        if (received[it.path]) await fsp.writeFile(dst, buf);
        else await fsp.writeFile(dst, buf, { flag: 'wx' });
        received[it.path] = { sha256: it.sha256, from: lo.name || lo.id, at: Date.now() };
        it.state = 'downloaded'; it.needs = [];
      }
    } catch (e) { it.state = 'failed'; it.error = e.message; }
    completed++;
    onProgress({ phase: 'downloading', friendId: lo.id, label: it.label, completed, total: pending.length, loaded: 0, size: 0 });
  }
  // Refresh requirements after models have been installed.
  for (const lo of report) for (const it of lo.items) {
    it.needs = [];
    for (const n of it.requirements || []) if (!await have(n)) it.needs.push(n);
  }
  return report;
}

async function removeReceived(modsDir, received) {
  let n = 0;
  for (const [r, info] of Object.entries(received)) {
    if (!safeRel(r)) { delete received[r]; continue; }
    const f = path.join(modsDir, ...r.split('/'));
    try {
      const real = await fsp.realpath(f), root = await fsp.realpath(modsDir);
      if (real.toLowerCase().startsWith(root.toLowerCase() + path.sep) && sha256(await fsp.readFile(f)) === info.sha256) { await fsp.rm(f); n++; }
    } catch {}
    delete received[r];
  }
  return n;
}
module.exports = { outfitFiles, share, listFriends, fetchFriends, removeReceived, safeRel, readable };
