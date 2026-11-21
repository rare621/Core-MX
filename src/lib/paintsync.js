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
const ACCOUNT_BOUND_MESSAGE = 'This file is tied to your account. Your friend needs their own copy.';
const syncError = (e) => e.code === 'MXBM_ACCOUNT_BOUND' ? ACCOUNT_BOUND_MESSAGE : e.message;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const safeRel = (p) => typeof p === 'string' && /^(bikes|rider|tyres)\/.+\.(pnt|pkz)$/i.test(p) && !p.split('/').some((x) => !x || x === '.' || x === '..') && !/[\\:\0]/.test(p) && (!/\.pkz$/i.test(p) || /^(rider\/(?:riders\/[^/]+|(?:helmets|boots|protections)\/[^/]+)|tyres\/[^/]+)\.pkz$/i.test(p));
const readable = (buf) => { try { return pnt.names(buf).length > 0; } catch { return false; } };
const modelOf = { helmetPaint: 'helmet', gogglesPaint: 'helmet', bootsPaint: 'boots', protectionPaint: 'protection' };
const defaults = (kind, name) => kind === 'rider' ? /^(default_mx|default_sm)$/i.test(name) : kind === 'protection' ? /^(full|neck)$/i.test(name) : name === 'default';

// stockPkz: the game's own rider.pkz. A paint found only there is stock: every player has it, so it
// is neither shared nor reported as missing.
async function outfitFiles(modsDir, prof, bike, protectedPaths = [], stockPkz = null) {
  const protectedSet = new Set(protectedPaths.map((p) => String(p).replace(/^game:/, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()));
  const protectedItem = (target) => protectedSet.has(String(target).replace(/\\/g, '/').toLowerCase());
  const lo = await profile.loadout(modsDir, prof, bike);
  const c = lo.current, rider = c.rider || 'default_mx', prefix = 'rider/riders/' + rider;
  const bikeDir = await profile.findBikeDir(modsDir, bike);
  const items = [], unavailable = [];
  const equipped = profile.SLOTS.map((s) => ({ slot: s.id, label: s.label, value: s.id === 'protection' && !c[s.id] ? 'None' : c[s.id] || s.default || '', state: 'default' }));
  let riderPaintError = null;
  // Checked against the game's own rider model (rider.pkz: its number and name plates too). Without
  // it the check can't be right, so it's skipped: the paint was checked when it was equipped.
  if (stockPkz) { try { await validateRiderPaint({ modsDir, stockPkz, current: c }); } catch (e) { riderPaintError = e.message; } }
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
    } catch (e) { unavailable.push({ slot: kind, label: name, error: syncError(e), files: [kind === 'rider' ? 'rider/riders/' + name : 'rider/' + { helmet: 'helmets', boots: 'boots', protection: 'protections' }[kind] + '/' + name] }); }
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
      if (!data && s.id !== 'bikePaint' && stockPkz && await gear.paintSource({ modsDir, rider, stockPkz }, s.id, c).catch(() => null)) continue;
      // A livery inside the bike's own package (readable, or encrypted like the OEM bikes') comes with the bike.
      if (s.id === 'bikePaint' && (data ? data.archivePath : bikeDir && fs.existsSync(bikeDir + '.pkz'))) { unavailable.push({ slot: s.id, label: s.label + ': ' + name, error: WITH_BIKE_MESSAGE, included: 'bike' }); continue; }
      if (!data || !readable(data.buf) || !safeRel(target)) throw new Error('Paint file is missing or unreadable (it may be locked by its creator)');
      const needs = [];
      if (s.id === 'bikePaint') needs.push({ kind: 'bike', name: bike });
      if (modelOf[s.id] && c[modelOf[s.id]] && !defaults(modelOf[s.id], c[modelOf[s.id]])) needs.push({ kind: modelOf[s.id], name: c[modelOf[s.id]], rider });
      if (['suitPaint', 'glovesPaint'].includes(s.id) && !defaults('rider', rider)) needs.push({ kind: 'rider', name: rider });
      if (protectedItem(target)) unavailable.push({ slot: s.id, label: s.label + ': ' + name, error: PAID_MESSAGE });
      else items.push({ slot: s.id, label: s.label + ': ' + name, value: name, rider, path: target, sha256: sha256(data.buf), size: data.buf.length, buf: data.buf, needs });
    } catch (e) {
      // Where it lives: the paint file, then the model it belongs to (a paint inside a model package).
      const mk = modelOf[s.id], folder = { helmet: 'helmets', boots: 'boots', protection: 'protections' }[mk];
      const files = s.id === 'bikePaint' ? [`bikes/${bike}/paints/${name}.pnt`]
        : ['suitPaint', 'glovesPaint'].includes(s.id) ? [`${prefix}/${s.id === 'suitPaint' ? 'paints' : 'gloves'}/${name}.pnt`, `rider/${s.id === 'suitPaint' ? 'paints' : 'gloves'}/${name}.pnt`]
        : folder ? [`rider/${folder}/${c[mk] || 'default'}/${s.id === 'gogglesPaint' ? 'goggles' : 'paints'}/${name}.pnt`, `rider/${folder}/${c[mk] || 'default'}`] : [];
      unavailable.push({ slot: s.id, label: s.label + ': ' + name, error: syncError(e), files });
    }
  }
  const tyre = await tyres.selected(modsDir, prof, bike, bikeDir);
  for (const name of [...new Set([tyre.selected, tyre.base].filter(gear.validName))]) {
    const slot = name === tyre.selected ? 'tyres' : 'tyreBase';
    const existingSlot = equipped.find((e) => e.slot === slot);
    if (existingSlot) existingSlot.value = name;
    else equipped.push({ slot, label: slot === 'tyres' ? 'Bike tyres' : 'Bike tyre dependency', value: name, state: 'default' });
    const exists = await fsp.stat(path.join(modsDir, 'tyres', name)).then(() => true).catch(() => false) || await fsp.stat(path.join(modsDir, 'tyres', name + '.pkz')).then(() => true).catch(() => false);
    if (!exists) continue; // Built-in game tyres are already available on both PCs.
    // OEM tyres ship with the OEM bike packs (oem_mx, ...): everyone riding those bikes has them.
    if (name === tyre.base && /^oem[_-]/i.test(name)) { unavailable.push({ slot, label: 'Tyres: ' + name, error: WITH_BIKE_MESSAGE, included: 'bike' }); continue; }
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

// Keep the MXB Mods page for a file that genuinely cannot be synced, so the
// recipient can choose how to get it. Shop installs are personal to the buyer.
function modSources(installs) {
  const idx = [];
  for (const r of Object.values(installs || {})) {
    if (!r || r.shopKey || !Number.isSafeInteger(Number(r.postId)) || Number(r.postId) <= 0 || !/^https:\/\/mxb-mods\.com\//i.test(String(r.link || ''))) continue;
    const source = { postId: Number(r.postId), title: String(r.title || '').slice(0, 100), link: String(r.link).slice(0, 300),
      ...(/^https:\/\//i.test(String(r.image || '')) ? { image: String(r.image).slice(0, 300) } : {}),
      ...(/^https?:\/\//i.test(String(r.source || '')) && String(r.source).length <= 300 ? { download: String(r.source) } : {}) };
    for (const file of r.files || []) idx.push([String(file).replace(/\\/g, '/').toLowerCase(), source, String(file).replace(/\\/g, '/')]);
  }
  return (paths = []) => {
    for (const p of paths) {
      const want = String(p).toLowerCase();
      // A file itself, or a model as a package (name.pkz) or a folder (name/...).
      const hit = idx.find(([f]) => f === want || f === want + '.pkz' || f.startsWith(want + '/'));
      if (hit) return { ...hit[1], fileName: hit[2].split('/').pop().slice(0, 120) };
    }
    return null;
  };
}
const SOURCE_MESSAGE = 'Too big or locked to send. Riders get it from its MXB Mods page (CoreMX installs it for them).';
// Files that come with the bike itself (its default tyre, a livery inside the bike's package): anyone
// riding that bike has them, so they are not uploaded.
const WITH_BIKE_MESSAGE = 'Comes with the bike';

async function share({ call, upload, modsDir, prof, bike, bikeName, appearance, protectedPaths = [], stockPkz = null, sourceFor = () => null, onProgress = () => {} }) {
  const outfit = await outfitFiles(modsDir, prof, bike, protectedPaths, stockPkz);
  outfit.unavailable = outfit.unavailable.map(({ files, ...u }) => {
    if (u.error === PAID_MESSAGE) return u;
    const source = sourceFor(files || []);
    return source ? { ...u, error: SOURCE_MESSAGE, source } : u;
  });
  if (appearance) outfit.unavailable.push(appearance);
  // The free MXB Mods page each shared file was installed from: other riders install from there
  // first (service v27), and use the file sent through the service only if that doesn't work.
  const where = (p) => [p, p.replace(/\.pkz$/i, ''), p.replace(/^rider\/riders\/default_mx\/(paints|gloves)\//i, 'rider/$1/')];
  const items = outfit.items, meta = items.map(({ buf, ...m }) => { const source = sourceFor(where(m.path)); return source ? { ...m, source } : m; });
  // onDemand: the service asks for a file only once someone needs it (see server/mxbm-server.js).
  const payload = { bike, bikeName, items: meta, equipped: outfit.equipped, unavailable: outfit.unavailable, onDemand: true };
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
  delete entry.available;
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
    // A CoreMX-owned package with different bytes may be an older flat model
    // archive. Reinstall it even if repacking its files resembles the sender's.
    if (local && !owned && sha256(local) === it.sha256) return { ...entry, state: 'have', needs: [] };
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
  // Needed, but its owner hasn't uploaded it yet (uploads happen once someone needs a file).
  if (it.available === false) return { ...entry, state: 'waiting' };
  return entry;
}

// preloaded: loadouts already fetched elsewhere (riders on the same server), instead of mutual friends.
async function listFriends({ call, modsDir, received = {}, have, friendId, preloaded }) {
  const { loadouts = [] } = preloaded ? { loadouts: preloaded } : await call('GET', '/v1/loadouts?pending=1');
  const report = [];
  for (const lo of loadouts.filter((l) => !friendId || l.id === friendId)) {
    const items = [];
    for (const it of lo.items || []) items.push(await inspectItem({ ...it, path: typeof it.path === 'string' ? layout.canonical(it.path) : it.path }, { modsDir, received, have }));
    const current = Object.fromEntries((lo.equipped || []).map((e) => [e.slot, e.value]));
    const unavailable = [];
    for (const entry of lo.unavailable || []) {
      // Comes with the bike: you have it when you have that bike.
      if (entry.included === 'bike' || entry.error === WITH_BIKE_MESSAGE) {
        const bike = lo.bike && gear.validName(lo.bike) && await profile.findBikeDir(modsDir, lo.bike);
        unavailable.push({ ...entry, included: 'bike', state: bike ? 'have' : 'unavailable', error: bike ? WITH_BIKE_MESSAGE : `Comes with the bike (${lo.bikeName || lo.bike}), which you don't have` });
        continue;
      }
      const paid = /paid|store-protected/i.test(entry.error || '');
      let installed = false;
      const name = current[entry.slot], rider = current.rider || 'default_mx';
      // Anything the owner couldn't send (paid, tied to their account, too big, locked): you may have
      // installed it yourself, then you have it. The app checks again on every sync.
      if (gear.validName(name)) {
        if (['rider', 'helmet', 'boots', 'protection'].includes(entry.slot)) {
          installed = have ? !!await have({ kind: entry.slot, name, rider }).catch(() => false)
            : await gear.hasModel({ modsDir, rider }, { rider: 'riders', helmet: 'helmets', boots: 'boots', protection: 'protections' }[entry.slot], name);
        } else if (/Paint$/.test(entry.slot) && entry.slot !== 'bikePaint') {
          installed = !!await withLocalPreview(() => gear.paintSource({ modsDir, rider }, entry.slot, current));
        } else if (entry.slot === 'bikePaint' && gear.validName(lo.bike)) {
          const dir = await profile.findBikeDir(modsDir, lo.bike);
          installed = !!(dir && await withLocalPreview(async () => readChain(await chainOf([{ dir }]), 'paints/' + name + '.pnt')));
        }
      }
      unavailable.push({ ...entry, state: installed ? 'have' : 'unavailable', error: paid ? PAID_MESSAGE : entry.error });
    }
    // A paint from the same MXB Mods download as a model you now have (a helmet with its paints in a
    // locked package, which can't be looked inside) came with that model.
    // Also when neither has a page on record: the owner couldn't send the model, and its paint
    // failed with it (a paint in a locked package). If it's really not in the package, the in-game
    // overlay still shows it missing.
    for (const u of unavailable) {
      if (u.state !== 'unavailable' || !modelOf[u.slot] || /paid|store-protected|tied to your account|account-bound/i.test(u.error || '')) continue;
      const model = unavailable.find((m) => m.slot === modelOf[u.slot] && m.state === 'have' && m.included !== 'bike'
        && (m.source && u.source ? m.source.postId === u.source.postId : !u.source));
      if (model) u.state = 'have';
    }
    report.push({ ...lo, items, unavailable });
  }
  return report;
}

// Asks the service for files you need that aren't uploaded yet; their owners upload them on their
// next report. Each becomes 'uploading' (owner online), 'offline' (owner's CoreMX is closed) or, if it
// arrived meanwhile, 'ready' again. Older services have no /v1/want: those items stay 'waiting'.
// Files this app asked for: when first asked (a file still not uploaded after STALL_AFTER becomes
// 'stalled': no more fast re-checks; the normal sync keeps asking quietly). Confirmed once installed.
const asked = new Map();
const STALL_AFTER = 3 * 60 * 1000;
// The state to show for a file not uploaded yet, between syncs.
const pendingState = (sha, ownerOnline, now = Date.now()) => !ownerOnline ? 'offline' : now - (asked.get(sha) || now) > STALL_AFTER ? 'stalled' : 'uploading';
async function requestMissing(call, report, now = Date.now()) {
  const waiting = report.flatMap((lo) => lo.items.filter((it) => it.state === 'waiting'));
  if (!waiting.length) return;
  for (const it of waiting) if (!asked.has(it.sha256)) asked.set(it.sha256, now);
  let states = {};
  try { states = (await call('POST', '/v1/want', { shas: [...new Set(waiting.map((it) => it.sha256))] })).states || {}; } catch { return; }
  for (const it of waiting) {
    const st = states[it.sha256];
    if (st === 'uploading') it.state = now - (asked.get(it.sha256) || now) > STALL_AFTER ? 'stalled' : 'uploading';
    else if (st === 'offline') it.state = 'offline';
    else if (st === 'ready') it.state = 'ready';
  }
}

// viaPage(lo, item): for a file you don't have, try its MXB Mods page first (the owner's, or the shared
// catalog). A truthy answer means it's being installed from there: the file isn't asked for or
// downloaded through the service this time (state 'page'). Falsy: the file comes through the service.
async function fetchFriends({ call, download, modsDir, received, have, friendId, preloaded, viaPage = null, onProgress = () => {} }) {
  const report = await listFriends({ call, modsDir, received, have, friendId, preloaded });
  if (viaPage) for (const lo of report) for (const it of lo.items) {
    if (!['ready', 'waiting'].includes(it.state)) continue;
    const page = await Promise.resolve(viaPage(lo, it)).catch(() => null);
    if (page) { it.state = 'page'; it.page = page; }
  }
  await requestMissing(call, report);
  const pending = report.flatMap((lo) => lo.items.filter((it) => it.state === 'ready').map((it) => ({ lo, it })));
  let completed = 0;
  for (const { lo, it } of pending) {
    const progress = (loaded) => onProgress({ phase: 'downloading', friendId: lo.id, friendName: lo.name || '', label: it.label, completed, total: pending.length, loaded, size: it.size });
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
  // Tell the service which asked-for files are installed now, so it may let them go (it keeps them
  // until then, even across an interrupted download). Older services have no /v1/received.
  const done = [...new Set(report.flatMap((lo) => lo.items.filter((it) => it.state === 'downloaded' || (it.state === 'have' && asked.has(it.sha256))).map((it) => it.sha256)))];
  if (done.length) { try { await call('POST', '/v1/received', { shas: done.slice(0, 64) }); for (const sha of done) asked.delete(sha); } catch {} }
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
// Synced files keep a "last needed" time (used): the last time a friend's or a server rider's gear
// listed them. Called with every gear report; written at most once an hour per file.
function touchReceived(received, reports, now = Date.now()) {
  let changed = false;
  for (const r of reports || []) for (const it of (r && r.items) || []) {
    const e = it && typeof it.path === 'string' && Object.hasOwn(received, it.path) ? received[it.path] : null;
    if (e && now - (Number(e.used) || 0) > 3600 * 1000) { received[it.path] = { ...e, used: now }; changed = true; }
  }
  return changed;
}

// Synced files nobody has needed for `days` go to the Recycle Bin (trash). Each file has its own
// time: its last use, or its download when it was never needed again. keep(rel): files the player
// uses themselves stay (their time restarts). A file the player changed is no longer treated as
// synced and is left alone. Returns how many files were removed.
async function pruneReceived(modsDir, received, { days, now = Date.now(), keep = () => false, trash }) {
  if (!(Number(days) > 0)) return 0;
  let n = 0;
  const root = await fsp.realpath(modsDir).catch(() => null);
  if (!root) return 0;
  for (const [r, info] of Object.entries(received)) {
    if (!safeRel(r)) { delete received[r]; continue; }
    const last = Math.max(Number(info && info.used) || 0, Number(info && info.at) || 0);
    if (now - last < days * 24 * 3600 * 1000) continue;
    if (keep(r)) { received[r] = { ...info, used: now }; continue; }
    const f = path.join(modsDir, ...r.split('/'));
    try {
      const real = await fsp.realpath(f);
      if (!real.toLowerCase().startsWith(root.toLowerCase() + path.sep)) continue;
      if (sha256(await fsp.readFile(f)) === info.sha256) { await trash(f); n++; }
      delete received[r];
    } catch (e) { if (e.code === 'ENOENT') delete received[r]; }
  }
  return n;
}
module.exports = { WITH_BIKE_MESSAGE, requestMissing, pendingState, modSources, outfitFiles, share, listFriends, fetchFriends, removeReceived, touchReceived, pruneReceived, safeRel, readable };
