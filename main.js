const { app, BrowserWindow, ipcMain, protocol, shell, dialog, session, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { Store } = require('./src/lib/store');
const paths = require('./src/lib/paths');
const scanner = require('./src/lib/scanner');
const { Thumbs } = require('./src/lib/thumbs');
const site = require('./src/lib/site');
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
const paintCompat = require('./src/lib/paint-compat');
let online = null;
// online.config.json next to the app: { "serviceUrl": "http://<server PC>:8787" } — the service
// everyone's app connects to without asking.
function stockRiderPkz() { const inst = store.get('settings').gameInstallDir; return inst ? path.join(inst, 'rider.pkz') : null; }
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
function insideGame(p) {
  const g = store.get('settings').gameInstallDir;
  return !!g && path.resolve(p).toLowerCase().startsWith(path.resolve(g).toLowerCase() + path.sep);
}

app.setName('MX Bikes Manager');
// Test-only overrides: isolated app data and a fake game folder.
if (process.env.MXB_USERDATA) app.setPath('userData', process.env.MXB_USERDATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'mxb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let mainWin = null;
let store, thumbs, ses;
let lastScan = { items: [] };
const jobs = new Map();
const browserJobs = new Map(); // webContents id -> job id

// ---------- paths ----------
function userDir() { return store.get('settings').gameUserDir; }
// Test-only: read/write profiles from a copy instead of the real game folder.
function profUserDir() { return process.env.MXB_PROFILES_ROOT || userDir(); }
function modsDir() { return path.join(userDir(), 'mods'); }
function disabledDir() { return path.join(userDir(), 'mods_disabled (MX Bikes Manager)'); }
function rootFor(disabled) { return disabled ? disabledDir() : modsDir(); }
function insideRoots(p) {
  const n = path.resolve(p).toLowerCase();
  return [modsDir(), disabledDir()].some((r) => n === path.resolve(r).toLowerCase() || n.startsWith(path.resolve(r).toLowerCase() + path.sep));
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
      const hit = idx.find(([f]) => f === p || (f.startsWith(p + '/') && !/\/(paints|goggles)\//.test(f.slice(p.length))));
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
      try { await shell.trashItem(abs); } catch (e) { errors.push(`${it.title}: ${e.message}`); }
    }
  }
  return { errors };
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
    createdAt: j.createdAt, installed: j.installed, filesDeleted: !!j.filesDeleted, modelWarningAccepted: !!j.modelWarningAccepted,
    plan: p && {
      kind: p.kind, kindLabel: p.kindLabel, base: p.base, askType: p.askType, kindHint: p.kindHint, detectReason: p.detectReason, options: p.options, paintModels: p.paintModels,
      paintModelsBase: p.paintModelsBase, paintGuess: p.paintGuess, counts: p.counts, installable: p.installable,
      paintModelInfo: p.paintModelsBase === 'bikes' ? p.paintModels.map((name) => ({ name, brand: scanner.detectBrand(name), cc: scanner.detectCC(name), bikeClass: scanner.detectClass(name) })) : [],
      warnings: p.warnings, confident: p.confident, kinds: p.kinds, trackTypes: p.trackTypes,
      requiredModels: p.requiredModels, dependencies: p.dependencies, needsPaintTarget: p.needsPaintTarget, riderModels: p.riderModels, needsRiderTarget: p.needsRiderTarget, requiresModelWarning: p.requiresModelWarning,
      entries: p.entries.slice(0, 500).map((e) => ({ rel: e.rel, dest: e.dest, status: e.status, size: e.size })),
      totalEntries: p.entries.length,
    },
  };
}
function emitJob(j) { send('jobs:update', jobView(j)); }

function newJob(fields) {
  const id = crypto.randomUUID();
  const stageDir = path.join(app.getPath('userData'), 'staging', id);
  const j = { id, status: 'queued', received: 0, total: 0, createdAt: Date.now(), stageDir, abort: new AbortController(), ...fields };
  jobs.set(id, j);
  emitJob(j);
  return j;
}

async function runDownload(j) {
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
  j.status = 'error'; j.error = e.message || String(e); emitJob(j);
  cleanupStage(j);
}

async function afterDownload(j, file) {
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
    j.plan = installer.plan(j.files, j.ctx, j.opts || {});
    if (j.plan.requiresModelWarning) j.requireReview = true;
    // Already have exactly these files? Don't install a second copy.
    const placed = j.plan.entries.filter((e) => e.dest);
    const targetRoot = j.plan.root === 'game' ? store.get('settings').gameInstallDir : modsDir();
    if (!j.plan.counts.unresolved && await filesMatch(placed, targetRoot)) {
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
    const written = (await installer.apply(j.plan, j.plan.root === 'game' ? store.get('settings').gameInstallDir : modsDir())).map((w) => (j.plan.root === 'game' ? 'game:' : '') + w);
    if (!written.length) throw new Error('Nothing was installed: no file had a destination.');
    recordInstall(j, written);
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

function recordInstall(j, written) {
  const key = j.postId ? String(j.postId) : j.shopKey || 'local:' + crypto.createHash('sha1').update(j.title + written[0]).digest('hex').slice(0, 12);
  store.update('installs', (all) => {
    const prev = all[key];
    all[key] = {
      postId: j.postId || null, shopKey: j.shopKey || null, title: j.title, link: j.link || null, image: j.image || null,
      categories: j.categories || [], siteModified: j.modified || null, installedAt: Date.now(),
      source: j.url || j.file, kind: j.plan && j.plan.kind, files: Array.from(new Set([...(prev ? prev.files : []), ...written])),
    };
    return all;
  });
}

function cleanupStage(j) {
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
    if (j.status === 'browser') { j.status = 'error'; j.error = 'Browser window closed before a file was downloaded.'; emitJob(j); }
  });
  win.loadURL(url);
}

// Tell the window when FrostMod writes a new server list (each time the in-game browser refreshes).
const frostWatched = new Set();
function watchFrostList() {
  for (const p of frostmod.listCandidates(store.get('settings').gameInstallDir, userDir())) {
    if (frostWatched.has(p)) continue;
    frostWatched.add(p);
    fs.watchFile(p, { interval: 3000 }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) send('frostmod:list', {}); });
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
  return { name, ...ranked.parseDetails(lines, raw.imgs), lines: lines.slice(0, 200) };
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
      j = newJob({ title: item.getFilename().replace(/\.[^.]+$/, ''), url: null });
      send('jobs:started', j.id);
    }
    const dir = path.join(j.stageDir, 'dl');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, hosts.safeName(item.getFilename()));
    j.file = file;
    item.setSavePath(file);
    j.status = 'downloading'; j.note = 'Downloading from browser…'; emitJob(j);
    item.on('updated', () => { j.received = item.getReceivedBytes(); j.total = item.getTotalBytes(); emitJob(j); });
    item.once('done', (_e, state) => {
      if (j.browserWin && !j.browserWin.isDestroyed()) { j.status = 'extracting'; j.browserWin.close(); }
      if (state === 'completed') afterDownload(j, file);
      else fail(j, new Error(`Browser download ${state}`));
    });
  });
}

