const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const layout = require('../src/lib/rider-layout');
const installer = require('../src/lib/installer');
const gear = require('../src/lib/gear-assets');
const health = require('../src/lib/health');
const { scanAll } = require('../src/lib/scanner');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-layout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (rel, bytes) => { const file = path.join(root, rel); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); };
  return { root, write };
}
test('folder repair merges misplaced gear, recycles identical extra copies, preserves conflicting bytes and is repeatable', async (t) => {
  const { root, write } = await fixture(t);
  await write('rider/riders/default_mx/helmets/H/helmet.edf', 'model');
  await write('rider/riders/default_mx/helmets/H/paints/same.pnt', 'same');
  await write('rider/helmets/H/paints/same.pnt', 'same');
  await write('rider/riders/default_mx/helmets/H/paints/conflict.pnt', 'incoming');
  await write('rider/helmets/H/paints/conflict.pnt', 'existing');
  await write('rider/gloves/G.pnt', 'gloves');
  await write('rider/riders/default_mx/paints/Kit.pnt', 'kit');
  const recycled = [], trash = async (file) => { recycled.push(await fs.readFile(file, 'utf8')); await fs.rm(file); };
  const result = await layout.repair(root, trash);
  assert.equal(result.changes.size, 3); assert.deepEqual(recycled, ['same']);
  assert.equal(await fs.readFile(path.join(root, 'rider/helmets/H/helmet.edf'), 'utf8'), 'model');
  assert.equal(await fs.readFile(path.join(root, 'rider/helmets/H/paints/conflict.pnt'), 'utf8'), 'existing');
  assert.equal(await fs.readFile(path.join(root, 'rider/riders/default_mx/helmets/H/paints/conflict.pnt'), 'utf8'), 'incoming');
  assert.equal(await fs.readFile(path.join(root, 'rider/riders/default_mx/gloves/G.pnt'), 'utf8'), 'gloves');
  assert.equal(await fs.readFile(path.join(root, 'rider/riders/default_mx/paints/Kit.pnt'), 'utf8'), 'kit');
  assert.equal(result.conflicts.length, 1);
  assert.equal((await layout.repair(root, trash)).changes.size, 0);
});
test('installer repairs incoming nested accessories without changing the body for shared gear', async (t) => {
  const { root } = await fixture(t);
  const paths = ['rider/riders/Hoodie/helmets/H/H.edf', 'rider/riders/default_mx/boots/B.pkz', 'rider/protections/P/P.edf', 'rider/riders/Hoodie/gloves/G.pnt'];
  const p = installer.plan(paths.map((rel) => ({ rel, size: 1 })), { modsDir: root, local: true });
  assert.deepEqual(p.entries.map((e) => e.dest), ['rider/helmets/H/H.edf', 'rider/boots/B.pkz', 'rider/protections/P/P.edf', paths[3]]);
});
test('catalog and library use shared accessories with each body and maintenance never flags them as old files', async (t) => {
  const { root, write } = await fixture(t);
  await write('rider/helmets/H/gfx.cfg', 'model = helmet.hrc');
  await write('rider/helmets/H/paints/Blue.pnt', 'paint');
  await write('rider/riders/Hoodie/paints/Kit.pnt', 'kit');
  await write('rider/riders/Hoodie/gloves/G.pnt', 'glove');
  const catalog = await gear.catalog({ modsDir: root, rider: 'Hoodie' }, { helmet: 'H' });
  assert.ok(catalog.helmet.includes('H')); assert.deepEqual(catalog.helmetPaint, ['Blue']);
  assert.deepEqual(catalog.suitPaint, ['Kit']); assert.deepEqual(catalog.glovesPaint, ['G']);
  const scan = await scanAll(root, path.join(root, 'disabled'));
  assert.equal(scan.items.find((i) => i.name === 'H').sub, 'helmets');
  assert.ok(!(await health.scan({ modsDir: root, items: scan.items })).some((i) => /old|misplaced/.test(i.id)));
});
