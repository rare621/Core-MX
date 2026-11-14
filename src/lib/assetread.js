// Read local PiBoSo KCOL containers. File keys are carried by each container;
// no game binary, process access, account credentials or bundled keys are used.
const fs = require('fs');
const zlib = require('zlib');
const yauzl = require('yauzl');
const { AsyncLocalStorage } = require('node:async_hooks');
// Local previews may inspect the user's installed copy. Sync/export readers
// retain the default restriction, including when preview work is concurrent.
const previewContext = new AsyncLocalStorage();
const localPreviewEnabled = () => previewContext.getStore() === true;
const withLocalPreview = (read) => previewContext.run(true, read);

const FOOTER_SIZE = 62, MAX_DIRECTORY = 16 * 1024 * 1024;
const DEFAULT_LIMIT = 128 * 1024 * 1024, MAX_DROP = 1024 * 1024;

function footerInfo(footer, totalLength) {
  if (footer.length !== FOOTER_SIZE || footer.toString('ascii', 0, 4) !== 'KCOL') return null;
  const size = footer.readUInt32LE(56), drop = footer.readUInt32LE(4) + 256;
  if (size > totalLength - FOOTER_SIZE || drop > MAX_DROP) throw new Error('Invalid KCOL container bounds');
  const mask = Buffer.from(footer.subarray(56, 62));
  const salt = [0xfd, 0xc7, 0x1c, 0xaf, 0x35, 0x71];
  for (let i = 0; i < mask.length; i++) mask[i] ^= salt[i];
  // The middle field carries a binding marker. Only the local preview path
  // opts into reading such installed files; sync/export keeps rejecting them.
  for (let i = 0; i < 16; i++) {
    if ((footer[24 + i] ^ mask[i % 6]) !== 0 && !localPreviewEnabled()) throw Object.assign(new Error('Account-bound content must be opened by its owner in the game'), { code: 'MXBM_ACCOUNT_BOUND' });
  }
  const key = Buffer.from(footer.subarray(8, 24));
  for (let i = 0; i < key.length; i++) key[i] ^= mask[(32 + i) % 6];
  return { size, drop, key, checksum: footer.readUInt16LE(60), start: totalLength - FOOTER_SIZE - size };
}

function cipher(key, drop) {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  let i = 0, j = 0;
  for (let n = 0; n < 256; n++) {
    j = (j + s[n] + key[n % key.length]) & 255;
    [s[n], s[j]] = [s[j], s[n]];
  }
  j = 0;
  const step = () => {
    i = (i + 1) & 255; j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    return s[(s[i] + s[j]) & 255];
  };
  for (let n = 0; n < drop; n++) step();
  return (buf) => {
    const out = Buffer.allocUnsafe(buf.length);
    for (let n = 0; n < buf.length; n++) out[n] = buf[n] ^ step();
    return out;
  };
}

function verifySum(buf, expected) {
  let sum = 0;
  for (const value of buf) sum = (sum + value) & 65535;
  if (sum !== expected) throw new Error('KCOL checksum mismatch');
}

function decodeBlob(buf, maxBytes = DEFAULT_LIMIT) {
  const info = footerInfo(buf.subarray(-FOOTER_SIZE), buf.length);
  if (!info) return buf;
  if (info.start !== 0) throw new Error('Container holds an archive directory, not a single asset');
  if (info.size > maxBytes) throw new Error('Decoded asset is too large');
  const plain = cipher(info.key, info.drop)(buf.subarray(0, info.size));
  verifySum(plain, info.checksum);
  return plain;
}

async function readAt(handle, offset, length, end) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > end) throw new Error('Asset read is outside the container');
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buf, done, length - done, offset + done);
    if (!bytesRead) throw new Error('Truncated asset container');
    done += bytesRead;
  }
  return buf;
}

function entriesFromDirectory(buf, dataEnd) {
  const entries = [];
  let off = 0;
  while (off + 46 <= buf.length && buf.readUInt32LE(off) === 0x02014b50) {
    const nameLength = buf.readUInt16LE(off + 28), extraLength = buf.readUInt16LE(off + 30), commentLength = buf.readUInt16LE(off + 32);
    const next = off + 46 + nameLength + extraLength + commentLength;
    if (next > buf.length) throw new Error('Truncated archive directory');
    const entry = {
      fileName: buf.toString('utf8', off + 46, off + 46 + nameLength).replace(/\\/g, '/'),
      generalPurposeBitFlag: buf.readUInt16LE(off + 8), compressionMethod: buf.readUInt16LE(off + 10),
      crc32: buf.readUInt32LE(off + 16), compressedSize: buf.readUInt32LE(off + 20), uncompressedSize: buf.readUInt32LE(off + 24),
      relativeOffsetOfLocalHeader: buf.readUInt32LE(off + 42),
    };
    if (entry.relativeOffsetOfLocalHeader + 30 + entry.compressedSize > dataEnd) throw new Error('Invalid archive entry bounds');
    entries.push(entry); off = next;
    if (entries.length > 100000) throw new Error('Archive contains too many entries');
  }
  if (off + 22 > buf.length || buf.readUInt32LE(off) !== 0x06054b50) throw new Error('Archive directory terminator is missing');
  if (buf.readUInt16LE(off + 4) || buf.readUInt16LE(off + 6) || buf.readUInt16LE(off + 8) !== entries.length || buf.readUInt16LE(off + 10) !== entries.length) throw new Error('Unsupported multi-volume or ZIP64 archive');
  if (buf.readUInt32LE(off + 12) !== off || buf.readUInt32LE(off + 16) !== dataEnd || off + 22 + buf.readUInt16LE(off + 20) !== buf.length) throw new Error('Inconsistent archive directory');
  return entries;
}

function openPlainZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      const entries = [];
      zip.on('error', (e) => { zip.close(); reject(e); });
      zip.on('entry', (e) => { entries.push(e); zip.readEntry(); });
      zip.on('end', () => { zip.close(); resolve({ entries, close: () => {},
        read: (entry, maxBytes = DEFAULT_LIMIT) => new Promise((res, rej) => {
          if (entry.uncompressedSize > maxBytes || entry.compressedSize > maxBytes) return rej(new Error('Archive entry is too large'));
          yauzl.open(file, { lazyEntries: true, autoClose: false }, (openError, reader) => {
          if (openError) return rej(openError);
          reader.on('error', (e) => { reader.close(); rej(e); });
          reader.openReadStream(entry, (error, stream) => {
            if (error) { reader.close(); return rej(error); }
            const chunks = [];
            let total = 0;
            stream.on('data', (chunk) => { total += chunk.length; if (total > maxBytes) stream.destroy(new Error('Archive entry is too large')); else chunks.push(chunk); });
            stream.on('error', (e) => { reader.close(); rej(e); });
            stream.on('end', () => {
              reader.close();
              const buf = Buffer.concat(chunks);
              if (buf.length !== entry.uncompressedSize || zlib.crc32(buf) !== entry.crc32) return rej(new Error('Archive entry checksum mismatch'));
              res(buf);
            });
          });
          });
        }),
      }); });
      zip.readEntry();
    });
  });
}

async function openArchive(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const footer = size >= FOOTER_SIZE ? await readAt(handle, size - FOOTER_SIZE, FOOTER_SIZE, size) : Buffer.alloc(0);
    const info = footerInfo(footer, size);
    if (!info) return await openPlainZip(file);
    if (info.size > MAX_DIRECTORY) throw new Error('Archive directory is too large');
    const directory = cipher(info.key, info.drop)(await readAt(handle, info.start, info.size, size));
    verifySum(directory, info.checksum);
    const entries = entriesFromDirectory(directory, info.start);
    return { entries, close: () => {}, read: async (entry, maxBytes = DEFAULT_LIMIT) => {
      if (entry.uncompressedSize > maxBytes || entry.compressedSize > maxBytes) throw new Error('Archive entry is too large');
      if (entry.generalPurposeBitFlag & 1) throw new Error('Password-encrypted ZIP entries are unsupported');
      const reader = await fs.promises.open(file, 'r');
      try {
      const offset = entry.relativeOffsetOfLocalHeader;
      const decode = cipher(info.key, info.drop);
      const head = decode(await readAt(reader, offset, 30, info.start));
      if (head.readUInt32LE(0) !== 0x04034b50 || head.readUInt16LE(8) !== entry.compressionMethod) throw new Error('Invalid archive entry header');
      const extraSize = head.readUInt16LE(26) + head.readUInt16LE(28);
      const names = decode(await readAt(reader, offset + 30, extraSize, info.start));
      if (names.toString('utf8', 0, head.readUInt16LE(26)).replace(/\\/g, '/') !== entry.fileName) throw new Error('Archive entry name mismatch');
      const compressed = await readAt(reader, offset + 30 + extraSize, entry.compressedSize, info.start);
      const plain = entry.compressionMethod === 0 ? compressed : entry.compressionMethod === 8
        ? zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, Math.min(entry.uncompressedSize, maxBytes)) }) : null;
      if (!plain) throw new Error('Unsupported archive compression method');
      if (plain.length !== entry.uncompressedSize || zlib.crc32(plain) !== entry.crc32) throw new Error('Archive entry checksum mismatch');
      return plain;
      } finally { await reader.close(); }
    } };
  } finally {
    await handle.close();
  }
}

async function assertShareableFile(file) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const { size } = await handle.stat();
    if (size >= FOOTER_SIZE) {
      const footer = await readAt(handle, size - FOOTER_SIZE, FOOTER_SIZE, size);
      previewContext.run(false, () => footerInfo(footer, size));
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  finally { if (handle) await handle.close(); }
}

module.exports = { decodeBlob, openArchive, withLocalPreview, localPreviewEnabled, assertShareableFile };
