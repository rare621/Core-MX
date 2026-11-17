const { app, BrowserWindow, ipcMain, protocol, shell, dialog, session, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

const { Store } = require('./src/lib/store');
const paths = require('./src/lib/paths');
const scanner = require('./src/lib/scanner');
const { Thumbs } = require('./src/lib/thumbs');
const site = require('./src/lib/site');
const coremx = require('./src/lib/coremx');
const { mergeBrowsePosts } = require('./src/lib/browse-sort');
const hosts = require('./src/lib/hosts');
const archive = require('./src/lib/archive');
const installer = require('./src/lib/installer');
const { detectKind } = require('./src/lib/detect');
const profile = require('./src/lib/profile');
const shops = require('./src/lib/shops');
const steam = require('./src/lib/steam');
const packs = require('./src/lib/packs');
const game = require('./src/lib/game');
const health = require('./src/lib/health');
const ranked = require('./src/lib/ranked');
const graphics = require('./src/lib/graphics');
const graphicsPackages = require('./src/lib/graphics-packages');
const recentInstalls = require('./src/lib/recent-installs');
const equipInstalled = require('./src/lib/equip-installed');
const serverPing = require('./src/lib/server-ping');
const frostmod = require('./src/lib/frostmod');
const host = require('./src/lib/host');
const rider3d = require('./src/lib/rider3d');
const bike3d = require('./src/lib/bike3d');
const imageMatch = require('./src/lib/image-match');
const { filesMatch } = require('./src/lib/file-verify');
const onlineSvc = require('./src/lib/online');
const gearAssets = require('./src/lib/gear-assets');
const riderPaints = require('./src/lib/rider-paints');
const installSummary = require('./src/lib/install-summary');
const { mergeMove } = require('./src/lib/merge-move');
const riderLayout = require('./src/lib/rider-layout');
const appUpdates = require('./src/lib/app-updates');
const modelWorkers = require('./src/lib/model-workers').create();
const paintCompat = require('./src/lib/paint-compat');
const { chainOf, readChain } = require('./src/lib/asset-sources');
let online = null;
let updates = null;
let riderWatch = null;
function watchRiderProfiles() {
  if (riderWatch) return;
  let previous = '';
  riderWatch = setInterval(async () => {
    try {
      const list = await profile.listProfiles(profUserDir());
      const stat = list.last && await fsp.stat(path.join(profUserDir(), 'profiles', list.last, 'profile.ini'));
      const key = JSON.stringify([list.last, list.profiles, stat?.mtimeMs, stat?.size]);
      if (previous && key !== previous) send('rider:changed', { active: list.last }); previous = key;
    } catch {}
  }, 2000); riderWatch.unref();
}
// online.config.json next to the app: { "serviceUrl": "http://<server PC>:8787" } — the service
// everyone's app connects to without asking.
function stockRiderPkz() { const inst = store.get('settings').gameInstallDir; return inst ? path.join(inst, 'rider.pkz') : null; }
const { dependencyKey, dependencyModelKind, matchingModel, dependencySearchScore, isModelRequirement } = require('./src/lib/dependency-match');
async function dependencyStatus(dependency, records, catalog) {
  if (dependency.kind === 'bikeSwap') {
    const known = bikeSwaps.status(dependency.url);
    if (known.installed) return { ...known, kind: 'bikeSwap' };
    const previous = records.find((r) => dependencyKey(r.link) === dependencyKey(dependency.url) && r.files.some((f) => /^bikes\/.*\.edf$/i.test(f)) && r.files.filter((f) => /^bikes\/.*\.(edf|hrc|cfg)$/i.test(f)).every((f) => fs.existsSync(path.join(modsDir(), f))));
    return { installed: !!previous, kind: 'bikeSwap', active: !!previous, matchedName: previous?.title };
  }
  if (dependency.unidentified) return { installed: null };
  const key = dependencyKey(dependency.url);
  const recorded = key && records.some((record) => dependencyKey(record.link) === key && record.files.some((file) => /\.(pkz|edf)$/i.test(file) && !file.startsWith('game:') && fs.existsSync(path.join(modsDir(), file))));
  const kind = dependency.kind || dependencyModelKind(dependency);
  if (recorded) return { installed: true, kind };
  if (!kind || !catalog) return { installed: null, kind };
  const name = matchingModel(catalog[({ helmets: 'helmet', protections: 'protection' })[kind] || kind] || [], dependency);
  // A model folder named differently from the listing can still be the right one when this app installed it.
  if (!name) { const byTitle = records.find((r) => r.title && matchingModel([r.title], dependency) && r.files.some((f) => /\.(pkz|edf)$/i.test(f) && !f.startsWith('game:') && fs.existsSync(path.join(modsDir(), f)))); if (byTitle) return { installed: true, kind, matchedName: byTitle.title }; }
  return { installed: name ? true : false, kind, matchedName: name || '' };
}
function onlineConfig() {
  try {
    const root = app.isPackaged ? process.resourcesPath : __dirname;
    const config = JSON.parse(fs.readFileSync(path.join(root, 'online.config.json'), 'utf8'));
    const origin = (value) => {
      const u = String(value || '').trim().replace(/\/+$/, '');
      return /^https?:\/\/[^\s/]+(:\d+)?$/i.test(u) ? u : '';
    };
    return { defaultUrl: origin(config.serviceUrl), previousServiceUrls: Array.isArray(config.previousServiceUrls) ? config.previousServiceUrls.map(origin).filter(Boolean) : [] };
  } catch { return { defaultUrl: '', previousServiceUrls: [] }; }
}
// ---- Missing track: the game plugin writes mxbm_missing.json when MX Bikes shows its
// "Missing Track" window, and mxbm_hook.json with the detector's state.
function trackQueries(id) {
  const words = String(id || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/).filter(Boolean);
  const out = [words.join(' ')];
  // Track ids often start with the creator's handle ("eraaks212_MNSR_Raceway").
  if (words.length > 2 && /\d/.test(words[0])) out.push(words.slice(1).join(' '));
  if (words.length > 3) out.push(words.slice(-2).join(' '));
  return [...new Set(out.filter((q) => q.length >= 3))];
}
async function searchMissingTrack(id) {
  const queries = trackQueries(id), found = new Map();
  await Promise.all(queries.flatMap((q) => [
    site.search({ query: q, tab: 'tracks', perPage: 12, orderby: 'relevance' }).then((r) => r.posts.map((p) => ({ ...p, source: 'mxb-mods' }))).catch(() => []),
    shops.search(ses, { shop: 'hub', query: q, page: 1 }).then((r) => r.products.map((p) => ({ ...p, source: 'hub' }))).catch(() => []),
    shops.search(ses, { shop: 'mxbs', query: q, cat: 248, page: 1 }).then((r) => r.products.map((p) => ({ ...p, source: 'mxbs' }))).catch(() => []),
  ].map((pr) => pr.then((items) => { for (const item of items) {
    const score = Math.max(...queries.map((label) => dependencySearchScore(item, { label })));
    const key = item.link || `${item.source}:${item.id}`;
    if (score > 0 && (!found.has(key) || found.get(key).score < score)) found.set(key, { ...item, score });
  } }))));
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}
let missingSeen = { track: '', at: 0 };
async function onMissingTrackFile(file) {
  let info; try { info = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return; }
  const track = String(info.track || '').split(' - ')[0].trim().slice(0, 120);
  if (!track || !info.at || Date.now() - info.at > 10 * 60 * 1000) return;
  if (missingSeen.track === track && info.at - missingSeen.at < 30000) return;
  missingSeen = { track, at: info.at };
  const results = await searchMissingTrack(track).catch(() => []);
  const address = game.validAddress(String(info.address || '')) || null;
  send('missing:track', { track, results, at: info.at, address, server: String(info.server || '').slice(0, 64) });
  // Get the app in front: over a borderless/windowed game it appears right away; with exclusive
  // full screen Windows keeps it behind the game, so it flashes in the taskbar until you Alt+Tab.
  if (mainWin && !mainWin.isDestroyed() && !mainWin.isFocused()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.showInactive();
    mainWin.setAlwaysOnTop(true, 'screen-saver'); mainWin.moveTop();
    setTimeout(() => { if (mainWin && !mainWin.isDestroyed()) mainWin.setAlwaysOnTop(false); }, 1500);
    mainWin.flashFrame(true);
  }
}
async function onHookStateFile(file) {
  let info; try { info = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return; }
  if (!['paused', 'disabled'].includes(info.state) || /not running inside MX Bikes/i.test(info.detail || '')) return;
  const key = `${info.state}:${info.build}`;
  if (store.get('settings').hookNotice === key) return;
  store.update('settings', (s) => ({ ...s, hookNotice: key }));
  send('plugin:hook', info);
}
let pluginWatch = null;
function watchPluginFiles() {
  const dir = userDir(); if (!dir || pluginWatch === dir) return;
  pluginWatch = dir;
  const missing = path.join(dir, 'mxbm_missing.json'), hook = path.join(dir, 'mxbm_hook.json');
  fs.watchFile(missing, { interval: 1000 }, (cur, prev) => { if (cur.mtimeMs && cur.mtimeMs !== prev.mtimeMs) onMissingTrackFile(missing); });
  fs.watchFile(hook, { interval: 3000 }, (cur, prev) => { if (cur.mtimeMs && cur.mtimeMs !== prev.mtimeMs) onHookStateFile(hook); });
  if (fs.existsSync(hook)) onHookStateFile(hook);
}
function insideGame(p) {
  const g = store.get('settings').gameInstallDir;
  return !!g && path.resolve(p).toLowerCase().startsWith(path.resolve(g).toLowerCase() + path.sep);
}

// Keep the existing data directory when upgrading to CoreMX.
app.setPath('userData', path.join(app.getPath('appData'), 'MX Bikes Manager'));
app.setName('CoreMX');
// Test-only overrides: isolated app data and a fake game folder.
if (process.env.MXB_USERDATA) app.setPath('userData', process.env.MXB_USERDATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'mxb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let mainWin = null;
let store, thumbs, ses;
const bikeSwaps = require('./src/lib/bike-swaps').create({
  root: () => path.join(app.getPath('userData'), 'bike-swaps'), modsDir,
  isGameRunning: () => profile.isGameRunning(), trash: (file) => shell.trashItem(file),
});
const graphicsManager = graphicsPackages.create({
  gameDir: () => store.get('settings').gameInstallDir,
  cacheDir: () => path.join(app.getPath('userData'), 'graphics-packages'),
  records: () => store.get('installs') || {}, save: (records) => store.set('installs', records),
  trash: (file) => shell.trashItem(file), isGameRunning: () => profile.isGameRunning(),
});
let lastScan = { items: [] };
const jobs = new Map();
const browserJobs = new Map(); // webContents id -> job id
const shopDownloads = new Map(); // product page behind a shop popup's downloads

// ---------- paths ----------
function userDir() { return store.get('settings').gameUserDir; }
// Test-only: read/write profiles from a copy instead of the real game folder.
function profUserDir() { return process.env.MXB_PROFILES_ROOT || userDir(); }
function modsDir() { return path.join(userDir(), 'mods'); }
function disabledDir() { return path.join(userDir(), 'mods_disabled (MX Bikes Manager)'); }
let discoveryInstall = null;
async function ensureDiscoveryPlugin() {
  if (discoveryInstall) return discoveryInstall;
  discoveryInstall = (async () => {
    const settings = store.get('settings');
    const gameRunning = await profile.isGameRunning();
    await frostmod.cleanup(settings.gameInstallDir, userDir(), { all: !gameRunning });
    if (settings.frostmodAutoInstall === false || !settings.gameInstallDir || gameRunning) return;
    const result = await frostmod.installBundled(app.isPackaged ? process.resourcesPath : __dirname, settings.gameInstallDir);
    if (result.version && result.version !== settings.frostmodVersion) store.update('settings', (s) => ({ ...s, frostmodVersion: result.version }));
    if (result.installed) { watchFrostList(); send('frostmod:list', {}); }
  })();
  try { return await discoveryInstall; } finally { discoveryInstall = null; }
}
const serverNameKey = (name) => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
// The official game plugin does not receive an IP:port. Enrich live server
// names from addresses the player saved or FrostMod saw, never by guessing.
async function knownServerAddresses() {
  const known = [...(store.get('servers') || [])];
  let latest = null;
  for (const file of frostmod.listCandidates(store.get('settings').gameInstallDir, userDir())) {
    try {
      if ((await fsp.stat(file)).size > 512 * 1024) continue;
      const parsed = frostmod.parse(await fsp.readFile(file, 'utf8'));
      if (parsed && (!latest || parsed.at > latest.at)) latest = parsed;
    } catch {}
  }
  if (latest && latest.at <= Date.now() + 60000 && Date.now() - latest.at < 6 * 3600 * 1000) known.push(...latest.servers);
  const out = new Map();
  for (const server of known) {
    const key = serverNameKey(server.name), address = String(server.address || '');
    if (!key || !game.validAddress(address)) continue;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key).add(address);
  }
  return out;
}
async function addKnownServerAddresses(rows) {
  const addresses = await knownServerAddresses();
  return rows.map((row) => {
    if (row.address || !row.name) return row;
    const matches = [...(addresses.get(serverNameKey(row.name)) || [])];
    return matches.length === 1 ? { ...row, address: matches[0] } : row;
  });
}
function rootFor(disabled) { return disabled ? disabledDir() : modsDir(); }
function insideRoots(p) {
  const n = path.resolve(p).toLowerCase();
  return [modsDir(), disabledDir()].some((r) => n === path.resolve(r).toLowerCase() || n.startsWith(path.resolve(r).toLowerCase() + path.sep));
}
// Strictly below a root: never the mods or disabled folder itself (used before deleting).
function insideRootsStrict(p) {
  const n = path.resolve(p).toLowerCase();
  return [modsDir(), disabledDir()].some((r) => n.startsWith(path.resolve(r).toLowerCase() + path.sep));
}
function send(ch, payload) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, payload); }

