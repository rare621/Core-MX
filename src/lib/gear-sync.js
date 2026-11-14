// Deterministic model-only packages: unused paint variants are not transferred.
const { crc32 } = require('zlib');
const { chainOf, readChain, listFiles } = require('./asset-sources');
const gear = require('./gear-assets');
const path = require('path');
const yauzl = require('yauzl');
const { decodeBlob } = require('./assetread');

const MAX_FILE = 128 * 1024 * 1024;
const modelFile = (name, kind) => typeof name === 'string' && !/^[\\/]|[\\:\0]/.test(name) && !name.split('/').some((n) => !n || n === '.' || n === '..') && (/\.(edf|hrc|cfg|ini|anm|tga|dds|png|jpe?g|bmp)$/i.test(name) || kind === 'tyres' && /\.tyre$/i.test(name)) && !/(^|\/)(paints|goggles)\//i.test(name);

function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, body] of files) {
    const filename = Buffer.from(name), h = Buffer.alloc(30), r = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6);
    h.writeUInt32LE(crc32(body), 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(body.length, 22); h.writeUInt16LE(filename.length, 26);
    r.writeUInt32LE(0x02014b50); r.writeUInt16LE(20, 4); r.writeUInt16LE(20, 6); r.writeUInt16LE(0x800, 8);
    r.writeUInt32LE(crc32(body), 16); r.writeUInt32LE(body.length, 20); r.writeUInt32LE(body.length, 24); r.writeUInt16LE(filename.length, 28); r.writeUInt32LE(offset, 42);
    local.push(h, filename, body); central.push(r, filename); offset += h.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...local, directory, end]);
  if (result.length > MAX_FILE) throw new Error('This equipped model exceeds the 128 MB sync limit');
  return result;
}

async function modelBundle({ modsDir, rider = 'default_mx', kind, name }) {
  if (!gear.validName(rider) || !gear.validName(name) || !['rider', 'helmet', 'boots', 'protection', 'tyres'].includes(kind)) return null;
  const source = kind === 'tyres' ? await chainOf([{ dir: path.join(modsDir, 'tyres', name) }]) : kind === 'rider' ? await chainOf([{ dir: path.join(modsDir, 'rider', 'riders', name) }])
    : await gear.modelSources({ modsDir, rider }, { helmet: 'helmets', boots: 'boots', protection: 'protections' }[kind], name);
  const files = []; let total = 0;
  for (const rel of (await listFiles(source)).filter((rel) => modelFile(rel, kind))) {
    if (kind === 'rider' && /^(helmets|boots|protections|gloves|goggles|paints)\//i.test(rel)) continue;
    const item = await readChain(source, rel);
    if (!item) continue;
    if (/\.edf$/i.test(rel) && decodeBlob(item.buf).toString('latin1', 0, 4) !== 'EDF\0') throw new Error('The equipped model is unreadable');
    total += item.buf.length;
    if (total > MAX_FILE || files.length >= 500) throw new Error('This equipped model is too large to sync');
    files.push([rel.toLowerCase(), item.buf]);
  }
  return files.some(([name]) => /\.edf$/i.test(name)) ? zip(files) : null;
}

function validateModel(buf, kind) {
  if (buf.length > MAX_FILE) return Promise.resolve(false);
  return new Promise((resolve) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, strictFileNames: true }, (error, archive) => {
      if (error) return resolve(false);
      let count = 0, size = 0, mesh = false;
      const fail = () => { archive.close(); resolve(false); };
      archive.on('error', fail);
      archive.on('entry', (entry) => {
        size += entry.uncompressedSize;
        if (++count > 500 || size > MAX_FILE || !modelFile(entry.fileName, kind) || entry.generalPurposeBitFlag & 1) return fail();
        if (/\.edf$/i.test(entry.fileName)) mesh = true;
        archive.readEntry();
      });
      archive.on('end', () => resolve(mesh));
      archive.readEntry();
    });
  });
}

module.exports = { modelBundle, validateModel, zip, MAX_FILE };
