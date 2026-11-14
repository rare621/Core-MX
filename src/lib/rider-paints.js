const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const profile = require('./profile');
const gear = require('./gear-assets');
const { chainOf, readChain } = require('./asset-sources');
const { openArchive } = require('./assetread');
const { zip, MAX_FILE } = require('./gear-sync');

async function remove({ modsDir, current, bike, slot, value, trash }) {
  if (!profile.SLOTS.some((s) => s.id === slot && /Paint$/.test(s.id)) || !gear.validName(value)) throw new Error('Choose an installed paint to delete');
  let data;
  if (slot === 'bikePaint') {
    const dir = await profile.findBikeDir(modsDir, bike);
    data = dir && await readChain(await chainOf([{ dir }]), `paints/${value}.pnt`);
  } else data = await gear.paintSource({ modsDir, rider: current.rider || 'default_mx' }, slot, { ...current, [slot]: value });
  if (!data) throw new Error('This paint was not found in your mods folder');
  const root = await fs.realpath(modsDir);
  const target = await fs.realpath(data.path || data.archivePath);
  if (!target.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error('Game-provided paints cannot be deleted here');
  if (data.path) { await trash(target); return; }
  const archive = await openArchive(target);
  const files = []; let size = 0;
  for (const entry of archive.entries) {
    if (entry.fileName === data.entry || entry.fileName.endsWith('/')) continue;
    if ((size += entry.uncompressedSize) > MAX_FILE || files.length > 1000) throw new Error('This package is too large to edit safely');
    files.push([entry.fileName, await archive.read(entry)]);
  }
  const updated = zip(files);
  const temp = target + '.mxbm-' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try {
    await fs.writeFile(temp, updated, { flag: 'wx' });
    await trash(target); // The complete original package remains recoverable in the Recycle Bin.
    await fs.rename(temp, target);
  } finally { await fs.rm(temp, { force: true }); }
}
module.exports = { remove };
