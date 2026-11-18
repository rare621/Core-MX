'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function roots(gameDir, modsDir, disabledModsDir) {
  return {
    game: {
      active: gameDir && path.join(gameDir, 'rider', 'animations', 'mx'),
      disabled: gameDir && path.join(gameDir, 'rider', 'animations_disabled (CoreMX)', 'mx'),
    },
    mods: {
      active: modsDir && path.join(modsDir, 'rider', 'animations'),
      disabled: disabledModsDir && path.join(disabledModsDir, 'rider', 'animations'),
    },
  };
}
function parseId(id) {
  const match = String(id || '').match(/^(game|mods):(.+)$/);
  if (!match || match[2].split('/').some((part) => !part || part === '.' || part === '..' || !/^[^\\/:*?"<>|]+$/.test(part)) || !/\.(?:anm|pkz)$/i.test(match[2])) throw new Error('Invalid animation file.');
  return { location: match[1], rel: match[2] };
}
async function assertSafe(root, file) {
  if (!root || !path.resolve(file).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep)) throw new Error('Animation path is outside its folder.');
  for (let current = path.resolve(file); current.startsWith(path.resolve(root)); current = path.dirname(current)) {
    const info = await fsp.lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new Error('Linked animation paths cannot be changed.');
    if (current === path.resolve(root)) break;
  }
}
async function findFiles(root, prefix = '', depth = 0) {
  if (!root || depth > 4) return [];
  const entries = await fsp.readdir(path.join(root, prefix), { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await findFiles(root, rel, depth + 1));
    else if (entry.isFile() && /\.(?:anm|pkz)$/i.test(entry.name)) files.push(rel);
    if (files.length >= 500) break;
  }
  return files;
}
async function list(gameDir, modsDir, disabledModsDir, records = {}) {
  const paths = roots(gameDir, modsDir, disabledModsDir), found = [];
  for (const [location, pair] of Object.entries(paths)) {
    const seen = new Set();
    for (const [state, root] of Object.entries(pair)) {
      for (const rel of await findFiles(root)) {
        if (seen.has(rel.toLowerCase())) continue;
        seen.add(rel.toLowerCase());
        const key = location === 'game' ? `game:rider/animations/mx/${rel}` : `rider/animations/${rel}`;
        const record = Object.entries(records).find(([, rec]) => (rec.files || []).some((file) => file.toLowerCase() === key.toLowerCase()));
        found.push({ id: `${location}:${rel}`, name: path.basename(rel), title: record?.[1].title || path.basename(rel).replace(/\.(?:anm|pkz)$/i, '').replace(/[_-]+/g, ' '), location, path: path.join(root, rel), enabled: state === 'active', recordKey: record?.[0] || '' });
      }
    }
  }
  return found;
}
function filePath(gameDir, modsDir, disabledModsDir, id, enabled) {
  const { location, rel } = parseId(id);
  const root = roots(gameDir, modsDir, disabledModsDir)[location][enabled ? 'active' : 'disabled'];
  if (!root) throw new Error('MX Bikes folder is not configured.');
  return { root, file: path.join(root, ...rel.split('/')) };
}
async function setEnabled(gameDir, modsDir, disabledModsDir, id, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid animation state.');
  const from = filePath(gameDir, modsDir, disabledModsDir, id, !enabled);
  const to = filePath(gameDir, modsDir, disabledModsDir, id, enabled);
  await assertSafe(from.root, from.file);
  await assertSafe(to.root, to.file);
  const info = await fsp.lstat(from.file).catch((error) => { if (error.code === 'ENOENT') throw new Error('Animation file is missing. Refresh the list.'); throw error; });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Animation is not a regular file.');
  if (fs.existsSync(to.file)) throw new Error('An animation with this name already exists in the destination.');
  await fsp.mkdir(path.dirname(to.file), { recursive: true });
  await fsp.rename(from.file, to.file);
  return { id, enabled };
}

module.exports = { list, setEnabled, filePath, assertSafe };
