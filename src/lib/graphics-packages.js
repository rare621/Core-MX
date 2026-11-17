// Keep inactive graphics packages outside the game folder. Switching moves only
// recorded files and restores originals, so shared shader filenames cannot mix.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { filesMatch } = require('./file-verify');

async function moveAcrossDevices(from, to, rename = fsp.rename) {
  try { await rename(from, to); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    let copied = false;
    try {
      await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL); copied = true;
      if (!await filesMatch([{ abs: from, dest: path.basename(to), size: (await fsp.stat(from)).size }], path.dirname(to))) throw new Error('Graphics file copy could not be verified');
      await fsp.unlink(from);
    } catch (e) { if (copied) await fsp.unlink(to).catch(() => {}); throw e; }
  }
}

const isGraphics = (rec) => (rec?.kind === 'graphics' || !rec?.kind) && (rec?.files || []).some((f) => f.startsWith('game:'));
function inside(root, relative) {
  if (!root || !relative || /[\0:]/.test(relative) || path.isAbsolute(relative) || relative.split(/[\\/]/).some((p) => p === '..' || !p)) throw new Error('Invalid graphics file path');
  const base = path.resolve(root), absolute = path.resolve(base, relative);
  if (!absolute.toLowerCase().startsWith(base.toLowerCase() + path.sep)) throw new Error('Graphics file is outside its folder');
  let p = absolute;
  while (p !== base) {
    try { if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Graphics paths cannot contain links'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    p = path.dirname(p);
  }
  return absolute;
}
const exists = (p) => fsp.stat(p).then((s) => s.isFile()).catch(() => false);

function create({ gameDir, cacheDir, records, save, trash, isGameRunning, transfer = moveAcrossDevices }) {
  let queue = Promise.resolve();
  const locked = (fn) => { const next = queue.catch(() => {}).then(async () => { if (await isGameRunning()) throw new Error('Close MX Bikes before changing graphics mods'); return fn(); }); queue = next; return next; };
  const cache = (key) => path.join(cacheDir(), crypto.createHash('sha256').update(key).digest('hex'));
  const files = (rec) => [...new Set(rec.files.filter((f) => f.startsWith('game:')).map((f) => f.slice(5)))];
  const active = () => Object.entries(records()).filter(([, r]) => isGraphics(r) && r.graphicsActive !== false).sort((a, b) => (b[1].installedAt || 0) - (a[1].installedAt || 0));
  function owners() {
    const map = new Map();
    for (const [key, rec] of active()) for (const rel of files(rec)) if (!map.has(rel.toLowerCase())) map.set(rel.toLowerCase(), key);
    return map;
  }
  async function move(from, to, undo) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    if (await exists(to)) throw new Error('A graphics file already exists at the destination');
    await transfer(from, to);
    undo.push(async () => { await fsp.mkdir(path.dirname(from), { recursive: true }); await transfer(to, from); });
  }
  async function transaction(fn) {
    const undo = [];
    try { return await fn(undo); }
    catch (e) { for (const reverse of undo.reverse()) await reverse().catch(() => {}); throw e; }
  }
  async function actualFile(rel) {
    const parts = rel.split('/');
    const candidates = [rel, rel + '.off'];
    for (let i = 0; i < parts.length - 1; i++) { const changed = [...parts]; changed[i] += ' (off)'; candidates.push(changed.join('/'), changed.join('/') + '.off'); }
    for (const candidate of candidates) { const p = inside(gameDir(), candidate); if (await exists(p)) return p; }
    return null;
  }
  async function deactivate(key, ownership = owners()) {
    const rec = records()[key];
    if (!isGraphics(rec) || rec.graphicsActive === false) return;
    await transaction(async (undo) => {
      for (const rel of files(rec)) {
        if (ownership.get(rel.toLowerCase()) !== key) continue;
        const original = inside(gameDir(), rel), saved = inside(cache(key), rel), current = await actualFile(rel);
        if (current) await move(current, saved, undo);
        const backup = inside(gameDir(), rel + '.mxbm-bak');
        if (await exists(backup) && !await exists(original)) await move(backup, original, undo);
      }
      save({ ...records(), [key]: { ...rec, graphicsActive: false } });
    });
  }
  async function activate(key) {
    const rec = records()[key];
    if (!isGraphics(rec)) throw new Error('Graphics package not found');
    if (rec.graphicsActive !== false) return;
    // Check first, before disabling the working package.
    for (const rel of files(rec)) if (!await exists(inside(cache(key), rel))) throw new Error(`This older package is missing ${rel}. Reinstall it before enabling.`);
    const previous = active();
    const ownership = owners();
    for (const [other] of previous) await deactivate(other, ownership);
    try {
      await transaction(async (undo) => {
        for (const rel of files(rec)) {
          const original = inside(gameDir(), rel), backup = inside(gameDir(), rel + '.mxbm-bak');
          if (await exists(original)) await move(original, backup, undo);
          await move(inside(cache(key), rel), original, undo);
        }
        save({ ...records(), [key]: { ...rec, graphicsActive: true } });
      });
    } catch (e) { if (previous[0]) await activate(previous[0][0]).catch(() => {}); throw e; }
  }
  async function removeCache(key) {
    const dir = cache(key);
    const safe = inside(cacheDir(), path.basename(dir));
    if (fs.existsSync(safe)) await trash(safe);
  }
  return {
    setActive: (key, enabled) => locked(async () => {
      if (!isGraphics(records()[key])) throw new Error('Graphics package not found');
      if (enabled) {
        if (records()[key]?.graphicsActive !== false) {
          const ownership = owners();
          for (const [other] of active()) if (other !== key) await deactivate(other, ownership);
        } else await activate(key);
      } else await deactivate(key);
    }),
    uninstall: (key) => locked(async () => {
      if (!isGraphics(records()[key])) throw new Error('Graphics package not found');
      await deactivate(key);
      await removeCache(key);
      const next = { ...records() }; delete next[key]; save(next);
    }),
    install: (plan, key, applyAndRecord) => locked(async () => {
      const entries = plan.entries.filter((e) => e.dest);
      // Validate every destination before touching the working package.
      for (const e of entries) inside(gameDir(), e.dest);
      const previous = active(), ownership = owners();
      for (const [other] of previous) await deactivate(other, ownership);
      const before = new Map(await Promise.all(entries.map(async (e) => [e.dest, await exists(inside(gameDir(), e.dest))])));
      try {
        const written = await applyAndRecord();
        save({ ...records(), [key]: { ...records()[key], graphicsActive: true } });
        // An update to this same package supersedes its previous cached files.
        await removeCache(key).catch(() => {});
        return written;
      } catch (e) {
        for (const entry of entries) {
          const file = inside(gameDir(), entry.dest), backup = inside(gameDir(), entry.dest + '.mxbm-bak');
          if (await exists(backup)) { if (await exists(file)) await trash(file); await fsp.rename(backup, file); }
          else if (!before.get(entry.dest) && await exists(file)) await trash(file);
        }
        if (previous[0]) await activate(previous[0][0]).catch(() => {});
        throw e;
      }
    }),
  };
}
module.exports = { create, isGraphics, moveAcrossDevices };
