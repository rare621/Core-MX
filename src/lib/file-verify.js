const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function filesMatch(entries, root) {
  if (!entries.length) return false;
  for (const entry of entries) {
    const target = path.resolve(root, entry.dest || '');
    if (!target.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep)) return false;
    try {
      if ((await fs.promises.stat(target)).size !== entry.size) return false;
      if (await digest(entry.abs) !== await digest(target)) return false;
    } catch { return false; }
  }
  return true;
}
module.exports = { filesMatch };
