const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const tyres = require('../src/lib/tyres');
const profile = require('../src/lib/profile');
test('tyre choices follow the selected bike configuration, exclude unrelated installed sets and ignore old incompatible selections', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-tyres-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ['OEM', 'Pit', 'Supermoto']) { await fs.mkdir(path.join(root, 'tyres', name), { recursive: true }); await fs.writeFile(path.join(root, 'tyres', name, 'gfx.cfg'), 'front_wheel {}'); }
  for (const [bike, set] of [['KX250', 'OEM'], ['SmallBike', 'Pit']]) { const dir = path.join(root, 'bikes', bike); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'gfx.cfg'), 'tyres = ' + set); await fs.writeFile(path.join(dir, bike + '.cfg'), `tyres\n{\nid = ${set}\n}`); }
  const dir = path.join(root, 'bikes/KX250');
  assert.deepEqual(await tyres.options(root, null, dir, 'KX250'), ['OEM']);
  assert.deepEqual(await tyres.options(root, null, path.join(root, 'bikes/SmallBike'), 'SmallBike'), ['Pit']);
  const prof = { sections: { tyres: { values: { KX250: 'Pit' } } } };
  assert.deepEqual(await tyres.selected(root, prof, 'KX250', dir), { selected: 'OEM', base: 'OEM' });
  const lo = await profile.loadout(root, prof, 'KX250');
  assert.deepEqual(lo.options.tyres, ['', 'OEM']); assert.equal(lo.current.tyres, ''); assert.equal(lo.invalidTyres, 'Pit');
  assert.deepEqual(await tyres.options(root, null, null, 'MissingBike'), []);
});