function initSettings() {
  const s = store.get('settings') || {};
  if (process.env.MXB_USER_DIR) s.gameUserDir = process.env.MXB_USER_DIR;
  else if (!s.gameUserDir || !fs.existsSync(s.gameUserDir)) s.gameUserDir = paths.detectGameUserDir(app.getPath('documents'));
  if (!s.gameInstallDir || !fs.existsSync(s.gameInstallDir)) s.gameInstallDir = paths.detectGameInstallDir();
  if (s.autoInstall === undefined) s.autoInstall = true;
  store.set('settings', s);
}

function environment() {
  const s = store.get('settings');
  const t = archive.tools(s);
  return {
    settings: s,
    modsDir: modsDir(),
    disabledDir: disabledDir(),
    modsFound: fs.existsSync(modsDir()),
    gameExe: paths.findGameExe(s.gameInstallDir),
    tools: { sevenZip: t.sevenZip, unrar: t.unrar, tar: t.tar },
    version: app.getVersion(),
  };
}

// ---------- library ----------
function installedFileIndex() {
  const idx = [];
  for (const rec of Object.values(store.get('installs')).sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0))) for (const f of rec.files || []) idx.push([f.toLowerCase(), rec]);
  return idx;
}

function decorate(items) {
  const images = store.get('images');
  const favs = new Set(store.get('favorites'));
  const idx = installedFileIndex();
  for (const it of items) {
    it.customImage = !!images[it.key.toLowerCase()];
    it.favorite = favs.has(it.key.toLowerCase());
    for (const part of it.parts) {
      const p = part.toLowerCase();
      const hit = idx.find(([f]) => require('./src/lib/install-image').ownsInstallFile(p, f));
      if (hit) { it.post = { id: hit[1].postId, title: hit[1].title, link: hit[1].link, image: hit[1].image, installedAt: hit[1].installedAt }; break; }
    }
    it.hasImage = it.customImage || !!(it.post && it.post.image) || !!(it.info && it.info.pic);
  }
  return items;
}

async function scan() {
  const r = await scanner.scanAll(modsDir(), disabledDir(), store.get('settings').gameInstallDir);
  lastScan = { items: decorate(r.items), ms: r.ms, at: Date.now() };
  return lastScan;
}

let gearRepair = null;
async function repairGearFolders() {
  if (gearRepair) return gearRepair;
  gearRepair = (async () => {
    if (await profile.isGameRunning()) throw new Error('Close MX Bikes before repairing gear folders');
    const result = await riderLayout.repair(modsDir(), (file) => shell.trashItem(file));
    const changed = (key) => result.changes.get(key) || key;
    if (result.changes.size) {
      store.update('installs', (all) => Object.fromEntries(Object.entries(all || {}).map(([key, rec]) => [key, { ...rec, files: (rec.files || []).map(changed) }])));
      const cfg = store.get('online') || {};
      store.set('online', { ...cfg, received: Object.fromEntries(Object.entries(cfg.received || {}).map(([key, value]) => [changed(key), value])) });
      const movedKey = (key) => { const dest = riderLayout.canonical(key); return dest !== key && !fs.existsSync(path.join(modsDir(), key)) && fs.existsSync(path.join(modsDir(), dest)) ? dest : key; };
      store.update('images', (all) => Object.fromEntries(Object.entries(all || {}).map(([key, value]) => [movedKey(key), value])));
      store.update('favorites', (all) => (all || []).map(movedKey));
      for (const j of jobs.values()) if (j.installed) j.installed = j.installed.map(changed);
      store.flush();
    }
    return { moved: result.changes.size, conflicts: result.conflicts };
  })();
  try { return await gearRepair; } finally { gearRepair = null; }
}

function findItem(id) { return lastScan.items.find((i) => i.id === id); }

