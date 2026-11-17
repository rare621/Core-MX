// Verify ownership before removing an installed game plugin. Creators often
// ask users to delete a .dlo but keep presets, settings or other plugins.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function pluginPath(gameDir, recorded) {
  if (!gameDir || !/^game:plugins\//i.test(recorded)) return null;
  const rel = recorded.slice(5).replace(/\\/g, '/');
  if (rel.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':'))) return null;
  const root = path.resolve(gameDir), file = path.resolve(root, ...rel.split('/'));
  if (!file.toLowerCase().startsWith(root.toLowerCase() + path.sep)) return null;
  for (let current = file; current !== root; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) return null; }
    catch (error) { if (error.code !== 'ENOENT') return null; }
  }
  return file;
}

async function removeOwned({ key, record, records, gameDir, trash }) {
  const shared = new Set(Object.entries(records).filter(([other]) => other !== key).flatMap(([, rec]) => rec.files || []).map((file) => file.toLowerCase()));
  const kept = [], removed = [];
  for (const rel of record.files || []) {
    const file = pluginPath(gameDir, rel), expected = record.hashes?.[rel];
    if (!file || !expected || shared.has(rel.toLowerCase())) { kept.push(rel); continue; }
    try {
      if (await digest(file) !== expected) { kept.push(rel); continue; }
      await trash(file);
      const backup = file + '.mxbm-bak';
      if (fs.existsSync(backup)) await fsp.rename(backup, file);
      removed.push(rel);
    } catch (error) {
      if (error.code === 'ENOENT') removed.push(rel);
      else kept.push(rel);
    }
  }
  return { kept, removed };
}

module.exports = { digest, pluginPath, removeOwned };