// ---------- IPC ----------
function handle(ch, fn) { ipcMain.handle(ch, async (_e, ...args) => fn(...args)); }

function registerIpc() {
  handle('app:env', () => environment());
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
  handle('library:trashFile', async (p) => { if (insideRoots(p)) await shell.trashItem(p); });
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
  handle('site:search', (q) => site.search(q));
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
  handle('site:post', async (id) => {
    const post = await site.post(id), rec = store.get('installs')[id];
    if (rec) {
      const files = [];
      for (const rel of rec.files.filter((f) => /\.pnt$/i.test(f) && !f.startsWith('game:'))) {
        const abs = path.resolve(modsDir(), rel);
        if (!insideRoots(abs)) continue;
        try { files.push({ rel, abs, size: (await fsp.stat(abs)).size }); } catch {}
      }
      const info = await paintCompat.inspect(files, modsDir(), stockRiderPkz(), rec.kind || 'custom');
      if (info.bodyPaintTextures.length && !info.riderModels.some((m) => info.bodyPaintTextures.every((t) => m.textures.includes(t)))) {
        post.missingModelTextures = info.bodyPaintTextures.filter((t) => !['rider', 'gloves', 'skin'].includes(t));
        post.dependencies = [...post.dependencies, ...info.dependencies];
      }
    }
    const dependencyKey = (url) => { try { return new URL(url).pathname.split('/').filter(Boolean).pop()?.toLowerCase(); } catch { return null; } };
    const records = Object.values(store.get('installs'));
    const paintListing = post.categories.some((c) => [127, 126, 135, 35, 309].includes(c)) && !post.categories.some((c) => [313, 343, 344, 365].includes(c));
    if (paintListing) post.modelDependencies = post.dependencies.filter((d) => /model|helmet|boot|hoodie|protection|rider/i.test(d.label + ' ' + d.url) && !/psd|template/i.test(d.label + ' ' + d.url)).map((d) => {
      const installed = records.some((r) => dependencyKey(r.link) === dependencyKey(d.url) && r.files.some((f) => /\.(pkz|edf)$/i.test(f) && !f.startsWith('game:') && fs.existsSync(path.join(modsDir(), f))));
      return { ...d, installed: installed ? true : null };
    });
    const hoodie = post.dependencies.find((d) => /\/rider-hoodie-abdesigns\/?(?:[?#].*)?$/.test(d.url));
    if (hoodie) {
      const models = await paintCompat.riderModels(modsDir(), stockRiderPkz());
      post.modelDependencies = [...(post.modelDependencies || []).filter((d) => d.url !== hoodie.url), { label: 'AB-HOODIE rider model', url: hoodie.url, installed: models.some((m) => m.textures.includes('abhoodie') || m.unverified && /ab.?hoodie/i.test(m.name)) }];
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
    const installed = j.installed?.length ? j.installed : (j.plan?.entries || []).filter((e) => e.dest).map((e) => (j.plan.root === 'game' ? 'game:' : '') + e.dest);
    const removed = new Set();
    for (const file of installed) {
      const abs = file.startsWith('game:') ? path.resolve(store.get('settings').gameInstallDir, file.slice(5)) : path.resolve(modsDir(), file);
      if (!insideRoots(abs) && !insideGame(abs)) throw new Error('File is outside the mod install folders');
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
  handle('jobs:cancel', (id) => {
    const j = jobs.get(id);
    if (!j) return;
    j.abort.abort();
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
  handle('shops:cats', (id) => shops.categories(ses, id));
  handle('shops:search', (q) => shops.search(ses, q));
  handle('shops:details', (id, link) => shops.details(ses, id, link));
  handle('shops:owned', (id, force) => shops.owned(ses, id, !!force));
  handle('shops:lookup', (id, items) => shops.lookup(ses, id, items));
  handle('shops:signOut', async (id) => { await shops.signOut(ses, id); return shops.account(ses, id); });
  handle('shops:signIn', (id) => signInWindow(id));
  handle('shops:open', (id, url) => {
    const shop = shops.SHOPS[id];
    if (!shop || !String(url).startsWith(shop.url)) return;
    const win = new BrowserWindow({ width: 1200, height: 860, parent: mainWin, autoHideMenuBar: true, backgroundColor: '#111', title: shop.name, webPreferences: { partition: 'persist:mxb', contextIsolation: true, sandbox: true } });
    win.webContents.setWindowOpenHandler(({ url: u }) => { win.loadURL(u); return { action: 'deny' }; });
    win.on('closed', () => send('shops:changed', { id }));
    win.loadURL(url);
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
    if (await profile.isGameRunning()) throw new Error('MX Bikes is already running — leave your current session (or close the game) first.');
    const exe = paths.findGameExe(store.get('settings').gameInstallDir);
    if (!exe) throw new Error("Couldn't find mxbikes.exe — set the game install folder in Settings.");
    game.launch(exe, ['-directconnect', addr]);
    if (online) online.noteJoin(addr);
    return true;
  });
  // ---- graphics mods in the game folder ----
  handle('graphics:scan', async () => {
    const dir = store.get('settings').gameInstallDir;
    const r = await graphics.scan(dir);
    const recs = Object.values(store.get('installs')).filter((x) => (x.files || []).some((f) => f.startsWith('game:')));
    return { ...r, installDir: dir, installed: recs.map((x) => ({ title: x.title, image: x.image, link: x.link, files: x.files.length, installedAt: x.installedAt, key: x.postId ? String(x.postId) : x.shopKey })) };
  });
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
    return { ...s, version: store.get('settings').frostmodVersion || null };
  });
  handle('frostmod:install', async () => {
    if (await profile.isGameRunning()) throw new Error('Close MX Bikes first — the game loads plugins when it starts.');
    const r = await frostmod.install(ses, store.get('settings').gameInstallDir);
    store.update('settings', (s) => ({ ...s, frostmodVersion: r.version }));
    watchFrostList();
    return r;
  });
  handle('frostmod:uninstall', async () => {
    const p = frostmod.pluginPath(store.get('settings').gameInstallDir);
    if (p && fs.existsSync(p)) await shell.trashItem(p);
    const fl = frostmod.flagPath(store.get('settings').gameInstallDir);
    if (fl && fs.existsSync(fl)) await fsp.rm(fl, { force: true });
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
  handle('online:servers', () => online.servers());
  handle('online:friends', async () => {
    const friends = await online.syncFriends();
    if (!friends.some((f) => f.online && f.server && !f.address)) return friends;
    const known = [...(store.get('servers') || [])];
    let latest = null;
    for (const file of frostmod.listCandidates(store.get('settings').gameInstallDir, userDir())) {
      try {
        if ((await fsp.stat(file)).size > 512 * 1024) continue;
        const parsed = frostmod.parse(await fsp.readFile(file, 'utf8'));
        if (parsed && (!latest || parsed.at > latest.at)) latest = parsed;
      } catch {}
    }
    if (latest && Date.now() - latest.at < 6 * 3600 * 1000) known.push(...latest.servers);
    return friends.map((f) => {
      if (!f.online || !f.server || f.address) return f;
      const matches = [...new Set(known.filter((s) => s.name.trim().toLowerCase() === f.server.trim().toLowerCase()).map((s) => s.address).filter(Boolean))];
      return matches.length === 1 ? { ...f, address: matches[0] } : f;
    });
  });
  handle('online:paintSync', (on) => online.setPaintSync(on));
  handle('online:paintSyncNow', (friendId) => online.syncPaints(friendId));
  handle('online:friendLoadout', (friendId) => online.friendLoadout(friendId));
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
      if (!p || !store.get('settings').gameInstallDir || !path.resolve(p).toLowerCase().startsWith(path.resolve(store.get('settings').gameInstallDir).toLowerCase())) throw new Error('Not in the game folder');
      await fsp.rename(p, p + '.off');
    } else if (issue.fixId === 'trash') {
      if (!insideRoots(issue.path)) throw new Error('Not in the mods folder');
      await shell.trashItem(issue.path);
    } else if (issue.fixId === 'disable-items') {
      const r = await setEnabled(issue.itemIds || [], false);
      if (r.errors.length) throw new Error(r.errors.slice(0, 3).join('\n'));
    } else if (issue.fixId === 'trash-items') {
      if (await profile.isGameRunning()) throw new Error('Close MX Bikes before removing old gear files');
      const allowed = (issue.itemIds || []).filter((id) => { const it = findItem(id); return it && it.group === 'rider' && it.parts.some((p) => /^rider\/(helmets|boots|boots paints|paints|gloves|protections|goggles)\//i.test(p)); });
      const result = await trash(allowed);
      if (result.errors.length) throw new Error(result.errors.slice(0, 3).join('\n'));
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
  handle('rider:profiles', () => profile.listProfiles(profUserDir()));
  handle('rider:createProfile', (name, source, copyGear) => profile.createProfile(profUserDir(), name, source, copyGear !== false));
  handle('rider:activateProfile', (name) => profile.activateProfile(profUserDir(), name));
  handle('rider:bikes', async (name) => profile.listBikes(modsDir(), await profile.readProfile(profUserDir(), name)));
  handle('rider:loadout', async (name, bike) => {
    const lo = await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), name), bike, stockRiderPkz());
    const bikeDir = await profile.findBikeDir(modsDir(), bike);
    const packed = await bike3d.paints({ modsDir: modsDir(), installDir: store.get('settings').gameInstallDir, bike, bikeDir }).catch(() => []);
    lo.options.bikePaint = [...new Set(['', ...lo.options.bikePaint, ...packed])];
    lo.profileActive = (await profile.listProfiles(profUserDir())).last === name;
    lo.selectedInGame = lo.selectedInGame && lo.profileActive;
    return lo;
  });
  handle('bike:model', async (name, bike, paint, texMax = 1024) => {
    if (typeof bike !== 'string' || /[\\/]|^\.+$/.test(bike)) throw new Error('Invalid bike name');
    if (paint == null) {
      const selected = name || (await profile.listProfiles(profUserDir())).last;
      const lo = selected && await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), selected), bike);
      paint = lo && lo.current.bikePaint || '';
    }
    return bike3d.build({ modsDir: modsDir(), installDir: store.get('settings').gameInstallDir, bike,
      bikeDir: await profile.findBikeDir(modsDir(), bike), paint, texMax: Math.min(1024, Math.max(128, Number(texMax) || 1024)) });
  });
  handle('rider:deleteModel', async (model) => {
    await deleteRiderModel(model);
    await scan(); send('library:changed', {});
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
    if (lo.current[slot] === value) await profile.saveLoadouts(profUserDir(), name, { [bike]: { [slot]: '' } });
    await scan(); send('library:changed', {}); online?.syncPaints().catch(() => {});
    return { ok: true };
  });
  handle('rider:previewModel', async (model) => {
    if (typeof model !== 'string' || /[\\/]|^\.+$/.test(model)) throw new Error('Invalid rider model');
    const inst = store.get('settings').gameInstallDir;
    return rider3d.build({ modsDir: modsDir(), gd: profile.gearDir(modsDir(), model), stockPkz: inst ? path.join(inst, 'rider.pkz') : null, current: { rider: model, helmet: 'default', boots: 'default' }, texMax: 512 });
  });
  // 3D preview of a bike's outfit. `override` previews values without saving them.
  handle('rider:model', async (name, bike, override) => {
    const lo = await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), name), bike, stockRiderPkz());
    const inst = store.get('settings').gameInstallDir;
    return rider3d.build({ modsDir: modsDir(), gd: lo.gearDir, stockPkz: inst ? path.join(inst, 'rider.pkz') : null, current: { ...lo.current, ...(override || {}) } });
  });
  // Thumbnail model for one option of one slot: only the gear that slot changes, small textures.
  const SLOT_PARTS = { helmet: ['helmet'], helmetPaint: ['helmet'], gogglesPaint: ['helmet'], suitPaint: ['body'], glovesPaint: ['body'], rider: ['body'], boots: ['boots'], bootsPaint: ['boots'], protection: ['protection'], protectionPaint: ['protection'] };
  handle('rider:thumbModel', async (name, bike, slot, value) => {
    const only = SLOT_PARTS[slot];
    if (!only) throw new Error('No 3D preview for this slot');
    const lo = await profile.loadout(modsDir(), await profile.readProfile(profUserDir(), name), bike, stockRiderPkz());
    const inst = store.get('settings').gameInstallDir;
    const cur = { ...lo.current, [slot]: value };
    if (slot === 'helmet') { cur.helmetPaint = ''; cur.gogglesPaint = ''; }
    if (slot === 'rider') { cur.suitPaint = ''; cur.glovesPaint = ''; }
    if (slot === 'boots') cur.bootsPaint = '';
    if (slot === 'protection') cur.protectionPaint = '';
    return rider3d.build({ modsDir: modsDir(), gd: profile.gearDir(modsDir(), cur.rider), stockPkz: inst ? path.join(inst, 'rider.pkz') : null, current: cur, only, texMax: 256 });
  });
  handle('rider:copyToAll', async (name, fromBike) => {
    const prof = await profile.readProfile(profUserDir(), name);
    const lo = await profile.loadout(modsDir(), prof, fromBike);
    const bikes = (await profile.listBikes(modsDir(), prof)).filter((b) => b.installed && b.id !== fromBike);
    const outfit = {};
    for (const s of profile.SLOTS) if (s.id !== 'bikePaint' && lo.current[s.id] != null) outfit[s.id] = lo.current[s.id];
    const changes = Object.fromEntries(bikes.map((b) => [b.id, outfit]));
    await profile.saveLoadouts(profUserDir(), name, changes);
    return { count: bikes.length };
  });

  handle('installs:list', () => store.get('installs'));
  handle('installs:checkUpdates', async () => {
    const recs = Object.values(store.get('installs')).filter((r) => r.postId);
    const posts = await site.postsByIds(recs.map((r) => r.postId));
    return posts.filter((p) => {
      const rec = recs.find((r) => r.postId === p.id);
      return rec && rec.siteModified && new Date(p.modified) > new Date(rec.siteModified);
    }).map((p) => ({ ...p, installedTitle: recs.find((r) => r.postId === p.id).title }));
  });
  handle('installs:uninstall', async (key) => {
    const rec = store.get('installs')[key];
    if (!rec) return;
    for (const f of rec.files) {
      const abs = f.startsWith('game:') ? path.join(store.get('settings').gameInstallDir, f.slice(5)) : path.join(modsDir(), f);
      if (fs.existsSync(abs) && (insideRoots(abs) || insideGame(abs))) await shell.trashItem(abs).catch(() => {});
    }
    store.update('installs', (all) => { const n = { ...all }; delete n[key]; return n; });
    await scan();
  });

  handle('game:launch', async (opts = {}) => {
    const env = environment();
    // No launch options: the game's -testing switch makes this build quit after ~4 s (checked
    // Nov 2026), so Ride sets the bike and track in the profile and opens the game normally.
    const args = [];
    if (await profile.isGameRunning()) throw new Error('MX Bikes is already running.');
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
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWin = new BrowserWindow({
    show: !process.env.MXB_DEBUG_SHOT,
    width: Math.min(1560, area.width - 24), height: Math.min(960, area.height - 24), minWidth: 980, minHeight: 640,
    backgroundColor: '#0b0b0d',
    title: 'MX Bikes Manager',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0b0d', symbolColor: '#cfd3dc', height: 40 },
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

// Join links: mxbm://join/ip:port opens the app (or the running one) and offers to join that server.
function deepLinkFrom(argv) {
  const a = (argv || []).find((x) => /^mxbm:\/\//i.test(x));
  const m = a && a.match(/^mxbm:\/\/join\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}
let pendingJoin = deepLinkFrom(process.argv);
if (!process.env.MXB_DEBUG_SHOT) {
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on('second-instance', (_e, argv) => {
    const j = deepLinkFrom(argv);
    if (!mainWin || mainWin.isDestroyed()) {
      // Window was closed but the app was still running: open a fresh one
      if (j) pendingJoin = j;
      if (app.isReady()) createWindow();
      return;
    }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show(); mainWin.focus();
    if (j) send('deeplink:join', j);
  });
  try {
    if (process.defaultApp) app.setAsDefaultProtocolClient('mxbm', process.execPath, [path.resolve(process.argv[1] || '.')]);
    else app.setAsDefaultProtocolClient('mxbm');
  } catch {}
}
ipcMain.handle('deeplink:pending', () => { const j = pendingJoin; pendingJoin = null; return j; });

app.whenReady().then(async () => {
  store = new Store(path.join(app.getPath('userData'), 'data.json'), { settings: {}, installs: {}, images: {}, favorites: [], servers: [], friends: [] });
  thumbs = new Thumbs(path.join(app.getPath('userData'), 'thumbs'), () => Object.values(store.get('images')));
  await thumbs.prune().catch(() => {});
  initSettings();
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
      return bike ? { prof, bike, bikeName: bike } : null;
    },
    // Whether a model a friend's paint needs is installed (bike / helmet / boots / protection).
    haveMod: async (n) => {
      if (n.kind === 'bike') return !!(lastScan && lastScan.items.some((i) => !i.disabled && i.group === 'bikes' && i.name === n.name)) || fs.existsSync(path.join(modsDir(), 'bikes', n.name + '.pkz'));
      const sub = { helmet: 'helmets', boots: 'boots', protection: 'protections' }[n.kind];
      if (n.kind === 'rider') return fs.existsSync(path.join(modsDir(), 'rider', 'riders', n.name)) || fs.existsSync(path.join(modsDir(), 'rider', 'riders', n.name + '.pkz'));
      if (!sub) return true;
      return gearAssets.hasModel({ modsDir: modsDir(), rider: n.rider || 'default_mx', stockPkz: stockRiderPkz() }, sub, n.name);
    },
    onInstalled: async () => { await scan(); send('library:changed', {}); },
    onChange: (st) => send('online:status', st),
  });
  online.start();
});

app.on('window-all-closed', () => { if (online) online.stop(); store && store.flush(); app.quit(); });