async function moveSafe(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) {
    const result = await mergeMove(from, to, (file) => shell.trashItem(file));
    if (result.conflicts.length) throw new Error(`Kept different existing files: ${result.conflicts.slice(0, 2).join(', ')}`);
    return;
  }
  try { await fsp.rename(from, to); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(from, to, { recursive: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

async function setEnabled(ids, enable) {
  const errors = [];
  for (const id of ids) {
    const it = findItem(id);
    if (!it || it.disabled !== enable) continue;
    for (const part of it.parts) {
      try { await moveSafe(path.join(rootFor(it.disabled), part), path.join(rootFor(!enable), part)); }
      catch (e) { errors.push(`${it.title}: ${e.message}`); }
    }
  }
  await pruneEmptyDirs(disabledDir());
  return { errors };
}

async function pruneEmptyDirs(dir) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) if (e.isDirectory()) await pruneEmptyDirs(path.join(dir, e.name));
  try { if (!(await fsp.readdir(dir)).length && dir !== disabledDir()) await fsp.rmdir(dir); } catch {}
}

async function trash(ids) {
  const errors = [];
  for (const id of ids) {
    const it = findItem(id);
    if (!it) continue;
    if (it.group === 'rider' && it.sub === 'riders') {
      try { await deleteRiderModel(it.name, it.disabled); } catch (e) { errors.push(`${it.title}: ${e.message}`); }
      continue;
    }
    for (const part of it.parts) {
      const abs = path.join(rootFor(it.disabled), part);
      if (!part || !insideRootsStrict(abs)) { errors.push(`${it.title}: unsafe path skipped`); continue; }
      try { await shell.trashItem(abs); } catch (e) { errors.push(`${it.title}: ${e.message}`); }
    }
  }
  await reconcileInstallRecords();
  send('library:changed', {});
  return { errors };
}

async function reconcileInstallRecords() {
  const records = require('./src/lib/install-records');
  const before = store.get('installs');
  const missing = await records.missingFiles(Object.fromEntries(Object.entries(before).filter(([key]) => !bikeSwaps.hasRecord(key))), { modsDir: modsDir(), disabledDir: disabledDir() });
  if (!missing.size) return;
  store.update('installs', (current) => {
    const eligible = Object.fromEntries(Object.entries(current).filter(([id, record]) => record === before[id] && !bikeSwaps.hasRecord(id)));
    const kept = records.prune(eligible, missing);
    return Object.fromEntries(Object.entries(current).flatMap(([id, record]) => record !== before[id] || bikeSwaps.hasRecord(id) ? [[id, record]] : kept[id] ? [[id, kept[id]]] : []));
  });
  for (const job of jobs.values()) if (job.status === 'done' && job.installed?.length) {
    if (bikeSwaps.hasRecord(installKey(job, job.installed))) continue;
    const remaining = job.installed.filter((file) => !missing.has(records.key(file)));
    if (remaining.length === job.installed.length) continue;
    job.installed = remaining;
    if (!remaining.length) { job.filesDeleted = true; job.status = 'error'; job.error = null; job.note = 'Installed files removed'; }
    emitJob(job);
  }
}

async function deleteRiderModel(model, disabled = false) {
  if (!model || /[\\/]|^\.+$/.test(model) || /^(default|default_mx|default_sm)$/i.test(model)) throw new Error('Built-in rider models cannot be deleted');
  if (await profile.isGameRunning()) throw new Error('Close MX Bikes before deleting a rider model');
  const base = path.join(rootFor(disabled), 'rider', 'riders', model);
  const files = [base, base + '.pkz'].filter((p) => fs.existsSync(p));
  if (!files.length) throw new Error('Custom rider model not found');
  for (const name of (await profile.listProfiles(profUserDir())).profiles) {
    const prof = await profile.readProfile(profUserDir(), name);
    const values = Object.entries((prof.sections.rider || {}).values || {}).filter(([, v]) => v === model)
      .flatMap(([bike]) => [['rider', bike, 'default_mx'], ['suit_paint', bike, ''], ['gloves_paint', bike, '']]);
    if (values.length) await profile.writeValues(profUserDir(), name, values);
  }
  for (const file of files) await shell.trashItem(file);
  return { ok: true };
}

// ---------- image protocol ----------
function placeholder404() { return new Response('', { status: 404 }); }

async function handleImage(request) {
  const u = new URL(request.url);
  try {
    if (u.hostname === 'item') {
      const key = (u.searchParams.get('key') || '').toLowerCase();
      const custom = store.get('images')[key];
      if (custom && fs.existsSync(custom)) return net.fetch(pathToFileURL(custom).toString());
      const postImg = u.searchParams.get('post');
      if (postImg) {
        const f = await thumbs.fromUrl(postImg).catch(() => null);
        if (f) return net.fetch(pathToFileURL(f).toString());
      }
      const abs = u.searchParams.get('p');
      const pic = u.searchParams.get('pic');
      if (abs && pic && (insideRoots(abs) || insideGame(abs))) {
        const f = await thumbs.fromMod(abs, pic);
        return net.fetch(pathToFileURL(f).toString());
      }
    }
  } catch { /* fall through */ }
  return placeholder404();
}

// ---------- jobs: download -> stage -> plan -> install ----------
function jobView(j) {
  const p = j.plan;
  return {
    id: j.id, title: j.title, postId: j.postId, url: j.url, link: j.link, image: j.image, status: j.status, error: j.error,
    received: j.received, total: j.total, note: j.note, fileName: j.file ? path.basename(j.file) : null,
    createdAt: j.createdAt, completedAt: j.completedAt, relocateKey: j.relocateKey, equipCandidates: j.equipCandidates, installed: j.installed, filesDeleted: !!j.filesDeleted, modelWarningAccepted: !!j.modelWarningAccepted,
    plan: p && {
      kind: p.kind, kindLabel: p.kindLabel, base: p.base, askType: p.askType, kindHint: p.kindHint, detectReason: p.detectReason, options: p.options, paintModels: p.paintModels,
      paintModelsBase: p.paintModelsBase, paintGuess: p.paintGuess, counts: p.counts, installable: p.installable, bikeCompatibility: p.bikeCompatibility,
      paintModelInfo: p.paintModelsBase === 'bikes' ? p.paintModels.map((name) => ({ name, brand: scanner.detectBrand(name), cc: scanner.detectCC(name), bikeClass: scanner.detectClass(name) })) : [],
      warnings: p.warnings, confident: p.confident, kinds: p.kinds, trackTypes: p.trackTypes,
      requiredModels: p.requiredModels, dependencies: p.dependencies, needsPaintTarget: p.needsPaintTarget, riderModels: p.riderModels, needsRiderTarget: p.needsRiderTarget, requiresModelWarning: p.requiresModelWarning,
      entries: p.entries.slice(0, 500).map((e) => ({ rel: e.rel, dest: e.dest, status: e.status, size: e.size, bikeMatch: e.bikeMatch })),
      totalEntries: p.entries.length,
    },
  };
}
function emitJob(j) { if (['done', 'error'].includes(j.status)) { j.completedAt = j.completedAt || Date.now(); recentInstalls.pruneHistory(jobs); } send('jobs:update', jobView(j)); }

function newJob(fields) {
  const id = crypto.randomUUID();
  const stageDir = path.join(app.getPath('userData'), 'staging', id);
  const j = { id, status: 'queued', received: 0, total: 0, createdAt: Date.now(), stageDir, abort: new AbortController(), ...fields };
  jobs.set(id, j);
  emitJob(j);
  return j;
}

async function runDownload(j) {
  j.completedAt = null;
  j.status = 'downloading'; emitJob(j);
  try {
    const file = await hosts.download(j.url, path.join(j.stageDir, 'dl'), ses, (r, t) => { j.received = r; j.total = t; emitJob(j); }, j.abort.signal);
    await afterDownload(j, file);
  } catch (e) {
    if (e.needsBrowser) return openBrowserFor(j, e.url, e.message);
    fail(j, e);
  }
}

function fail(j, e) {
  if (e.rollbackFailed) j.rollbackRecovery = true;
  j.status = 'error'; j.error = e.message || String(e); emitJob(j);
  cleanupStage(j);
}

async function afterDownload(j, file) {
  if (j.abort.signal.aborted) { fail(j, new Error('Cancelled')); return; }
  j.file = file;
  j.status = 'extracting'; emitJob(j);
  try {
    j.files = await archive.stage(file, j.stageDir, store.get('settings'));
    j.ctx = {
      modsDir: modsDir(), installDir: store.get('settings').gameInstallDir, categories: j.categories || [], categoryNames: j.categoryNames || [], title: j.title,
      reinstall: !!(j.postId && store.get('installs')[j.postId]), dependencies: j.dependencies || [],
    };
    if (!j.ctx.categories.length) {
      // Uploaded from the computer: no site category, so look inside the files.
      const d = await detectKind(j.files);
      j.ctx.local = !j.postId;
      j.ctx.kindHint = d.kind;
      j.ctx.detectReason = d.reason;
    }
    const inspected = await paintCompat.inspect(j.files, modsDir(), stockRiderPkz(), j.opts?.kind || j.ctx.kindHint || installer.kindFromCategories(j.ctx.categories));
    Object.assign(j.ctx, inspected, { dependencies: [...(j.dependencies || []), ...inspected.dependencies] });
    if (!j.ctx.categories.length && !j.ctx.kindHint && inspected.knownBodyPaintFiles.length && inspected.knownBodyPaintFiles.length === j.files.filter((f) => /\.pnt$/i.test(f.rel)).length) { j.ctx.kindHint = 'riderKit'; j.ctx.detectReason = 'paint-textures'; }
    if (j.abort.signal.aborted) throw new Error('Cancelled');
    j.plan = installer.plan(j.files, j.ctx, j.opts || {});
    if (j.plan.requiresModelWarning) j.requireReview = true;
    // Already have exactly these files? Don't install a second copy.
    const placed = j.plan.entries.filter((e) => e.dest);
    const targetRoot = j.plan.root === 'game' ? store.get('settings').gameInstallDir : modsDir();
    if (j.plan.kind !== 'bikeSwap' && j.plan.root !== 'game' && !j.plan.counts.unresolved && await filesMatch(placed, targetRoot)) {
      if (j.abort.signal.aborted) throw new Error('Cancelled');
      recordInstall(j, placed.map((e) => (j.plan.root === 'game' ? 'game:' : '') + e.dest));
      j.status = 'done'; j.installed = []; j.note = 'Already installed — you have these exact files, nothing was changed.';
      await recycleSourceArchive(j);
      emitJob(j); cleanupStage(j); send('library:changed', {});
      return;
    }
    if (store.get('settings').autoInstall && j.plan.confident && !j.requireReview) return doInstall(j, j.opts || {});
    j.status = 'review'; emitJob(j);
    send('jobs:review', j.id);
  } catch (e) { fail(j, e); }
}

async function doInstall(j, opts) {
  try {
    j.status = 'installing'; emitJob(j);
    j.plan = installer.plan(j.files, j.ctx, opts);
    if (j.plan.kind === 'bikeSwap') {
      if (j.plan.counts.unresolved || !j.plan.installable) throw new Error('Choose the exact base bike for this model swap first.');
      const visualEntries = [...require('./src/lib/bike-swaps').groups(j.plan).values()].flat();
      if (!visualEntries.some((e) => /\.edf$/i.test(e.dest))) throw new Error('No unpacked bike model was found. This package needs creator-specific installation instructions.');
      const written = visualEntries.map((e) => e.dest), key = installKey(j, written);
      await require('./src/lib/assetread').withLocalPreview(() => require('./src/lib/bike-swaps').validateReferences(j.plan, modsDir()));
      await bikeSwaps.install(j.plan, { title: j.title, link: j.link, recordKey: key }, j.abort.signal);
      const paintPlan = { ...j.plan, entries: j.plan.entries.filter((e) => e.dest && /\.pnt$/i.test(e.dest)) };
      if (paintPlan.entries.length) written.push(...await installer.apply(paintPlan, modsDir(), { signal: j.abort.signal, rollbackDir: path.join(j.stageDir, 'rollback') }));
      recordInstall(j, written);
      j.installed = written; j.status = 'done'; j.note = 'Model swap installed. Select it under Rider → Bike → Appearance, then Apply.';
      emitJob(j); cleanupStage(j); send('library:changed', {}); return;
    }
    if (j.relocateKey) {
      if (await profile.isGameRunning()) throw new Error('Close MX Bikes before moving installed files');
      if (j.plan.root === 'game') throw new Error('Graphics packages stay in the game folder; manage them in Graphics');
      if (!j.plan.installable || j.plan.needsPaintTarget || j.plan.needsRiderTarget || j.plan.bikeCompatibility?.blocked) throw new Error('Choose a compatible destination first');
      const changes = await recentInstalls.relocatePlan(j.plan, modsDir(), j.abort.signal);
      store.update('installs', (all) => Object.fromEntries(Object.entries(all).map(([key, rec]) => [key, { ...rec, ...(key === j.relocateKey ? { kind: j.plan.kind, installOptions: j.plan.options } : {}), files: rec.files.map((rel) => changes.get(rel) || rel) }])));
      for (const other of jobs.values()) if (other.installed) other.installed = other.installed.map((rel) => changes.get(rel) || rel);
      j.status = 'done'; j.note = `Moved ${changes.size} installed files`; j.installed = []; emitJob(j); cleanupStage(j); await scan(); send('library:changed', {}); return;
    }
    const applyAndRecord = async () => {
      const written = (await installer.apply(j.plan, j.plan.root === 'game' ? store.get('settings').gameInstallDir : modsDir(), { signal: j.abort.signal, rollbackDir: path.join(j.stageDir, 'rollback') })).map((w) => (j.plan.root === 'game' ? 'game:' : '') + w);
      if (!written.length) throw new Error('Nothing was installed: no file had a destination.');
      recordInstall(j, written);
      j.installed = written; j.equipCandidates = await equipInstalled.choicesFromFiles(written, modsDir());
      j.status = 'done'; j.note = `Installed ${installSummary.summary(written)}`; emitJob(j);
      return written;
    };
    const written = j.plan.root === 'game' ? await graphicsManager.install(j.plan, installKey(j, j.plan.entries.filter((e) => e.dest).map((e) => 'game:' + e.dest)), applyAndRecord) : await applyAndRecord();
    j.installed = written;
    if (j.sourceArchive) {
      const entries = j.plan.entries.filter((e) => written.includes((j.plan.root === 'game' ? 'game:' : '') + e.dest));
      j.sourceVerified = !j.plan.counts.unresolved && await filesMatch(entries, j.plan.root === 'game' ? store.get('settings').gameInstallDir : modsDir());
    }
    const dirs = [...new Set(written.map((w) => path.posix.dirname(w)))];
    j.status = 'done'; j.note = `Installed ${installSummary.summary(written)}${dirs.length === 1 ? ` to ${j.plan.root === 'game' ? 'game' : 'mods'}/${dirs[0]}` : ` across ${dirs.length} folders`}`;
    await recycleSourceArchive(j);
    emitJob(j);
    cleanupStage(j);
    send('library:changed', {});
  } catch (e) { fail(j, e); }
}

function installKey(j, written) { return j.postId ? String(j.postId) : j.shopKey || 'local:' + crypto.createHash('sha1').update(j.title + written[0]).digest('hex').slice(0, 12); }
function recordInstall(j, written) {
  const key = installKey(j, written);
  store.update('installs', (all) => {
    const prev = all[key];
    all[key] = {
      postId: j.postId || null, shopKey: j.shopKey || null, title: j.title, link: j.link || null, image: j.image || null,
      categories: j.categories || [], siteModified: j.modified || null, installedAt: Date.now(),
      downloads: { ...(prev?.downloads || {}), ...((j.url || j.source) ? { [j.url || j.source]: written } : {}) },
      source: j.url || j.file, kind: j.plan && j.plan.kind, installOptions: j.plan?.options, graphicsActive: j.plan?.root === 'game' ? true : undefined, files: Array.from(new Set([...(prev && j.plan?.root !== 'game' ? prev.files : []), ...written])),
    };
    return all;
  });
}

function cleanupStage(j) {
  if (j.rollbackRecovery) return;
  const staging = path.resolve(app.getPath('userData'), 'staging');
  const target = path.resolve(j.stageDir);
  if (target.startsWith(staging + path.sep)) j.cleaning = fsp.rm(target, { recursive: true, force: true }).catch(() => {});
  j.files = null;
}

async function recycleSourceArchive(j) {
  const source = j.sourceArchive;
  if (!source || !insideRoots(source) || !/\.(zip|rar|7z)$/i.test(source) || !fs.existsSync(source)) return;
  if (j.installed?.length && !j.sourceVerified) { j.note += ' Original archive retained because not all its contents were verified.'; return; }
  try { await shell.trashItem(source); j.sourceArchive = null; j.note += ' Original archive moved to the Recycle Bin.'; }
  catch { j.note += ' The original archive could not be moved to the Recycle Bin.'; }
}

function openBrowserFor(j, url, reason) {
  j.status = 'browser';
  j.note = `${reason} A browser window opened — click the download button there and it will install automatically.`;
  emitJob(j);
  const win = new BrowserWindow({
    width: 1150, height: 820, parent: mainWin, autoHideMenuBar: true, backgroundColor: '#111',
    title: `Download: ${j.title} — the file will install automatically`,
    webPreferences: { partition: 'persist:mxb', contextIsolation: true, sandbox: true },
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  const browserContentsId = win.webContents.id;
  browserJobs.set(browserContentsId, j.id);
  j.browserWin = win;
  win.webContents.setWindowOpenHandler(({ url: next }) => {
    // Hosts often open the real file in a popup; keep it in this window if it looks like a file/host.
    if (/\.(pkz|zip|rar|7z|pnt)(\?|$)|mega\.nz|mediafire\.com|drive\.google|googleusercontent|dropbox|github\.com|mxb-mods\.com/i.test(next)) win.loadURL(next);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    browserJobs.delete(browserContentsId);
    if (j.browserWin === win) j.browserWin = null;
    if (['browser', 'downloading'].includes(j.status)) { j.abort.abort(); j.browserDownload?.cancel(); fail(j, new Error('Cancelled')); }
  });
  win.loadURL(url);
}

// Tell the window when FrostMod writes a new server list (each time the in-game browser refreshes).
const frostWatched = new Set();
function watchFrostList() {
  for (const p of frostmod.listCandidates(store.get('settings').gameInstallDir, userDir())) {
    if (frostWatched.has(p)) continue;
    frostWatched.add(p);
    fs.watchFile(p, { interval: 3000 }, (cur, prev) => {
      if (cur.mtimeMs !== prev.mtimeMs) {
        send('frostmod:list', {});
        online?.refresh().catch(() => {});
      }
    });
  }
}

// mxb-ranked server details only appear after clicking the site's interactive "Details" button.
// Load the page in a hidden window, click it for the user, and read the dialog that opens.
let rankedWin = null;
async function rankedServerDetails(name) {
  if (!rankedWin || rankedWin.isDestroyed()) {
    rankedWin = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { partition: 'persist:mxb', contextIsolation: true, sandbox: true } });
  }
  const wc = rankedWin.webContents;
  await rankedWin.loadURL('https://mxb-ranked.com/Multiplayer');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = (js) => wc.executeJavaScript(js, true);
  // wait for the interactive page to come alive and the cards to render
  for (let i = 0; i < 40; i++) {
    const ok = await run(`[...document.querySelectorAll('h5')].some(h => h.textContent.trim() === ${JSON.stringify(name)}) && !!window.Blazor`);
    if (ok) break;
    await wait(250);
  }
  await wait(800);
  const before = await run(`document.body.innerText`);
  const beforeImgs = await run(`[...document.images].map(i => i.src)`);
  const clicked = await run(`(() => {
    const h = [...document.querySelectorAll('h5')].find(h => h.textContent.trim() === ${JSON.stringify(name)});
    if (!h) return false;
    const card = h.closest('.mud-paper');
    const btn = [...card.querySelectorAll('button')].find(b => /Details/i.test(b.textContent));
    if (!btn) return false; btn.click(); return true; })()`);
  if (!clicked) throw new Error("Couldn't find that server on mxb-ranked");
  let after = before;
  for (let i = 0; i < 40; i++) {
    after = await run(`document.body.innerText`);
    if (after !== before) break;
    await wait(250);
  }
  await wait(1500);
  const raw = await run(`(() => {
    const main = document.querySelector('.mud-main-content') || document.body;
    const beforeImgs = new Set(${JSON.stringify(beforeImgs)});
    return {
      lines: main.innerText.split(String.fromCharCode(10)).map(l => l.trim()).filter(Boolean),
      imgs: [...main.querySelectorAll('img')].map(i => i.src).filter(s => !beforeImgs.has(s)),
    }; })()`);
  // The details view starts after the site's BACK button
  const start = raw.lines.findIndex((l) => l === 'BACK');
  const lines = start >= 0 ? raw.lines.slice(start + 1) : raw.lines;
  const details = ranked.parseDetails(lines, raw.imgs);
  const addresses = await knownServerAddresses();
  for (const lobby of details.lobbies) {
    if (lobby.address) continue;
    const fullName = `MXB-Ranked.com | ${name} | ${lobby.region} | #${lobby.id}`;
    const matches = [...(addresses.get(serverNameKey(fullName)) || [])];
    if (matches.length === 1) lobby.address = matches[0];
  }
  return { name, ...details, lines: lines.slice(0, 200) };
}

// Opens the shop's own login page in an app window; resolves once the site sets its signed-in cookie.
function signInWindow(id) {
  const shop = shops.SHOPS[id];
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000, height: 820, parent: mainWin, modal: false, autoHideMenuBar: true, backgroundColor: '#111',
      title: `Sign in to ${shop.name}`, webPreferences: { partition: 'persist:mxb', contextIsolation: true, sandbox: true },
    });
    win.on('page-title-updated', (e) => e.preventDefault());
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      ses.cookies.removeListener('changed', onCookie);
      const acct = await shops.account(ses, id);
      if (!win.isDestroyed()) win.close();
      send('shops:changed', { id });
      resolve(acct);
    };
    const onCookie = (_e, cookie, _cause, removed) => {
      if (!removed && cookie.name.startsWith('wordpress_logged_in_') && cookie.domain.includes(shop.domain)) setTimeout(finish, 900);
    };
    ses.cookies.on('changed', onCookie);
    win.on('closed', finish);
    win.webContents.setWindowOpenHandler(({ url }) => { win.loadURL(url); return { action: 'deny' }; });
    win.loadURL(shop.loginUrl);
  });
}

function setupDownloadsSession() {
  ses = session.fromPartition('persist:mxb');
  ses.setUserAgent(site.UA.replace(' MXBikesManager/1.0', ''));
  ses.on('will-download', (event, item, wc) => {
    const jobId = wc && browserJobs.get(wc.id);
    let j = jobId && jobs.get(jobId);
    if (!j) {
      // A download started in a shop/sign-in window (e.g. right after buying): install it too.
      const product = wc && shopDownloads.get(wc.id);
      j = newJob({ title: item.getFilename().replace(/\.[^.]+$/, ''), url: null, ...(product ? { link: product.link, shopKey: product.link } : {}) });
      send('jobs:started', j.id);
    }
    const dir = path.join(j.stageDir, 'dl');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, hosts.safeName(item.getFilename()));
    j.file = file;
    j.browserDownload = item;
    item.setSavePath(file);
    j.status = 'downloading'; j.note = 'Downloading from browser…'; emitJob(j);
    item.on('updated', () => { j.received = item.getReceivedBytes(); j.total = item.getTotalBytes(); emitJob(j); });
    item.once('done', (_e, state) => {
      if (j.browserWin && !j.browserWin.isDestroyed()) { j.status = 'extracting'; j.browserWin.close(); }
      if (state === 'completed' && !j.abort.signal.aborted) afterDownload(j, file);
      else fail(j, new Error(j.abort.signal.aborted ? 'Cancelled' : `Browser download ${state}`));
    });
  });
}

