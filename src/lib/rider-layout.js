// Game layout verified against rider.pkz: body paints/gloves are per rider;
// helmets, boots, protection and cameras are shared accessories under rider/.
const fs = require('fs/promises');
const path = require('path');
const { mergeMove } = require('./merge-move');
const ACCESSORIES = new Set(['helmets', 'boots', 'boots paints', 'protections', 'goggles', 'helmetcams', 'fonts', 'animations']);
function canonical(relative, rider = 'default_mx') {
  let rel = relative.replace(/\\/g, '/');
  rel = rel.replace(/^rider\/riders\/[^/]+\/([^/]+)\//i, (all, type) => ACCESSORIES.has(type.toLowerCase()) ? `rider/${type}/` : all);
  return rel.replace(/^rider\/(paints|gloves)\//i, `rider/riders/${rider}/$1/`);
}
async function list(dir) { return fs.readdir(dir, { withFileTypes: true }).catch(() => []); }
async function misplaced(modsDir) {
  const result = [];
  const root = path.join(modsDir, 'rider');
  for (const type of ['paints', 'gloves']) {
    const from = `rider/${type}`;
    if ((await list(path.join(modsDir, from))).length) result.push({ from, to: `rider/riders/default_mx/${type}` });
  }
  for (const model of await list(path.join(root, 'riders'))) {
    if (!model.isDirectory() || model.isSymbolicLink()) continue;
    for (const type of await list(path.join(root, 'riders', model.name))) {
      if (type.isDirectory() && ACCESSORIES.has(type.name.toLowerCase())) result.push({ from: `rider/riders/${model.name}/${type.name}`, to: `rider/${type.name}` });
    }
  }
  return result;
}
async function repair(modsDir, trash) {
  const root = path.resolve(modsDir), changes = new Map(), conflicts = [];
  if ((await fs.lstat(root).catch(() => null))?.isSymbolicLink()) throw new Error('Gear repair cannot follow folder links');
  async function checked(relative) {
    const target = path.resolve(root, relative);
    if (!target.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error('Gear repair path is outside mods');
    for (let at = target; at !== root; at = path.dirname(at)) {
      const stat = await fs.lstat(at).catch((e) => { if (e.code !== 'ENOENT') throw e; });
      if (stat?.isSymbolicLink()) throw new Error('Gear repair cannot follow folder links');
    }
    return target;
  }
  for (const move of await misplaced(root)) {
    try {
      const from = await checked(move.from), to = await checked(move.to);
      const result = await mergeMove(from, to, trash, (item) => changes.set(path.relative(root, item.from).replace(/\\/g, '/'), path.relative(root, item.to).replace(/\\/g, '/')));
      conflicts.push(...result.conflicts.map((f) => path.relative(root, f).replace(/\\/g, '/')));
    } catch (e) { conflicts.push(`${move.from}: ${e.message}`); }
  }
  return { changes, conflicts };
}
module.exports = { ACCESSORIES, canonical, misplaced, repair };
