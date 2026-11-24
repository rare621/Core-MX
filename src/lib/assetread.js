// Archive access for previews and equipped gear. Protected containers are read
// by the separately built native module; this source contains no reader keys.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const yauzl = require('yauzl');
const { AsyncLocalStorage } = require('node:async_hooks');

const previewContext = new AsyncLocalStorage();
const localPreviewEnabled = () => previewContext.getStore() === true;
const withLocalPreview = (read) => previewContext.run(true, read);
const DEFAULT_LIMIT = 512 * 1024 * 1024;

let reader;
function nativeReader() {
  if (reader) return reader;
  const file = process.env.COREMX_READER_PATH || path.join(__dirname, 'native', 'coremx_reader.node');
  try { reader = require(file); }
  catch (e) { throw new Error(`CoreMX preview reader is unavailable: ${e.message}`); }
  return reader;
}

function translateError(e) {
  if (/Account-bound content/.test(e.message)) e.code = 'MXBM_ACCOUNT_BOUND';
  return e;
}

function hasProtectedFooter(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 62 && buf.toString('ascii', buf.length - 62, buf.length - 58) === 'KCOL';
}

function decodeBlob(buf, maxBytes = DEFAULT_LIMIT) {
  if (!hasProtectedFooter(buf)) return buf;
  try { return nativeReader().decodeBlob(buf, localPreviewEnabled(), maxBytes); }
  catch (e) { throw translateError(e); }
}

function plainZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      const entries = [];
      zip.on('error', (e) => { zip.close(); reject(e); });
      zip.on('entry', (e) => { entries.push(e); zip.readEntry(); });
      zip.on('end', () => {
        zip.close();
        resolve({ entries, close: () => {}, read: (entry, maxBytes = DEFAULT_LIMIT) => new Promise((res, rej) => {
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
        }) });
      });
      zip.readEntry();
    });
  });
}

async function protectedFile(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 62) return false;
    const footer = Buffer.alloc(62);
    await handle.read(footer, 0, 62, size - 62);
    return footer.toString('ascii', 0, 4) === 'KCOL';
  } finally { await handle.close(); }
}

async function openArchive(file) {
  if (!await protectedFile(file)) return plainZip(file);
  const allowBound = localPreviewEnabled();
  try {
    const entries = JSON.parse(nativeReader().archiveEntries(file, allowBound));
    return { entries, close: () => {}, read: async (entry, maxBytes = DEFAULT_LIMIT) => {
      try { return nativeReader().archiveEntry(file, entry.fileName, allowBound, maxBytes); }
      catch (e) { throw translateError(e); }
    } };
  } catch (e) { throw translateError(e); }
}

async function assertShareableFile(file) {
  try { nativeReader().assertShareableFile(file); }
  catch (e) { throw translateError(e); }
}

function sealedInfo(buf) {
  if (!hasProtectedFooter(buf)) return null;
  try {
    const result = nativeReader().sealedInfo(buf);
    return result ? JSON.parse(result) : null;
  } catch (e) { throw translateError(e); }
}

module.exports = { decodeBlob, openArchive, withLocalPreview, localPreviewEnabled, assertShareableFile, sealedInfo };