// ---------- IPC ----------
function handle(ch, fn) { ipcMain.handle(ch, async (_e, ...args) => fn(...args)); }

function registerIpc() {
  handle('app:env', () => environment());
  handle('app:updates', () => updates?.status() || { phase: 'idle', current: app.getVersion() });
  handle('app:checkUpdates', () => updates?.check());
  handle('app:downloadUpdate', () => updates?.download());
  handle('app:installUpdate', () => {
    if ([...jobs.values()].some((j) => !['done', 'error'].includes(j.status))) throw new Error('Finish or cancel your mod downloads and installs before restarting to update.');
    store.flush(); updates?.install();
  });
  handle('settings:set', (patch) => {
    store.update('settings', (s) => ({ ...s, ...patch }));
    return environment();
  });
  handle('settings:pickFolder', async (which) => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'], title: which === 'install' ? 'Select the MX Bikes game folder (contains mxbikes.exe)' : 'Select the "MX Bikes" folder in Documents\\PiBoSo' });
    if (r.canceled || !r.filePaths[0]) return environment();
    let dir = r.filePaths[0];
    if (which === 'user' && path.basename(dir).toLowerCase() === 'mods') dir = path.dirname(dir);
    store.update('settings', (s) => ({ ...s, [which === 'install' ? 'gameInstallDir' : 'gameUserDir']: dir }));
    return environment();
  });
  handle('settings:redetect', () => {
    store.update('settings', (s) => ({ ...s, gameUserDir: paths.detectGameUserDir(app.getPath('documents')), gameInstallDir: paths.detectGameInstallDir() }));
    return environment();
  });

  handle('library:scan', () => scan());
  handle('library:enable', async (ids, enable) => { const r = await setEnabled(ids, enable); await scan(); return r; });
  handle('library:trash', async (ids) => { const r = await trash(ids); await scan(); return r; });
  handle('library:reveal', (id) => { const it = findItem(id); if (it) shell.showItemInFolder(path.join(rootFor(it.disabled), it.parts[0])); });
  handle('library:favorite', (key, on) => {
    store.update('favorites', (f) => { const s = new Set(f); on ? s.add(key.toLowerCase()) : s.delete(key.toLowerCase()); return [...s]; });
  });
  handle('library:pickImage', async (key) => {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Choose an image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tga', 'bmp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return false;
    const out = await thumbs.fromFile(r.filePaths[0], key);
    store.update('images', (m) => ({ ...m, [key.toLowerCase()]: out }));
    return true;
  });
  handle('library:setImageUrl', async (key, url) => {
    const out = await thumbs.fromUrl(url, 960);
    store.update('images', (m) => ({ ...m, [key.toLowerCase()]: out }));
    return true;
  });
  handle('library:clearImage', (key) => store.update('images', (m) => { const n = { ...m }; delete n[key.toLowerCase()]; return n; }));
  handle('library:paints', async (id) => {
    const it = findItem(id);
    if (!it) return [];
    const dirPart = it.parts.find((p) => !/\.(pkz|pnt|zip|rar|7z)$/i.test(p));
    if (!dirPart) return [];
    const out = [];
    for (const sub of ['paints', 'goggles']) {
      const d = path.join(rootFor(it.disabled), dirPart, sub);
      try {
        for (const n of await fsp.readdir(d)) {
          if (!/\.pnt$/i.test(n)) continue;
          const st = await fsp.stat(path.join(d, n));
          out.push({ name: n.slice(0, -4), sub, size: st.size, path: path.join(d, n) });
        }
      } catch {}
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });
  handle('library:trashFile', async (p) => {
    if (typeof p !== 'string' || !insideRootsStrict(p)) throw new Error('Not in the mods folder');
    await shell.trashItem(p);
    await reconcileInstallRecords(); await scan(); send('library:changed', {});
  });
  handle('library:showFile', (p) => { if (insideRoots(p)) shell.showItemInFolder(p); });
  handle('library:installLocal', async (id) => {
    const it = findItem(id);
    if (!it) return null;
    const file = path.join(rootFor(it.disabled), it.parts[0]);
    const j = newJob({ title: it.name, file, sourceArchive: file, categories: it.group === 'tracks' ? [22] : [], opts: it.group === 'tracks' && it.sub !== '(loose)' ? { kind: 'track', trackType: it.sub } : {} });
    afterDownload(j, file);
    return j.id;
  });

  handle('site:tabs', () => site.BROWSE_TABS.map(({ id, label }) => ({ id, label })));
  handle('site:search', async (q) => {
    if (!['free', 'addons'].includes(q?.scope)) return site.search(q);
    const [legacy, community] = await Promise.allSettled([site.search(q), coremx.search(q)]);
    if (q.orderby?.startsWith('popular') && legacy.status === 'rejected') throw legacy.reason;
    if (legacy.status === 'rejected' && (community.status === 'rejected' || !community.value.posts.length)) throw legacy.reason;
    const a = legacy.status === 'fulfilled' ? legacy.value : { posts: [], total: 0, page: q.page || 1, totalPages: 1 };
    const b = community.status === 'fulfilled' ? community.value : { posts: [], total: 0, totalPages: 1 };
    return { ...a, posts: mergeBrowsePosts(a.posts, b.posts, q.orderby, q.query), total: a.total + b.total, totalPages: Math.max(a.totalPages, b.totalPages), communityError: community.status === 'rejected' ? community.reason.message : null };
  });
  handle('site:findDependency', async (dependency) => {
    const label = String(dependency?.label || '').trim().slice(0, 120);
    if (!label) return [];
    const kind = dependencyModelKind(dependency);
    const tab = ({ boots: 'boots', helmets: 'helmets', protections: 'protection' })[kind] || 'all';
    const requests = [
      site.search({ query: label, tab, perPage: 12, orderby: 'relevance' }).then((r) => r.posts.map((p) => ({ ...p, source: 'mxb-mods' }))).catch(() => []),
      shops.search(ses, { shop: 'hub', query: label, page: 1 }).then((r) => r.products.map((p) => ({ ...p, source: 'hub' }))).catch(() => []),
      shops.search(ses, { shop: 'mxbs', query: label, page: 1 }).then((r) => r.products.map((p) => ({ ...p, source: 'mxbs' }))).catch(() => []),
    ];
    const sets = await Promise.all(requests);
    return sets.flat().map((item) => ({ ...item, dependencyScore: dependencySearchScore(item, dependency) }))
      .filter((item) => item.dependencyScore > 0).sort((a, b) => b.dependencyScore - a.dependencyScore).slice(0, 6);
  });
  handle('library:imageCandidates', async ({ query, tab = 'all', source = 'all' }) => {
    query = String(query || '').trim().slice(0, 200);
    if (!query) return { posts: [] };
    const search = async (term) => {
    const requests = [];
    if (source === 'all' || source === 'free') requests.push(site.search({ query: term, tab, perPage: 24, orderby: 'relevance' }).then((r) => r.posts.map((p) => ({ ...p, source: 'mxb-mods' }))));
    for (const id of ['mxbs', 'hub']) if (source === 'all' || source === id) {
      requests.push(shops.search(ses, { shop: id, query: term, cat: id === 'mxbs' && tab === 'tracks' ? 248 : 0 }).then((r) => r.products.map((p) => ({ ...p, categories: p.categories || [], source: shops.SHOPS[id].name }))));
    }
    const results = await Promise.allSettled(requests);
    const posts = results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
    if (!posts.length && results.every((r) => r.status === 'rejected')) throw new Error('Image sources could not be reached. Try again later.');
    return posts;
    };
    let posts = imageMatch.rankImages(query, await search(query));
    const broad = imageMatch.broadQuery(query);
    if (!posts.some((p) => p.matchReliable) && broad.length >= 4 && broad.toLowerCase() !== query.toLowerCase()) {
      posts = imageMatch.rankImages(query, [...posts, ...await search(broad).catch(() => [])]);
    }
    const seen = new Set();
    return { posts: posts.filter((p) => !seen.has(p.image) && seen.add(p.image)) };
  });
  handle('site:resolvePost', async (address) => {
    const url = new URL(address);
    if (!/^https?:$/.test(url.protocol) || !/^(www\.)?mxb-mods\.com$/i.test(url.hostname) || !/^\/[^/]+\/?$/.test(url.pathname)) throw new Error('This is not an MXB Mods listing.');
    const post = await site.postBySlug(url.pathname.replace(/^\/|\/$/g, ''));
    if (!post) throw new Error('That model listing could not be found.');
    return post;
  });
  handle('site:post', async (id) => {
    const post = typeof id === 'string' && id.startsWith('coremx:') ? await coremx.post(id) : id < 0 ? await coremx.post(-id) : await site.post(id), rec = store.get('installs')[id];
    post.installKind = installer.kindFromCategories(post.categories);
    if (post.installKind === 'bikePaint') post.needsModelNotice = false;
    // Tracks, whole bikes and other standalone mods only keep requirements the creator declared explicitly.
    if (site.standalone(post.categories)) post.dependencies = (post.dependencies || []).filter((d) => d.declared || d.kind === 'bikeSwap');
    if (rec) {
      const files = [];
      for (const rel of rec.files.filter((f) => /\.pnt$/i.test(f) && !f.startsWith('game:'))) {
        const abs = path.resolve(modsDir(), rel);
        if (!insideRoots(abs)) continue;
        try { files.push({ rel, abs, size: (await fsp.stat(abs)).size }); } catch {}
      }
      const info = await paintCompat.inspect(files, modsDir(), stockRiderPkz(), rec.kind || 'custom');
      if (info.dependencies.length) post.dependencies = [...post.dependencies.filter((d) => !d.unidentified && !info.dependencies.some((x) => dependencyKey(x.url) === dependencyKey(d.url))), ...info.dependencies];
      if (info.bodyPaintTextures.length && !info.riderModels.some((m) => info.bodyPaintTextures.every((t) => m.textures.includes(t)))) {
        post.missingModelTextures = info.bodyPaintTextures.filter((t) => !['rider', 'gloves', 'skin'].includes(t));
      }
    }
    const records = Object.values(store.get('installs'));
    const paintListing = post.categories.some((c) => [127, 126, 135, 35, 309].includes(c)) && !post.categories.some((c) => [313, 343, 344, 365].includes(c));
    const dependencyCandidates = post.dependencies.filter(isModelRequirement)
      .map((d) => d.declared && !dependencyModelKind(d) ? { ...d, kind: ({ helmetPaint: 'helmets', bootPaint: 'boots', protectionPaint: 'protections' })[post.installKind] } : d);
    if (paintListing || post.needsModelNotice || dependencyCandidates.length) {
      const catalog = await gearAssets.catalog({ modsDir: modsDir(), rider: 'default_mx', stockPkz: stockRiderPkz() }, {}).catch(() => null);
      if (catalog) catalog.riders = (await fsp.readdir(path.join(modsDir(), 'rider', 'riders'), { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() || /\.pkz$/i.test(e.name)).map((e) => e.name.replace(/\.pkz$/i, ''));
      post.modelDependencies = await Promise.all(dependencyCandidates.map(async (d) => ({ ...d, ...await dependencyStatus(d, records, catalog) })));
    }
    const hoodie = post.dependencies.find((d) => /\/rider-hoodie-abdesigns\/?(?:[?#].*)?$/.test(d.url));
    if (hoodie) {
      const models = await paintCompat.riderModels(modsDir(), stockRiderPkz());
      const matching = models.find((m) => m.textures.includes('abhoodie'));
      const unverified = models.some((m) => m.unverified && /^(?:ab[ _-]?hoodie|rider[ _-]+hoodie[ _-]+abdesigns)$/i.test(m.name));
      post.modelDependencies = [...(post.modelDependencies || []).filter((d) => d.url !== hoodie.url), { label: 'AB-HOODIE rider model', url: hoodie.url, installed: matching ? true : unverified ? null : false, matchedName: matching?.name }];
    }
    for (const download of post.downloads) if (download.shop) {
      download.modelInstalled = post.modelDependencies?.some((d) => dependencyKey(d.url) === dependencyKey(download.url) && d.installed === true) || false;
    }
    for (const download of post.downloads) {
      download.modelDependencies = require('./src/lib/download-dependencies').forDownload(download, post.modelDependencies || [], post.downloads);
      const ownFiles = rec?.downloads?.[download.url] || (rec?.source === download.url ? rec.files : []);
      download.installed = !!ownFiles?.length && ownFiles.every((f) => rec.files.includes(f));
    }
    return post;
  });
  handle('site:installedIds', () => Object.values(store.get('installs')).filter((r) => r.postId).map((r) => r.postId));
  handle('installs:keys', () => Object.values(store.get('installs')).map((r) => ({ postId: r.postId, shopKey: r.shopKey, title: r.title, siteModified: r.siteModified })));

  handle('jobs:start', (d) => {
    const j = newJob({
      title: d.title, postId: d.postId, shopKey: d.shopKey, url: d.url, image: d.image, link: d.link, modified: d.modified,
      categories: d.categories, categoryNames: d.categoryNames, dependencies: d.dependencies, requireReview: !!d.requireReview, modelWarningAccepted: !!d.modelWarningAccepted,
    });
    runDownload(j);
    return j.id;
  });
  handle('jobs:startFiles', (files) => {
    const ids = [];
    for (const f of files) {
      if (!f || !fs.existsSync(f)) continue;
      const j = newJob({ title: path.basename(f).replace(/\.[^.]+$/, ''), url: null, sourceArchive: insideRoots(f) && /\.(zip|rar|7z)$/i.test(f) ? f : null });
      const copyDir = path.join(j.stageDir, 'dl');
      fs.mkdirSync(copyDir, { recursive: true });
      const dest = path.join(copyDir, path.basename(f));
      fs.copyFileSync(f, dest);
      afterDownload(j, dest);
      ids.push(j.id);
    }
    return ids;
  });
  handle('jobs:list', () => [...jobs.values()].map(jobView).sort((a, b) => b.createdAt - a.createdAt));
  handle('jobs:clearHistory', () => { for (const [id, j] of jobs) if (['done', 'error'].includes(j.status)) jobs.delete(id); return [...jobs.values()].map(jobView); });
  handle('jobs:reveal', (id) => {
    const j = jobs.get(id);
    if (!j) throw new Error('Download not found');
    const installed = (j.installed && j.installed[0]) || (j.status === 'done' && j.plan?.entries.find((e) => e.dest)?.dest);
    const root = j.plan?.root === 'game' ? store.get('settings').gameInstallDir : modsDir();
    const candidates = j.status === 'done' ? [installed && path.resolve(root, installed.replace(/^game:/, ''))] : [j.file, j.sourceArchive];
    const file = candidates.filter(Boolean).find((p) => fs.existsSync(p));
    if (file) shell.showItemInFolder(file);
    else if (j.stageDir && fs.existsSync(j.stageDir)) shell.openPath(j.stageDir);
    else throw new Error('This download has no file on disk yet');
  });
  handle('jobs:deleteFiles', async (id) => {
    const j = jobs.get(id);
    if (!j) throw new Error('Download not found');
    if (['downloading', 'queued', 'extracting', 'installing'].includes(j.status)) throw new Error('Cancel the download before deleting its files');
    if (j.status !== 'done') { if (j.file && fs.existsSync(j.file)) await shell.trashItem(j.file); cleanupStage(j); j.status = 'error'; j.error = 'Downloaded files deleted'; emitJob(j); return; }
    if (await profile.isGameRunning()) throw new Error('Close MX Bikes before deleting installed files');
    const swapKey = installKey(j, j.installed || []);
    if (bikeSwaps.hasRecord(swapKey)) {
      await bikeSwaps.removeRecord(swapKey);
      const record = store.get('installs')[swapKey];
      for (const rel of record?.files || []) if (/\.pnt$/i.test(rel) && insideRootsStrict(path.resolve(modsDir(), rel)) && fs.existsSync(path.resolve(modsDir(), rel))) await shell.trashItem(path.resolve(modsDir(), rel));
      store.update('installs', (all) => { const n = { ...all }; delete n[swapKey]; return n; });
      j.status = 'error'; j.error = null; j.installed = []; j.filesDeleted = true; j.note = 'Model swap removed; original bike restored'; emitJob(j); send('library:changed', {}); return;
    }
    if (j.plan?.root === 'game') {
      await graphicsManager.uninstall(installKey(j, j.installed || []));
      j.status = 'error'; j.error = null; j.installed = []; j.filesDeleted = true; j.note = 'Graphics package removed; original game files restored'; emitJob(j); send('library:changed', {}); return;
    }
    const installed = j.installed?.length ? j.installed : (j.plan?.entries || []).filter((e) => e.dest).map((e) => (j.plan.root === 'game' ? 'game:' : '') + e.dest);
    const removed = new Set();
    for (const file of installed) {
      const abs = file.startsWith('game:') ? path.resolve(store.get('settings').gameInstallDir, file.slice(5)) : path.resolve(modsDir(), file);
      if (!insideRootsStrict(abs) && !insideGame(abs)) throw new Error('File is outside the mod install folders');
      if (fs.existsSync(abs)) await shell.trashItem(abs);
      if (file.startsWith('game:') && fs.existsSync(abs + '.mxbm-bak')) await fsp.rename(abs + '.mxbm-bak', abs);
      removed.add(file);
    }
    store.update('installs', (all) => Object.fromEntries(Object.entries(all).map(([key, rec]) => [key, { ...rec, files: rec.files.filter((file) => !removed.has(file)) }]).filter(([, rec]) => rec.files.length)));
    j.status = 'error'; j.error = null; j.note = `Removed ${removed.size} installed files to the Recycle Bin`; j.installed = []; j.filesDeleted = true;
    emitJob(j); await scan(); send('library:changed', {});
    return { removed: removed.size };
  });
  handle('jobs:plan', async (id, opts) => {
    const j = jobs.get(id);
    if (!j || !j.files) return null;
    const kind = opts?.kind || j.opts?.kind || j.plan?.kind || installer.kindFromCategories(j.ctx.categories);
    if (Object.entries(j.ctx.paintTextures || {}).some(([rel, names]) => paintCompat.isBodyPaint(rel, names, kind))) j.ctx.riderModels = await paintCompat.riderModels(modsDir(), stockRiderPkz());
    j.opts = opts;
    j.plan = installer.plan(j.files, j.ctx, opts);
    emitJob(j);
    return jobView(j);
  });
  handle('jobs:install', (id, opts) => { const j = jobs.get(id); if (j && j.files) doInstall(j, opts || j.opts || {}); });
  async function equipContext(id, index, target = {}) {
    const j = jobs.get(id), choice = j?.equipCandidates?.[index];
    if (!choice || j.status !== 'done') throw new Error('This installed item is no longer available');
    const name = target.profile || (await profile.listProfiles(profUserDir())).last; if (!name) throw new Error('Create an MX Bikes rider profile first');
    const prof = await profile.readProfile(profUserDir(), name), bike = choice.bike || target.bike || profile.currentBike(prof);
    if (!bike) throw new Error('Choose your current bike in the Rider page first');
    if (!gearAssets.validName(bike)) throw new Error('Invalid bike');
    const base = draftProfile(prof, bike, target.changes || {});
    const lo = await profile.loadout(modsDir(), base, bike, stockRiderPkz());
    const changes = equipInstalled.changesFor(choice, lo.current);
    const preview = draftProfile(base, bike, changes);
    const next = await profile.loadout(modsDir(), preview, bike, stockRiderPkz());
    if (choice.slot === 'bikePaint') {
      const bikeDir = await profile.findBikeDir(modsDir(), bike);
      const packed = await bike3d.paints({ modsDir: modsDir(), installDir: store.get('settings').gameInstallDir, bike, bikeDir }).catch(() => []);
      next.options.bikePaint = [...new Set([...next.options.bikePaint, ...packed])];
    }
    const preferred = equipInstalled.availablePaints(choice, next.options[choice.slot] || []);
    if (choice.paints.length && !preferred.length) throw new Error('The installed paints could not be found for this model. Refresh your Rider library and check the install location.');
    next.current[choice.slot] = preferred[0] || '';
    return { name, bike, choice, lo: next, current: lo.current, preferred };
  }
  handle('jobs:equipContext', async (id, index, target) => { const ctx = await equipContext(id, index, target); return { profile: ctx.name, bike: ctx.bike, slot: ctx.choice.slot, lo: ctx.lo, preferred: ctx.preferred }; });
  handle('jobs:equip', async (id, index, paint = '', target) => {
    const ctx = await equipContext(id, index, target);
    if (paint !== '' && !(ctx.lo.options[ctx.choice.slot] || []).includes(paint)) throw new Error('Choose an installed paint for this item');
    if (paint !== '' && !ctx.preferred.includes(paint)) throw new Error('Choose a paint from this download');
    const changes = equipInstalled.changesFor(ctx.choice, ctx.current, paint);
    const next = { ...ctx.current, ...changes };
    if (changes.suitPaint) await paintCompat.validateRiderPaint({ modsDir: modsDir(), stockPkz: stockRiderPkz(), current: next });
    // Equipping from Get Mods edits the same preview as the Rider page.
    // Only Rider's Apply action writes/activates a game profile.
    return { profile: ctx.name, bike: ctx.bike, changes };
  });
  handle('jobs:cancel', (id) => {
    const j = jobs.get(id);
    if (!j) return;
    j.abort.abort();
    j.browserDownload?.cancel();
    if (j.status === 'installing') { j.note = 'Cancelling and restoring previous files…'; emitJob(j); return; }
    if (j.browserWin && !j.browserWin.isDestroyed()) j.browserWin.close();
    j.status = 'error'; j.error = 'Cancelled'; emitJob(j);
    cleanupStage(j);
  });
  handle('jobs:dismiss', (id) => { const j = jobs.get(id); if (j && ['done', 'error'].includes(j.status)) jobs.delete(id); });
  handle('jobs:retry', async (id) => { const j = jobs.get(id); if (j && j.url) { await j.cleaning; j.abort = new AbortController(); j.error = null; runDownload(j); } });
  handle('jobs:openBrowser', (id) => { const j = jobs.get(id); if (j && j.url) openBrowserFor(j, j.url, 'Opened manually.'); });

  // ---- accounts: Steam (read locally) + shops (sign in on the shop's own page) ----
  handle('steam:detect', () => {
    const s = steam.detect(paths.steamRoot());
    if (s.avatar) { try { s.avatarData = 'data:image/png;base64,' + fs.readFileSync(s.avatar).toString('base64'); } catch {} }
    delete s.avatar;
    return s;
  });
  handle('shops:list', async () => Promise.all(Object.values(shops.SHOPS).map(async (s) => ({
    id: s.id, name: s.name, url: s.url, account: await shops.account(ses, s.id),
  }))));
  // Website install links: turn a source + id into what the renderer needs to open it.
  handle('deeplink:target', async (l) => {
    if (!l || l.type !== 'install') return null;
    if (l.source === 'local') {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(l.id))) return null;
      const post = await coremx.post(l.id);
      return { source: 'local', addon: post.addon, post };
    }
    if (!Number.isSafeInteger(l.id) || l.id <= 0 || l.id > 999999999999) return null;
    if (l.source === 'mxbmods') { const [post] = await site.postsByIds([l.id]); return post ? { source: 'mxbmods', addon: site.isAddonPost(post), post } : null; }
    if (l.source !== 'hub' && l.source !== 'mxbs') return null;
    const link = await shops.productLink(ses, l.source, l.id);
    return link ? { source: l.source, link } : null;
  });
  handle('shops:cats', (id) => shops.categories(ses, id));
  handle('shops:search', (q) => shops.search(ses, q));
  handle('shops:details', (id, link) => shops.details(ses, id, link));
  handle('shops:owned', (id, force) => shops.owned(ses, id, !!force));
  handle('shops:lookup', (id, items) => shops.lookup(ses, id, items));
  handle('shops:signOut', async (id) => { await shops.signOut(ses, id); return shops.account(ses, id); });
  handle('shops:signIn', (id) => signInWindow(id));
  handle('shops:open', (id, url) => {
    const shop = shops.SHOPS[id];
    let address; try { address = new URL(url); } catch { return; }
    if (!shop || !/^https?:$/.test(address.protocol) || address.hostname.replace(/^www\./, '') !== new URL(shop.url).hostname) return;
    address.hostname = new URL(shop.url).hostname; address.protocol = 'https:';
    const win = new BrowserWindow({ width: 1200, height: 860, parent: mainWin, autoHideMenuBar: true, backgroundColor: '#111', title: shop.name, webPreferences: { partition: 'persist:mxb', contextIsolation: true, sandbox: true } });
    const contentsId = win.webContents.id;
    const rememberProduct = (page) => { const product = site.shopProduct(page); if (product?.shop === id) shopDownloads.set(contentsId, product); };
    rememberProduct(address.href);
    win.webContents.on('did-navigate', (_event, page) => rememberProduct(page));
    win.webContents.setWindowOpenHandler(({ url: u }) => { win.loadURL(u); return { action: 'deny' }; });
    win.on('closed', () => { shopDownloads.delete(contentsId); send('shops:changed', { id }); });
    win.loadURL(address.href);
  });

  // ---- game settings, quick start, launching / joining ----
  const profName = async () => (await profile.listProfiles(profUserDir())).last;
  handle('game:settings', async () => { const n = await profName(); if (!n) return null; return { profile: n, values: await game.readSettings(profUserDir(), n) }; });
  handle('game:setValues', async (values) => profile.writeValues(profUserDir(), await profName(), values));
  handle('game:quickStart', async (opts) => game.quickStart(profUserDir(), await profName(), opts));
  handle('game:running', () => profile.isGameRunning());
  handle('game:join', async (address) => {
    const addr = game.validAddress(address);
    if (!addr) throw new Error('That address should look like 123.45.67.89:54210');
    if (await profile.isGameRunning()) throw new Error('Close MX Bikes, then click Join again to connect directly to this server.');
    const exe = paths.findGameExe(store.get('settings').gameInstallDir);
    if (!exe) throw new Error("Couldn't find mxbikes.exe — set the game install folder in Settings.");
    game.launch(exe, ['-directconnect', addr]);
    if (online) online.noteJoin(addr);
    return true;
  });
  // After a missing track is installed: close MX Bikes the normal way (a window close request,
  // like clicking X; never a forced kill, so it saves its profile), wait for it to exit, then
  // launch it straight into the server.
  handle('game:restartAndJoin', async (address) => {
    const addr = game.validAddress(address);
    if (!addr) throw new Error('That server address is not valid');
    const exe = paths.findGameExe(store.get('settings').gameInstallDir);
    if (!exe) throw new Error("Couldn't find mxbikes.exe — set the game install folder in Settings.");
    if (await profile.isGameRunning()) {
      await new Promise((resolve) => execFile('taskkill', ['/IM', 'mxbikes.exe'], { windowsHide: true }, () => resolve()));
      const until = Date.now() + 25000;
      while (await profile.isGameRunning()) {
        if (Date.now() > until) throw new Error('MX Bikes did not close. Close it yourself, then click Join again.');
        await new Promise((r) => setTimeout(r, 1000));
      }
      await new Promise((r) => setTimeout(r, 2500)); // let it finish writing its profile
    }
    game.launch(exe, ['-directconnect', addr]);
    if (online) online.noteJoin(addr);
    return true;
  });
  // ---- graphics mods in the game folder ----
  handle('graphics:scan', async () => {
    const dir = store.get('settings').gameInstallDir;
    const r = await graphics.scan(dir);
    const recs = Object.entries(store.get('installs')).filter(([, x]) => graphicsPackages.isGraphics(x));
    return { ...r, installDir: dir, installed: recs.map(([key, x]) => ({ title: x.title, image: x.image, link: x.link, files: x.files.length, active: x.graphicsActive !== false, installedAt: x.installedAt, key })) };
  });
  handle('graphics:setActive', async (key, enabled) => { await graphicsManager.setActive(key, !!enabled); send('library:changed', {}); return true; });
  handle('graphics:toggle', async (p, on) => { await graphics.toggle(store.get('settings').gameInstallDir, p, on); return true; });
  handle('graphics:trash', async (p) => { if (!insideGame(p)) throw new Error('Not in the game folder'); await shell.trashItem(p); return true; });
  handle('graphics:reveal', (p) => { if (insideGame(p)) shell.showItemInFolder(p); });

  // ---- mxb-ranked (public pages) ----
  const myGuid = () => {
    let guid = store.get('settings').rankedGuid;
    if (!guid) { const st = steam.detect(paths.steamRoot()); if (st.found) guid = ranked.guidFromSteam(st.steamId); }
    return guid;
  };
  // Last good profile, shown instantly while a fresh one loads (the site can be slow).
  handle('ranked:cached', () => { const c = store.get('rankedCache'); return c && c.me && c.me.guid === myGuid() ? { ...c.me, cachedAt: c.at } : null; });
  handle('ranked:me', async () => {
    const guid = myGuid();
    if (!guid) return { found: false, noGuid: true };
    const me = await ranked.profile(guid);
    if (me.found) store.set('rankedCache', { at: Date.now(), me });
    return me;
  });
  handle('ranked:setGuid', (g) => { const guid = g ? ranked.normaliseGuid(g) : null; if (g && !guid) throw new Error("That doesn't look like an MX Bikes GUID"); store.update('settings', (s) => ({ ...s, rankedGuid: guid })); return guid; });
  handle('ranked:servers', () => ranked.servers());
  handle('ranked:details', (name) => rankedServerDetails(name));
  handle('ranked:results', () => ranked.results());
  handle('ranked:records', () => ranked.records());
  handle('ranked:tracks', () => ranked.tracks());
  handle('ranked:news', () => ranked.announcements());
  handle('ranked:season', () => ranked.seasonRanks());
  handle('official:servers', () => ranked.officialServers());
  handle('ranked:open', (url) => {
    if (!/^https:\/\/(www\.)?mxb-ranked\.com\//.test(url)) return;
    const win = new BrowserWindow({ width: 1200, height: 860, parent: mainWin, autoHideMenuBar: true, backgroundColor: '#111', title: 'MXB Ranked', webPreferences: { partition: 'persist:mxb', contextIsolation: true, sandbox: true } });
    win.webContents.setWindowOpenHandler(({ url: u }) => { win.loadURL(u); return { action: 'deny' }; });
    win.loadURL(url);
  });

  // ---- host your own dedicated server ----
  handle('host:get', () => store.get('hostConfig') || null);
  handle('host:save', (cfg) => { store.set('hostConfig', cfg); return true; });
  handle('host:preview', (cfg) => host.toIni(cfg));
  handle('host:start', async (cfg) => {
    store.set('hostConfig', cfg);
    return host.start(store.get('settings').gameInstallDir, cfg, (code) => send('host:status', { exited: true, code }));
  });
  handle('host:stop', () => host.stop());
  handle('host:status', () => host.status(store.get('settings').gameInstallDir));

  // ---- full server list via FrostMod's file ----
  handle('frostmod:status', async () => {
    const s = await frostmod.status(store.get('settings').gameInstallDir, userDir());
    return { ...s, version: store.get('settings').frostmodVersion || null, autoInstall: store.get('settings').frostmodAutoInstall !== false };
  });
  handle('frostmod:install', async () => {
    if (await profile.isGameRunning()) throw new Error('Close MX Bikes first — the game loads plugins when it starts.');
    const r = await frostmod.installBundled(app.isPackaged ? process.resourcesPath : __dirname, store.get('settings').gameInstallDir);
    store.update('settings', (s) => ({ ...s, frostmodAutoInstall: true, frostmodVersion: r.version || s.frostmodVersion }));
    watchFrostList();
    return r;
  });
  handle('frostmod:uninstall', async () => {
    if (discoveryInstall) await discoveryInstall.catch(() => {});
    const p = frostmod.pluginPath(store.get('settings').gameInstallDir);
    if (p && fs.existsSync(p) && await profile.isGameRunning()) throw new Error('Close MX Bikes before removing a loaded plugin.');
    store.update('settings', (s) => ({ ...s, frostmodAutoInstall: false }));
    if (p && fs.existsSync(p)) await shell.trashItem(p);
    const fl = frostmod.flagPath(store.get('settings').gameInstallDir);
    if (fl && fs.existsSync(fl)) await fsp.rm(fl, { force: true });
    await frostmod.cleanup(store.get('settings').gameInstallDir, userDir(), { all: true });
    if (p) {
      const licenses = path.join(path.dirname(p), 'frostmod-licenses');
      for (const name of frostmod.LICENSES) await fsp.rm(path.join(licenses, name), { force: true });
      await fsp.rmdir(licenses).catch((e) => { if (!['ENOENT', 'ENOTEMPTY'].includes(e.code)) throw e; });
    }
    store.update('settings', (s) => ({ ...s, frostmodVersion: null }));
    return true;
  });

  // ---- online service (plugin presence, live servers, friends) ----
  handle('online:status', () => online.status());
  handle('online:refresh', async () => { await online.refresh(); return online.status(); });
  handle('online:pluginInstall', () => online.installPlugin());
  handle('online:pluginRemove', () => online.removePlugin());
  handle('online:connect', (url, name) => online.connect(url, name));
  handle('online:disconnect', () => online.disconnect());
  handle('online:share', (on) => online.setShare(on));
  handle('online:servers', async (force = false) => { const result = await online.servers(); const servers = await addKnownServerAddresses(result.servers); return { ...result, servers: await serverPing.measure(servers, undefined, !!force) }; });
  handle('online:friends', async () => {
    const friends = await online.syncFriends();
    if (!friends.some((f) => f.online && f.server && !f.address)) return friends;
    const addresses = await knownServerAddresses();
    return friends.map((f) => {
      if (!f.online || !f.server || f.address) return f;
      const matches = [...(addresses.get(serverNameKey(f.server)) || [])];
      return matches.length === 1 ? { ...f, address: matches[0] } : f;
    });
  });
  handle('online:paintSync', (on) => online.setPaintSync(on));
  handle('online:paintSyncNow', (friendId) => online.syncPaints(friendId));
  handle('online:serverRiders', (server) => online.serverRiders(String(server || '').slice(0, 64)));
  handle('online:syncServerRiders', (server, ids) => online.syncServerRiders(String(server || '').slice(0, 64), Array.isArray(ids) ? ids.map(String).slice(0, 32) : []));
  handle('online:serverShare', (on) => online.setServerShare(on));
  const friendPreviewLoadouts = new Map();
  handle('online:friendLoadout', async (friendId) => {
    const outfit = await online.friendLoadout(friendId);
    friendPreviewLoadouts.set(friendId, { outfit, at: Date.now() });
    while (friendPreviewLoadouts.size > 50) friendPreviewLoadouts.delete(friendPreviewLoadouts.keys().next().value);
    return outfit;
  });
  handle('online:friendPreview', async (friendId) => {
    if (!(store.get('friends') || []).some((friend) => friend.code === friendId)) throw new Error('Add this rider as a friend first');
    const cached = friendPreviewLoadouts.get(friendId);
    const outfit = cached && Date.now() - cached.at < 60000 ? cached.outfit : await online.friendLoadout(friendId);
    return require('./src/lib/friend-preview').build(outfit, { modsDir: modsDir(), installDir: store.get('settings').gameInstallDir, resolveAppearance: (bike, entry) => bikeSwaps.sharedPreview(bike, entry), buildModel: (type, options) => modelWorkers.build(type, options) });
  });
  handle('online:removeReceived', () => online.removeReceived());
  handle('online:steamFriends', async () => {
    const me = steam.detect(paths.steamRoot());
    const list = me.found ? steam.friends(paths.steamRoot(), me.steamId) : [];
    let known = [];
    try { known = (await online.known(list.map((f) => f.steamId))).known.map((k) => k.id); } catch {}
    return list.map((f) => ({ ...f, onService: known.includes(f.steamId) }));
  });
  handle('servers:list', () => store.get('servers') || []);
  handle('servers:save', (list) => { store.set('servers', list); return list; });
  handle('friends:list', () => store.get('friends') || []);
  handle('friends:save', (list) => { store.set('friends', list); return list; });

  // ---- fix & clean ----
  handle('health:scan', async () => {
    await scan();
    return { issues: await health.scan({ installDir: store.get('settings').gameInstallDir, modsDir: modsDir(), items: lastScan.items }), storage: health.storage(lastScan.items) };
  });
  handle('health:fix', async (issue) => {
    if (issue.fixId === 'disable-file') {
      const p = issue.path;
      if (!p || !insideGame(p)) throw new Error('Not in the game folder');
      await fsp.rename(p, p + '.off');
    } else if (issue.fixId === 'trash') {
      if (!issue.path || !insideRootsStrict(issue.path)) throw new Error('Not in the mods folder');
      await shell.trashItem(issue.path);
    } else if (issue.fixId === 'disable-items') {
      const r = await setEnabled(issue.itemIds || [], false);
      if (r.errors.length) throw new Error(r.errors.slice(0, 3).join('\n'));
    } else if (issue.fixId === 'repair-gear') {
      const result = await repairGearFolders();
      await scan(); send('library:changed', {});
      return { repaired: result.moved, conflicts: result.conflicts };
    } else if (issue.fixId === 'trash-items') {
      throw new Error('This old cleanup action is no longer valid. Check again to repair gear folders without deleting valid accessories.');
    } else if (issue.fixId === 'trash-item') {
      await trash([issue.itemId]);
    } else if (issue.fixId === 'move-track') {
      const it = findItem(issue.itemId);
      for (const part of it.parts) await moveSafe(path.join(modsDir(), part), path.join(modsDir(), 'tracks', 'motocross', path.basename(part)));
    } else if (issue.fixId === 'install-archive') {
      const it = findItem(issue.itemId);
      const file = path.join(rootFor(it.disabled), it.parts[0]);
      const j = newJob({ title: it.name, file, sourceArchive: file, categories: it.group === 'tracks' ? [22] : [], opts: it.group === 'tracks' && it.sub !== '(loose)' ? { kind: 'track', trackType: it.sub } : {} });
      afterDownload(j, file);
      return { job: j.id };
    }
    await scan();
    send('library:changed', {});
    return { ok: true };
  });

  // ---- OEM packs ----
  handle('packs:list', async (force) => Promise.all(packs.PACKS.map(async (p) => {
    try {
      const data = await packs.info(ses, p.id, force);
      const cmp = await packs.compare(modsDir(), data);
      return { id: p.id, name: p.name, blurb: p.blurb, version: data.version, post: data.post, listError: data.listError, hasDownload: !!data.download, downloadUrl: data.download && data.download.url,
        summary: cmp && { total: cmp.total, have: cmp.have, needCount: cmp.needCount, needBytes: cmp.needBytes, packBytes: cmp.packBytes, old: cmp.old.length } };
    } catch (e) { return { id: p.id, name: p.name, blurb: p.blurb, error: e.message }; }
  })));
  handle('packs:detail', async (id) => {
    const data = await packs.info(ses, id);
    return { id, name: data.name, version: data.version, post: data.post, listError: data.listError, compare: await packs.compare(modsDir(), data) };
  });
  handle('packs:update', async (id) => {
    const data = await packs.info(ses, id);
    const cmp = await packs.compare(modsDir(), data);
    const need = cmp.rows.filter((r) => r.status !== 'ok').map((r) => r.rel);
    if (!need.length) return null;
    const j = newJob({ title: `${data.name} ${data.version ? 'v' + data.version : ''} — ${need.length} file${need.length > 1 ? 's' : ''}`, image: data.post.image, url: null });
    j.status = 'downloading'; j.note = `Downloading only what you need (${need.length} of ${cmp.total} files)`; emitJob(j);
    packs.downloadFiles(ses, data, need, modsDir(), (r, t, rel) => { j.received = r; j.total = t; j.note = `Downloading ${rel}`; emitJob(j); }, j.abort.signal)
      .then((written) => {
        store.update('installs', (all) => ({ ...all, [`pack:${id}`]: { postId: data.post.id, title: `${data.name} pack`, link: data.post.link, image: data.post.image, categories: data.post.categories, siteModified: data.post.modified, installedAt: Date.now(), kind: 'pack', version: data.version, files: Array.from(new Set([...((store.get('installs')[`pack:${id}`] || {}).files || []), ...written])) } }));
        j.status = 'done'; j.installed = written; j.note = `Up to date — installed ${written.length} file(s)`; emitJob(j);
        cleanupStage(j);
        send('library:changed', {});
      })
      .catch((e) => fail(j, e));
    return j.id;
  });

  // ---- rider loadout (profile.ini) ----
  handle('rider:profiles', () => { watchRiderProfiles(); return profile.listProfiles(profUserDir()); });
  handle('rider:createProfile', (name, source, copyGear) => profile.createProfile(profUserDir(), name, source, copyGear !== false));
  handle('rider:activateProfile', (name) => profile.activateProfile(profUserDir(), name));
  handle('rider:deleteProfile', (name) => profile.deleteProfile(profUserDir(), name, (folder) => shell.trashItem(folder)));
  async function installedBikeCategory(bike) {
    if (!gearAssets.validName(bike)) throw new Error('Invalid bike');
    const model = await profile.findBikeDir(modsDir(), bike);
    if (!model && !lastScan.items.some((it) => it.group === 'bikes' && it.name === bike)) throw new Error('That bike is not installed');
    let category = game.classFor(bike);
    if (!category && model) {
      const data = await readChain(await chainOf([{ dir: model }]), bike + '.ini');
      category = data?.buf.toString('latin1').match(/^\s*(?:category|cat)\s*=\s*([^\r\n;]+)/mi)?.[1].trim() || scanner.detectClass(bike);
    }
    return category;
  }
  async function selectSavedBike(name, bike) {
    const category = await installedBikeCategory(bike);
    await profile.activateProfile(profUserDir(), name);
    await game.quickStart(profUserDir(), name, { bike, bikeClass: category });
    if (profile.currentBike(await profile.readProfile(profUserDir(), name)) !== bike) throw new Error('The bike selection could not be saved');
    online?.refresh().catch(() => {}); return true;
  }
  handle('rider:selectBike', selectSavedBike);
  handle('rider:bikes', async (name) => profile.listBikes(modsDir(), await profile.readProfile(profUserDir(), name)));
  function draftProfile(prof, bike, changes) {
    const next = structuredClone(prof);
    // Match MX Bikes: an absent per-bike protection inherits [info] protection.
    const protection = changes.protection ?? (prof.sections.protection?.values[bike] || prof.sections.info?.values.protection || '');
    for (const [slot, value] of Object.entries(changes || {})) {
      if (slot === 'bikeAppearance') continue;
      const desc = profile.SLOTS.find((s) => s.id === slot);
      if (!desc || typeof value !== 'string' || value.length > 200 || /[\\/\r\n]|^\.+$/.test(value)) throw new Error('Invalid gear selection');
      next.sections[desc.section] ||= { values: {} }; next.sections[desc.section].values[desc.key === 'protectionModel' ? protection : bike] = value;
    }
    // A draft of None must also clear the global fallback in this in-memory
    // profile. The real profile is changed only by Apply.
    if (Object.hasOwn(changes, 'protection')) {
      next.sections.info ||= { values: {} };
      next.sections.info.values.protection = changes.protection;
    }
    return next;
  }
  handle('rider:loadout', async (name, bike, changes = {}) => {
    const prof = await profile.readProfile(profUserDir(), name);
    const saved = await profile.loadout(modsDir(), prof, bike, stockRiderPkz());
    const lo = await profile.loadout(modsDir(), draftProfile(prof, bike, changes), bike, stockRiderPkz());
    lo.savedCurrent = saved.current;
    const appearances = bikeSwaps.list(bike);
    lo.slots = [...lo.slots, { id: 'bikeAppearance', label: 'Bike appearance' }];
    lo.options.bikeAppearance = appearances.options.map((o) => o.id);
    lo.appearances = appearances.options;
    lo.current.bikeAppearance = changes.bikeAppearance ?? appearances.active;
    lo.savedCurrent.bikeAppearance = appearances.active;
    const bikeDir = await profile.findBikeDir(modsDir(), bike);
    const packed = await bike3d.paints({ modsDir: modsDir(), installDir: store.get('settings').gameInstallDir, bike, bikeDir }).catch(() => []);
    lo.options.bikePaint = [...new Set(['', ...lo.options.bikePaint, ...packed])];
    lo.profileActive = (await profile.listProfiles(profUserDir())).last === name;
    lo.selectedInGame = lo.selectedInGame && lo.profileActive;
    return lo;
  });
  // MX Bikes rewrites the profile when it exits, so changes made while it runs would be lost.
  // Queue them instead and write them a few seconds after the game closes.
  handle('rider:apply', async (name, bike, changes = {}) => {
    if (!gearAssets.validName(bike)) throw new Error('Invalid bike');
    if (await profile.isGameRunning()) {
      store.update('pendingApply', (all) => ({ ...(all || {}), [`${name}|${bike}`]: { name, bike, changes, at: Date.now() } }));
      watchPendingApply();
      return { queued: true };
    }
    return applyRider(name, bike, changes);
  });
  handle('rider:pendingApply', () => Object.values(store.get('pendingApply') || {}));
  handle('rider:cancelPendingApply', (name, bike) => { store.update('pendingApply', (all) => { const n = { ...(all || {}) }; delete n[`${name}|${bike}`]; return n; }); return true; });
  async function applyRider(name, bike, changes = {}) {
    if (!gearAssets.validName(bike)) throw new Error('Invalid bike');
    const prof = await profile.readProfile(profUserDir(), name), preview = draftProfile(prof, bike, changes);
    const next = await profile.loadout(modsDir(), preview, bike, stockRiderPkz());
    if (changes.tyres && !next.options.tyres.includes(changes.tyres)) throw new Error('That tyre set is not available for this bike. Choose one from its tyre list.');
    if (next.current.suitPaint) await paintCompat.validateRiderPaint({ modsDir: modsDir(), stockPkz: stockRiderPkz(), current: next.current });
    const values = Object.entries(changes).filter(([slot]) => slot !== 'bikeAppearance').map(([slot, value]) => { const desc = profile.SLOTS.find((s) => s.id === slot); return [desc.section, desc.key === 'protectionModel' ? next.current.protection || '' : bike, value]; });
    // The game uses [info] protection as a fallback for an empty per-bike
    // setting.  Without this, the UI says None while the stock chest remains.
    values.push(['info', 'protection', next.current.protection || '']);
    const category = await installedBikeCategory(bike) || prof.sections.info?.values.class;
    values.push(['tyres', bike, next.current.tyres || '']);
    values.push(['info', 'bikeid', bike]); if (category) values.push(['info', 'class', category], ['category', category, bike]);
    const previousAppearance = bikeSwaps.list(bike).active;
    if (Object.hasOwn(changes, 'bikeAppearance')) await bikeSwaps.select(bike, changes.bikeAppearance);
    try { await profile.writeValues(profUserDir(), name, values); await profile.activateProfile(profUserDir(), name); }
    catch (error) { if (Object.hasOwn(changes, 'bikeAppearance')) await bikeSwaps.select(bike, previousAppearance); throw error; }
    const saved = await profile.readProfile(profUserDir(), name), actual = await profile.loadout(modsDir(), saved, bike, stockRiderPkz());
    if (profile.currentBike(saved) !== bike || Object.entries(changes).some(([slot, value]) => (slot === 'bikeAppearance' ? bikeSwaps.list(bike).active : actual.current[slot] || '') !== value)) throw new Error('Saved profile did not match the requested setup. Preview changes were kept.');
    online?.syncPaints().catch(() => {}); return { saved: true };
  }
  let pendingWatch = null;
  function watchPendingApply() {
    if (pendingWatch || !Object.keys(store.get('pendingApply') || {}).length) return;
    let closedAt = 0;
    pendingWatch = setInterval(async () => {
      if (await profile.isGameRunning()) { closedAt = 0; return; }
      // Give the game a moment to finish writing its profile on exit.
      if (!closedAt) { closedAt = Date.now(); return; }
      if (Date.now() - closedAt < 4000) return;
      clearInterval(pendingWatch); pendingWatch = null;
      const queued = Object.values(store.get('pendingApply') || {});
      store.set('pendingApply', {});
      const results = [];
      for (const p of queued) {
        try { await applyRider(p.name, p.bike, p.changes); results.push({ bike: p.bike, ok: true }); }
        catch (e) { results.push({ bike: p.bike, ok: false, error: e.message }); }
      }
      send('rider:pendingApplied', results);
      send('rider:changed', { active: (await profile.listProfiles(profUserDir()).catch(() => ({}))).last });
    }, 2000);
    pendingWatch.unref?.();
  }
  watchPendingApply();
  handle('bike:model', async (name, bike, paint, texMax = 1024, previewCurrent = {}) => {
    if (typeof bike !== 'string' || /[\\/]|^\.+$/.test(bike)) throw new Error('Invalid bike name');
    if (paint == null) {
      const selected = name || (await profile.listProfiles(profUserDir())).last;
      const lo = selected && await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), selected), bike);
      paint = lo && lo.current.bikePaint || '';
    }
    const active = name || (await profile.listProfiles(profUserDir())).last;
    const selected = active && await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), active), bike, stockRiderPkz());
    const tyre = Object.hasOwn(previewCurrent, 'tyres') ? previewCurrent.tyres : selected?.current.tyres;
    if (tyre && !gearAssets.validName(tyre)) throw new Error('Invalid tyre selection');
    if (tyre && !selected?.options.tyres.includes(tyre)) throw new Error('That tyre set is not available for this bike');
    return modelWorkers.build('bike', { modsDir: modsDir(), installDir: store.get('settings').gameInstallDir, bike, tyresOverride: tyre,
      ...bikeSwaps.preview(bike, previewCurrent.bikeAppearance),
      bikeDir: await profile.findBikeDir(modsDir(), bike), paint, texMax: Math.min(1024, Math.max(128, Number(texMax) || 1024)) });
  });
  handle('rider:deleteModel', async (model) => {
    try { await deleteRiderModel(model); }
    finally { await reconcileInstallRecords(); await scan(); send('library:changed', {}); }
    return { ok: true };
  });
  handle('rider:save', async (name, changes) => {
    const prof = await profile.readProfile(profUserDir(), name);
    for (const [bike, slots] of Object.entries(changes)) if (slots.suitPaint) {
      const lo = await profile.loadout(modsDir(), prof, bike);
      await paintCompat.validateRiderPaint({ modsDir: modsDir(), stockPkz: stockRiderPkz(), current: { ...lo.current, ...slots } });
    }
    const result = await profile.saveLoadouts(profUserDir(), name, changes); online?.syncPaints().catch(() => {}); return result;
  });
  handle('rider:deletePaint', async (name, bike, slot, value) => {
    if (await profile.isGameRunning()) throw new Error('Close MX Bikes before deleting a paint');
    const lo = await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), name), bike);
    await riderPaints.remove({ modsDir: modsDir(), current: lo.current, bike, slot, value, trash: (file) => shell.trashItem(file) });
    await reconcileInstallRecords();
    if (lo.current[slot] === value) await profile.saveLoadouts(profUserDir(), name, { [bike]: { [slot]: '' } });
    await scan(); send('library:changed', {}); online?.syncPaints().catch(() => {});
    return { ok: true };
  });
  handle('rider:previewModel', async (model) => {
    if (typeof model !== 'string' || /[\\/]|^\.+$/.test(model)) throw new Error('Invalid rider model');
    const inst = store.get('settings').gameInstallDir;
    return modelWorkers.build('rider', { modsDir: modsDir(), gd: profile.gearDir(modsDir(), model), stockPkz: inst ? path.join(inst, 'rider.pkz') : null, current: { rider: model, helmet: 'default', boots: 'default' }, texMax: 512 });
  });
  // 3D preview of a bike's outfit. `override` previews values without saving them.
  handle('rider:model', async (name, bike, override) => {
    const lo = await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), name), bike, stockRiderPkz());
    const inst = store.get('settings').gameInstallDir;
    return modelWorkers.build('rider', { modsDir: modsDir(), gd: lo.gearDir, stockPkz: inst ? path.join(inst, 'rider.pkz') : null, current: { ...lo.current, ...(override || {}) } });
  });
  // Thumbnail model for one option of one slot: only the gear that slot changes, small textures.
  const SLOT_PARTS = { helmet: ['helmet'], helmetPaint: ['helmet'], gogglesPaint: ['helmet'], suitPaint: ['body'], glovesPaint: ['body'], rider: ['body'], boots: ['boots'], bootsPaint: ['boots'], protection: ['protection'], protectionPaint: ['protection'] };
  handle('rider:thumbModel', async (name, bike, slot, value, previewCurrent = {}) => {
    const only = SLOT_PARTS[slot];
    if (!only) throw new Error('No 3D preview for this slot');
    const lo = await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), name), bike, stockRiderPkz());
    const inst = store.get('settings').gameInstallDir;
    const overrides = Object.fromEntries(Object.entries(previewCurrent).filter(([key, v]) => profile.SLOTS.some((s) => s.id === key) && typeof v === 'string' && v.length < 200 && !/[\\/]|^\.+$/.test(v)));
    const cur = { ...lo.current, ...overrides, [slot]: value };
    if (slot === 'helmet') { cur.helmetPaint = ''; cur.gogglesPaint = ''; }
    if (slot === 'rider') { cur.suitPaint = ''; cur.glovesPaint = ''; }
    if (slot === 'boots') cur.bootsPaint = '';
    if (slot === 'protection') cur.protectionPaint = '';
    return modelWorkers.build('rider', { modsDir: modsDir(), gd: profile.gearDir(modsDir(), cur.rider), stockPkz: inst ? path.join(inst, 'rider.pkz') : null, current: cur, only, texMax: 256 }, true);
  });
  // A full-quality, interactive preview for an option in the Rider picker.
  // It deliberately builds only the relevant gear part (not the entire rider)
  // while still using the draft loadout's paint/model context.
  handle('rider:previewSlot', async (name, bike, slot, value, previewCurrent = {}) => {
    if (!profile.SLOTS.some((s) => s.id === slot) || typeof value !== 'string' || value.length > 200 || /[\\/]|^\.+$/.test(value)) throw new Error('Invalid rider preview');
    const lo = await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), name), bike, stockRiderPkz());
    const overrides = Object.fromEntries(Object.entries(previewCurrent).filter(([key, v]) => profile.SLOTS.some((s) => s.id === key) && typeof v === 'string' && v.length < 200 && !/[\\/]|^\.+$/.test(v)));
    const cur = { ...lo.current, ...overrides, [slot]: value };
    if (slot === 'helmet') { cur.helmetPaint = ''; cur.gogglesPaint = ''; }
    if (slot === 'rider') { cur.suitPaint = ''; cur.glovesPaint = ''; }
    if (slot === 'boots') cur.bootsPaint = '';
    if (slot === 'protection') cur.protectionPaint = '';
    const inst = store.get('settings').gameInstallDir;
    const only = SLOT_PARTS[slot];
    if (!only) throw new Error('No isolated 3D preview for this item');
    return modelWorkers.build('rider', { modsDir: modsDir(), gd: profile.gearDir(modsDir(), cur.rider), stockPkz: inst ? path.join(inst, 'rider.pkz') : null, current: cur, only, texMax: 1024 });
  });
  handle('rider:copyToAll', async (name, fromBike) => {
    const prof = await profile.readProfile(profUserDir(), name);
    const lo = await profile.loadout(modsDir(), prof, fromBike);
    const bikes = (await profile.listBikes(modsDir(), prof)).filter((b) => b.installed && b.id !== fromBike);
    const outfit = {};
    for (const s of profile.SLOTS) if (s.group !== 'Bike' && lo.current[s.id] != null) outfit[s.id] = lo.current[s.id];
    const changes = Object.fromEntries(bikes.map((b) => [b.id, outfit]));
    await profile.saveLoadouts(profUserDir(), name, changes);
    return { count: bikes.length };
  });

  handle('installs:list', () => store.get('installs'));
  handle('installs:editLocation', async (key) => {
    if (bikeSwaps.hasRecord(key)) throw new Error('Manage this model swap under Rider → Bike → Appearance. Its saved originals must stay associated with this bike.');
    const rec = store.get('installs')[key]; if (!rec) throw new Error('Install record not found');
    if (graphicsPackages.isGraphics(rec)) throw new Error('Graphics packages use the game folder. Enable or disable them in Graphics.');
    const opts = recentInstalls.previousOptions(rec);
    const base = installer.KINDS[opts.kind]?.base({ gear: `rider/riders/${opts.riderTarget || 'default_mx'}`, trackType: opts.trackType, customDir: opts.customDir }) || '';
    const files = [];
    for (const rel of rec.files) {
      const abs = path.resolve(modsDir(), rel); if (!insideRoots(abs)) throw new Error('Invalid recorded install path');
      const st = await fsp.stat(abs); if (!st.isFile()) continue;
      files.push({ abs, size: st.size, rel: /\.pnt$/i.test(rel) ? path.posix.basename(rel) : rel.startsWith(base + '/') ? rel.slice(base.length + 1) : rel });
    }
    const inspected = await paintCompat.inspect(files, modsDir(), stockRiderPkz(), opts.kind);
    const j = newJob({ title: rec.title, link: rec.link, relocateKey: key, files, opts, modelWarningAccepted: true, ctx: { modsDir: modsDir(), title: rec.title, categories: rec.categories || [], kindHint: opts.kind, relocate: true, ...inspected } });
    j.plan = installer.plan(files, j.ctx, opts); j.status = 'review'; emitJob(j); return jobView(j);
  });
  handle('installs:moveBikePaints', async (key, bike) => {
    if (await profile.isGameRunning()) throw new Error('Close MX Bikes before moving paints');
    const rec = store.get('installs')[key]; if (!rec) throw new Error('Install record not found');
    const result = await recentInstalls.moveBikePaints({ modsDir: modsDir(), record: rec, bike, installedBikes: installer.listModels(modsDir(), 'bikes') });
    store.update('installs', (all) => Object.fromEntries(Object.entries(all).map(([id, record]) => [id, { ...record, files: record.files.map((rel) => result.changes.get(rel) || rel) }])));
    for (const j of jobs.values()) if (j.installed) j.installed = j.installed.map((rel) => result.changes.get(rel) || rel);
    await scan(); send('library:changed', {}); return { moved: result.moved };
  });
  handle('installs:checkUpdates', async () => {
    const recs = Object.values(store.get('installs')).filter((r) => r.postId);
    const posts = await site.postsByIds(recs.filter((r) => r.postId > 0).map((r) => r.postId));
    return posts.filter((p) => {
      const rec = recs.find((r) => r.postId === p.id);
      return rec && rec.siteModified && new Date(p.modified) > new Date(rec.siteModified);
    }).map((p) => ({ ...p, installedTitle: recs.find((r) => r.postId === p.id).title }));
  });
  handle('installs:uninstall', async (key) => {
    const rec = store.get('installs')[key];
    if (!rec) return;
    const resetJobs = () => { for (const j of jobs.values()) if (j.status === 'done' && (String(j.postId) === key || j.installed?.some((f) => rec.files.includes(f)))) { j.filesDeleted = true; j.installed = []; j.status = 'error'; j.error = null; j.note = 'Installed files removed'; emitJob(j); } };
    if (bikeSwaps.hasRecord(key)) { await bikeSwaps.removeRecord(key); for (const rel of rec.files) if (/\.pnt$/i.test(rel) && insideRootsStrict(path.resolve(modsDir(), rel)) && fs.existsSync(path.resolve(modsDir(), rel))) await shell.trashItem(path.resolve(modsDir(), rel)); store.update('installs', (all) => { const n = { ...all }; delete n[key]; return n; }); resetJobs(); send('library:changed', {}); return; }
    if (graphicsPackages.isGraphics(rec)) { await graphicsManager.uninstall(key); resetJobs(); send('library:changed', {}); return; }
    for (const f of rec.files) {
      const abs = f.startsWith('game:') ? path.join(store.get('settings').gameInstallDir, f.slice(5)) : path.join(modsDir(), f);
      if (f && fs.existsSync(abs) && (insideRootsStrict(abs) || insideGame(abs))) await shell.trashItem(abs);
    }
    store.update('installs', (all) => { const n = { ...all }; delete n[key]; return n; });
    resetJobs();
    await scan();
    send('library:changed', {});
  });

  handle('game:launch', async (opts = {}) => {
    const env = environment();
    // No launch options: the game's -testing switch makes this build quit after ~4 s (checked
    // Nov 2026), so Ride sets the bike and track in the profile and opens the game normally.
    const args = [];
    if (await profile.isGameRunning()) throw new Error('MX Bikes is already running.');
    if (opts.profile && opts.bike) await selectSavedBike(opts.profile, opts.bike);
    else if (opts.profile) await profile.activateProfile(profUserDir(), opts.profile);
    if (env.gameExe && game.launch(env.gameExe, args)) return true;
    // Fallback: Steam (launch options can be passed via the applaunch URL)
    await shell.openExternal(args.length ? `steam://run/${paths.MXB_APPID}//${encodeURIComponent(args.join(' '))}/` : `steam://rungameid/${paths.MXB_APPID}`);
    return true;
  });
  handle('open:external', (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
  handle('open:folder', (which) => {
    const s = store.get('settings');
    const map = { mods: modsDir(), user: s.gameUserDir, install: s.gameInstallDir, disabled: disabledDir() };
    const p = map[which];
    if (p) { fs.mkdirSync(p, { recursive: true }); shell.openPath(p); }
  });
}

// ---------- window ----------
function createWindow() {
  linkInbox.reset();
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWin = new BrowserWindow({
    show: !process.env.MXB_DEBUG_SHOT,
    width: Math.min(1720, area.width - 24), height: Math.min(1000, area.height - 24), minWidth: 980, minHeight: 640,
    backgroundColor: '#08090b',
    title: 'CoreMX',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#cfd3dc', height: 60 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, webviewTag: true, backgroundThrottling: !process.env.MXB_DEBUG_SHOT },
  });
  // The Ranked tab embeds mxb-ranked.com: lock embedded pages down to that site, no Node, shared login session.
  mainWin.webContents.on('will-attach-webview', (e, prefs, params) => {
    if (!/^https:\/\/(www\.)?mxb-ranked\.com\//.test(params.src || '')) { e.preventDefault(); return; }
    delete prefs.preload;
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    params.partition = 'persist:mxb';
  });
  mainWin.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) wc.loadURL(url); return { action: 'deny' }; });
  });
  mainWin.webContents.on('did-start-loading', () => linkInbox.reset());
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  mainWin.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  // Closing the main window closes the app: shut any hidden helper windows (e.g. the mxb-ranked reader)
  // so they can't keep it running invisibly in the background.
  mainWin.on('closed', () => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
    rankedWin = null;
    mainWin = null;
  });
  if (process.env.MXB_DEBUG_SHOT) debugShots();
}

