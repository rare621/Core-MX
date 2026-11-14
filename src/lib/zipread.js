// Random-access reading of .pkz (zip) archives without loading them into memory.
const yauzl = require('yauzl');

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

async function listEntries(file) {
  const zip = await openZip(file);
  try {
    return await new Promise((resolve, reject) => {
      const out = [];
      zip.on('entry', (e) => { out.push(e); zip.readEntry(); });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  } finally {
    // keep zip open for callers via withZip; listEntries closes it
    zip.close();
  }
}

// Opens a zip, gives callback the entry list and a reader, closes afterwards.
async function withZip(file, fn) {
  const archive = await require('./assetread').openArchive(file);
  try { return await fn(archive.entries, (entry, maxBytes = 64 * 1024 * 1024) => archive.read(entry, maxBytes)); }
  finally { await archive.close(); }
}

module.exports = { listEntries, withZip };
