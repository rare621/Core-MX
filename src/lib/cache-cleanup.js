const fs = require('fs').promises;
const path = require('path');
// Only generated thumbnail files directly in this app's cache are eligible.
async function pruneThumbs(dir, protectedPaths = [], { maxBytes = 256 * 1024 * 1024, maxAge = 90 * 86400000, now = Date.now() } = {}) {
  const keep = new Set(protectedPaths.map((p) => path.resolve(p).toLowerCase()));
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/^(?:[rc]_)?[a-f0-9]{20}\.jpg$/i.test(entry.name)) continue;
    const file = path.resolve(dir, entry.name), stat = await fs.stat(file).catch(() => null);
    if (stat) files.push({ file, ...stat, protected: keep.has(file.toLowerCase()) });
  }
  let bytes = files.reduce((sum, f) => sum + f.size, 0), removed = 0;
  for (const file of files.filter((f) => !f.protected).sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    // Give newly selected images time to be recorded in data.json.
    if (now - file.mtimeMs < 86400000) continue;
    if (bytes <= maxBytes && now - file.mtimeMs <= maxAge && !path.basename(file.file).startsWith('c_')) continue;
    try { await fs.unlink(file.file); bytes -= file.size; removed++; } catch {}
  }
  return { bytes, removed };
}
module.exports = { pruneThumbs };