// Dev-only: run scripted steps in the renderer and save screenshots (MXB_DEBUG_SHOT=dir, MXB_DEBUG_STEPS=json file).
async function debugShots() {
  const outDir = process.env.MXB_DEBUG_SHOT;
  const steps = process.env.MXB_DEBUG_STEPS ? JSON.parse(fs.readFileSync(process.env.MXB_DEBUG_STEPS, 'utf8')) : [{ wait: 4000, shot: 'main' }];
  mainWin.webContents.on('console-message', (e) => { const m = e.message || ''; if (/error/i.test(m) || e.level === 'error' || e.level === 3) fs.appendFileSync(path.join(outDir, 'console.log'), m + '\n'); });
  await new Promise((r) => mainWin.webContents.once('did-finish-load', r));
  for (const s of steps) {
    if (s.js) { try { const v = await mainWin.webContents.executeJavaScript(s.js); if (v !== undefined) fs.appendFileSync(path.join(outDir, 'console.log'), `[js] ${JSON.stringify(v).slice(0, 4000)}\n`); } catch (e) { fs.appendFileSync(path.join(outDir, 'console.log'), `[js error] ${e.message}\n`); } }
    if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
    if (s.shot) { const img = await mainWin.webContents.capturePage(); fs.writeFileSync(path.join(outDir, s.shot + '.png'), img.toPNG()); }
  }
  if (!process.env.MXB_DEBUG_KEEP) app.quit();
}

