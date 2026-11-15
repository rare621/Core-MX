const fs = require('fs/promises');
const path = require('path');
const key = (file) => String(file).replace(/\\/g, '/').toLowerCase();

async function missingFiles(records, { modsDir, disabledDir }) {
  // An unavailable mods drive must never be mistaken for deleting every mod.
  try { if (!(await fs.stat(modsDir)).isDirectory()) return new Set(); } catch { return new Set(); }
  const files = [...new Set(Object.values(records).flatMap((r) => r.files || []))];
  const missing = new Set(); let index = 0;
  await Promise.all(Array.from({ length: Math.min(12, files.length) }, async () => {
    while (index < files.length) {
      const rel = files[index++];
      // Graphics packages have their own active/disabled storage and backups.
      if (/^game:/i.test(rel)) continue;
      let absent = true;
      for (const root of [modsDir, disabledDir].filter(Boolean)) {
        const base = path.resolve(root), file = path.resolve(base, rel);
        if (!file.toLowerCase().startsWith(base.toLowerCase() + path.sep)) { absent = false; break; }
        try { await fs.stat(file); absent = false; break; }
        catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) { absent = false; break; } }
      }
      if (absent) missing.add(key(rel));
    }
  }));
  return missing;
}

function prune(records, missing) {
  return Object.fromEntries(Object.entries(records).flatMap(([id, record]) => {
    const files = (record.files || []).filter((file) => !missing.has(key(file)));
    if (files.length === (record.files || []).length) return [[id, record]];
    return files.length ? [[id, { ...record, files }]] : [];
  }));
}
module.exports = { missingFiles, prune, key };
