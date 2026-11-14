const path = require('path');
const { chainOf, readChain } = require('./asset-sources');
const { parseCfg } = require('./rider3d');
const valid = (value) => typeof value === 'string' && !!value && !/[\\/:\0]|^\.+$/.test(value);
async function references(bikeDir, bike) {
  if (!bikeDir) return [];
  const source = await chainOf([{ dir: bikeDir }]);
  const gfx = await readChain(source, 'gfx.cfg'), physics = bike && await readChain(source, bike + '.cfg');
  const visual = gfx && parseCfg(gfx.buf.toString('latin1')).tyres;
  const data = physics && parseCfg(physics.buf.toString('latin1')).tyres;
  return [...new Set([visual, typeof data === 'string' ? data : data?.id].filter(valid))];
}
async function selected(modsDir, prof, bike, bikeDir) {
  const explicit = prof.sections.tyres?.values[bike] || '';
  const available = await references(bikeDir, bike), base = available[0] || '';
  return { selected: available.includes(explicit) ? explicit : base, base };
}
async function options(modsDir, stockRiderPkz, bikeDir, bike) {
  const root = path.join(modsDir, 'tyres');
  const stock = stockRiderPkz && path.join(path.dirname(stockRiderPkz), 'tyres.pkz');
  const result = [];
  for (const name of await references(bikeDir, bike)) {
    const chain = await chainOf([{ dir: path.join(root, name) }, stock ? { pkz: stock, prefix: `tyres/${name}` } : null]);
    if (await readChain(chain, 'gfx.cfg')) result.push(name);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
module.exports = { selected, options, references };