// mxbm:// links (see src/lib/deeplink.js): join a server, install a mod from the website, install an OEM pack.
const deeplink = require('./src/lib/deeplink');
const linkInbox = deeplink.createInbox((link) => send('deeplink:open', link));
linkInbox.push(deeplink.fromArgv(process.argv));
if (!process.env.MXB_DEBUG_SHOT) {
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on('second-instance', (_e, argv) => {
    const l = deeplink.fromArgv(argv);
    if (!mainWin || mainWin.isDestroyed()) {
      // Window was closed but the app was still running: open a fresh one
      linkInbox.reset();
      linkInbox.push(l);
      if (app.isReady()) createWindow();
      return;
    }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show(); mainWin.focus();
    linkInbox.push(l);
  });
  try {
    if (process.defaultApp) app.setAsDefaultProtocolClient('mxbm', process.execPath, [path.resolve(process.argv[1] || '.')]);
    else app.setAsDefaultProtocolClient('mxbm');
  } catch {}
}
ipcMain.handle('deeplink:ready', () => linkInbox.ready());

app.whenReady().then(async () => {
  store = new Store(path.join(app.getPath('userData'), 'data.json'), { settings: {}, installs: {}, images: {}, favorites: [], servers: [], friends: [] });
  thumbs = new Thumbs(path.join(app.getPath('userData'), 'thumbs'), () => Object.values(store.get('images')));
  await thumbs.prune().catch(() => {});
  initSettings();
  updates = appUpdates.create({ updater: require('electron-updater').autoUpdater, packaged: app.isPackaged && !process.env.MXB_DEBUG_SHOT, version: app.getVersion(), notify: (state) => send('app:update', state) });
  setTimeout(() => updates.start(), 2500).unref();
  // Repair this manager's previous accessory routing before online sync can use it.
  if (!await profile.isGameRunning()) await repairGearFolders().catch((e) => console.warn('Gear folder repair:', e.message));
  await reconcileInstallRecords();
  setupDownloadsSession();
  protocol.handle('mxb', handleImage);
  registerIpc();
  // Clear this app's scratch downloads before the window can accept new jobs.
  await fsp.rm(path.join(app.getPath('userData'), 'staging'), { recursive: true, force: true }).catch(() => {});
  createWindow();
  watchFrostList();
  online = onlineSvc.create({
    store, appDir: app.isPackaged ? process.resourcesPath : __dirname,
    userDir: () => userDir(), installDir: () => store.get('settings').gameInstallDir,
    isGameRunning: () => profile.isGameRunning(),
    steamId: () => { const s = steam.detect(paths.steamRoot()); return s.found ? s.steamId : null; },
    steamName: () => { const s = steam.detect(paths.steamRoot()); return s.found ? s.name || '' : ''; },
    modsDir: () => modsDir(),
    ...onlineConfig(),
    // The outfit you're riding: your profile's current bike (what the game will put you on).
    currentOutfit: async () => {
      const list = await profile.listProfiles(profUserDir());
      if (!list.last) return null;
      const prof = await profile.readProfile(profUserDir(), list.last);
      const bike = profile.currentBike(prof);
      // A purchase from a shop is personal to that account.  Keep those paths
      // out of peer sync even when the file itself is readable locally.
      const protectedPaths = Object.values(store.get('installs'))
        .filter((r) => r.shopKey || /mxbikes-shop|mxb-hub/i.test(String(r.link || '')))
        .flatMap((r) => r.files || []);
      return bike ? { prof, bike, bikeName: bike, protectedPaths, appearance: bikeSwaps.shared(bike) } : null;
    },
    resolveServerAddress: async (name) => {
      const matches = [...((await knownServerAddresses()).get(serverNameKey(name)) || [])];
      return matches.length === 1 ? matches[0] : null;
    },
    // Whether a model a friend's paint needs is installed (bike / helmet / boots / protection).
    haveMod: async (n) => {
      if (n.kind === 'bike') return !!(lastScan && lastScan.items.some((i) => !i.disabled && i.group === 'bikes' && i.name === n.name)) || fs.existsSync(path.join(modsDir(), 'bikes', n.name + '.pkz'));
      const sub = { rider: 'riders', helmet: 'helmets', boots: 'boots', protection: 'protections' }[n.kind];
      if (!sub) return true;
      return gearAssets.hasModel({ modsDir: modsDir(), rider: n.rider || 'default_mx', stockPkz: stockRiderPkz() }, sub, n.name);
    },
    onInstalled: async () => { await scan(); send('library:changed', {}); },
    onChange: (st) => send('online:status', st),
  });
  online.start();
  watchPluginFiles();
  ensureDiscoveryPlugin().catch((e) => console.warn('Address discovery setup:', e.message));
  setInterval(() => ensureDiscoveryPlugin().catch(() => {}), 30000).unref();
});

app.on('window-all-closed', () => { if (online) online.stop(); store && store.flush(); app.quit(); });
app.on('will-quit', () => modelWorkers.dispose());
