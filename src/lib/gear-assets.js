const fs = require('fs');
const path = require('path');
const { chainOf, readChain, listFiles } = require('./asset-sources');

const validName = (name) => typeof name === 'string' && !!name && !/[\\/:\0]/.test(name) && name !== '.' && name !== '..';
const unique = (values) => [...new Map(values.map((v) => [v.toLowerCase(), v])).values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

async function roots({ modsDir, rider = 'default_mx', stockPkz }) {
  if (!validName(rider)) throw new Error('Invalid rider model');
  return chainOf([
    { dir: path.join(modsDir, 'rider', 'riders', rider) },
    { dir: path.join(modsDir, 'rider') },
    stockPkz ? { pkz: stockPkz, prefix: `rider/riders/${rider}` } : null,
    stockPkz ? { pkz: stockPkz, prefix: 'rider' } : null,
  ]);
}

async function subchain(sources, relative) {
  const specs = sources.map((s) => s.kind === 'dir' ? { dir: path.join(s.dir, ...relative.split('/')) } : { pkz: s.pkz, prefix: s.prefix + relative });
  return chainOf(specs);
}

async function children(sources, relative = '', type = 'pnt') {
  const result = [];
  for (const source of sources) {
    if (source.kind === 'dir') {
      for (const e of await fs.promises.readdir(path.join(source.dir, relative), { withFileTypes: true }).catch(() => [])) {
        if (type === 'pnt' && e.isFile() && /\.pnt$/i.test(e.name)) result.push(e.name.slice(0, -4));
        if (type === 'model' && (e.isDirectory() || /\.pkz$/i.test(e.name))) result.push(e.name.replace(/\.pkz$/i, ''));
      }
    } else {
      const prefix = source.prefix + (relative ? relative.toLowerCase().replace(/\/$/, '') + '/' : '');
      for (const [key, entry] of source.entries) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const original = entry.fileName.replace(/\\/g, '/').slice(prefix.length);
        if (type === 'pnt' && /^[^/]+\.pnt$/i.test(rest)) result.push(original.slice(0, -4));
        if (type === 'model' && (rest.includes('/') || /^[^/]+\.pkz$/i.test(rest))) result.push(original.split('/')[0].replace(/\.pkz$/i, ''));
      }
    }
  }
  return unique(result.filter(validName));
}

async function modelSources(options, kind, name) {
  if (!validName(name)) return [];
  return subchain(await roots(options), `${kind}/${name}`);
}

async function catalog(options, current) {
  const source = await roots(options);
  const helmet = await subchain(source, `helmets/${current.helmet || 'default'}`);
  const boots = await subchain(source, `boots/${current.boots || 'default'}`);
  const protection = await subchain(source, `protections/${current.protection || 'chest'}`);
  return {
    helmet: unique(['default', ...await children(source, 'helmets', 'model')]),
    helmetPaint: await children(helmet, 'paints'),
    gogglesPaint: unique([...await children(helmet, 'goggles'), ...await children(source, 'goggles')]),
    boots: unique(['default', ...await children(source, 'boots', 'model')]),
    bootsPaint: unique([...await children(boots, 'paints'), ...await children(source, 'boots'), ...await children(source, 'boots paints')]),
    protection: unique(['chest', 'full', ...await children(source, 'protections', 'model')]),
    protectionPaint: await children(protection, 'paints'),
    suitPaint: await children(source, 'paints'), glovesPaint: await children(source, 'gloves'),
  };
}

async function paintSource(options, slot, current) {
  const source = await roots(options);
  const slots = {
    suitPaint: ['paints'], glovesPaint: ['gloves'],
    helmetPaint: [`helmets/${current.helmet || 'default'}/paints`],
    gogglesPaint: [`helmets/${current.helmet || 'default'}/goggles`, 'goggles'],
    bootsPaint: [`boots/${current.boots || 'default'}/paints`, 'boots', 'boots paints'],
    protectionPaint: [`protections/${current.protection || 'chest'}/paints`],
  };
  const name = current[slot];
  if (!validName(name) || !slots[slot]) return null;
  for (const relative of slots[slot]) {
    // Resolve the model package before descending to its paint folder.
    const pieces = relative.split('/');
    const chain = pieces.length >= 3 ? await subchain(await subchain(source, pieces.slice(0, 2).join('/')), pieces.slice(2).join('/')) : await subchain(source, relative);
    const data = await readChain(chain, name + '.pnt');
    if (data) return { ...data, relative: `${relative}/${name}.pnt` };
  }
  return null;
}

async function hasModel(options, kind, name) {
  return (await listFiles(await modelSources(options, kind, name))).some((n) => /\.edf$/i.test(n));
}
module.exports = { roots, subchain, children, modelSources, catalog, paintSource, validName, hasModel };
