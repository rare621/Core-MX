'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const pluginName = (name) => typeof name === 'string' && /^[^\\/:*?"<>|]+\.dlo$/i.test(name) && !name.startsWith('.');
function locations(gameDir, name) {
  if (!gameDir || !pluginName(name)) throw new Error('Invalid game plugin path.');
  const root = path.resolve(gameDir);
  return {
    active: path.join(root, 'plugins', name),
    disabled: path.join(root, 'plugins_disabled (CoreMX)', name),
  };
}
async function regularFile(file) {
  const info = await fsp.lstat(file).catch((error) => {
    if (error.code === 'ENOENT') throw new Error('Plugin file is missing. Refresh the list.');
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Plugin is not a regular file.');
}
async function safeDirectory(dir) {
  const parent = path.dirname(dir);
  const parentInfo = await fsp.lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('Plugin folder is not a regular folder.');
  const info = await fsp.lstat(dir).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Plugin folder is not a regular folder.');
}
async function list(gameDir, records = {}) {
  if (!gameDir) return [];
  const found = [], seen = new Set();
  for (const [dir, enabled] of [[path.join(gameDir, 'plugins'), true], [path.join(gameDir, 'plugins_disabled (CoreMX)'), false]]) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !pluginName(entry.name) || seen.has(entry.name.toLowerCase())) continue;
      seen.add(entry.name.toLowerCase());
      const record = Object.entries(records).find(([, rec]) => (rec.files || []).some((file) => file.toLowerCase() === `game:plugins/${entry.name.toLowerCase()}`));
      found.push({ name: entry.name, title: record?.[1].title || entry.name.replace(/\.dlo$/i, ''), path: path.join(dir, entry.name), enabled, managed: !!record, recordKey: record?.[0] || '' });
    }
  }
  return found;
}
async function setEnabled(gameDir, name, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid plugin state.');
  const paths = locations(gameDir, name);
  const source = enabled ? paths.disabled : paths.active;
  const destination = enabled ? paths.active : paths.disabled;
  await safeDirectory(path.dirname(source));
  await safeDirectory(path.dirname(destination));
  await regularFile(source);
  if (fs.existsSync(destination)) throw new Error('A plugin with this name already exists in the destination.');
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.rename(source, destination);
  return { name, enabled };
}
function revealPath(gameDir, name) {
  const paths = locations(gameDir, name);
  return fs.existsSync(paths.active) ? paths.active : paths.disabled;
}
module.exports = { list, setEnabled, revealPath };
