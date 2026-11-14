const path = require('path');
const fs = require('fs/promises');
const { chainOf, readChain, listFiles } = require('./asset-sources');
const { parseCfg } = require('./rider3d');
async function selected(modsDir, prof, bike, bikeDir) {
  const explicit = prof.sections.tyres?.values[bike] || '';
  const data = bikeDir && await readChain(await chainOf([{ dir: bikeDir }]), 'gfx.cfg');
  const base = data ? parseCfg(data.buf.toString('latin1')).tyres : '';
  return { selected: explicit || (typeof base === 'string' ? base : ''), base: typeof base === 'string' ? base : '' };
}
async function options(modsDir, stockRiderPkz) {
  const root = path.join(modsDir, 'tyres');
  const names = new Set((await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() || /\.pkz$/i.test(e.name)).map((e) => e.name.replace(/\.pkz$/i, '')));
  const stock = stockRiderPkz && path.join(path.dirname(stockRiderPkz), 'tyres.pkz');
  if (stock) for (const file of await listFiles(await chainOf([{ pkz: stock, prefix: 'tyres' }]))) if (file.includes('/')) names.add(file.split('/')[0]);
  const result = [];
  for (const name of names) {
    const chain = await chainOf([{ dir: path.join(root, name) }, stock ? { pkz: stock, prefix: `tyres/${name}` } : null]);
    if (await readChain(chain, 'gfx.cfg')) result.push(name);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
module.exports = { selected, options };
