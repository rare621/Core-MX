const fs = require('fs/promises');
const path = require('path');
const { filesMatch } = require('./file-verify');

// Merge unique files without replacing a different installed version.
async function mergeMove(from, to, trash, onMoved = () => {}) {
  const source = path.resolve(from), destination = path.resolve(to);
  if (source.toLowerCase() === destination.toLowerCase() || destination.toLowerCase().startsWith(source.toLowerCase() + path.sep)) throw new Error('Invalid move destination');
  const result = { moved: [], conflicts: [] };
  const walk = async (a, b) => {
    const stat = await fs.lstat(a);
    if (stat.isSymbolicLink()) { result.conflicts.push(a); return; }
    const existing = await fs.lstat(b).catch(() => null);
    if (existing?.isSymbolicLink()) { result.conflicts.push(b); return; }
    if (stat.isDirectory()) {
      if (existing && !existing.isDirectory()) { result.conflicts.push(b); return; }
      await fs.mkdir(b, { recursive: true });
      for (const entry of await fs.readdir(a)) await walk(path.join(a, entry), path.join(b, entry));
      if (!(await fs.readdir(a)).length) await fs.rmdir(a);
    } else {
      if (existing) {
        if (!existing.isFile() || !await filesMatch([{ abs: a, dest: path.basename(b), size: stat.size }], path.dirname(b))) { result.conflicts.push(b); return; }
        await trash(a);
      } else { await fs.mkdir(path.dirname(b), { recursive: true }); await fs.rename(a, b); }
      result.moved.push({ from: a, to: b });
      onMoved({ from: a, to: b });
    }
  };
  await walk(source, destination);
  return result;
}
module.exports = { mergeMove };
