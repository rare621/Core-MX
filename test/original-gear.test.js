const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zip, model } = require('./helpers/assets');
const { sealed } = require('./helpers/sealed');
const { modelBundle, validateModel } = require('../src/lib/gear-sync');

async function mods(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-original-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (rel, bytes) => { const f = path.join(root, rel); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, bytes); };
  return { root, write };
}
const helmetZip = () => zip({ 'Lid/gfx.cfg': 'model = helmet.hrc', 'Lid/helmet.edf': model('helmet'), 'Lid/helmet.hrc': 'x', 'Lid/paints/A.pnt': 'paint' });

test('an encrypted model package is shared byte for byte; one tied to the buyer is refused', async (t) => {
  const m = await mods(t);
  const pkg = sealed(helmetZip(), true);
  await m.write('rider/helmets/Lid.pkz', pkg);
  assert.deepEqual(await modelBundle({ modsDir: m.root, kind: 'helmet', name: 'Lid' }), pkg);
  assert.equal(await validateModel(pkg, 'helmet'), true, 'the friend accepts it without opening it');
  const bound = sealed(helmetZip(), true, true);
  await m.write('rider/helmets/Lid.pkz', bound);
  await assert.rejects(modelBundle({ modsDir: m.root, kind: 'helmet', name: 'Lid' }), (e) => e.code === 'MXBM_ACCOUNT_BOUND');
  assert.equal(await validateModel(bound, 'helmet'), false);
});

test('a tyre set\'s own package is sent as it is; a loose model folder is packed from its plain files', async (t) => {
  const m = await mods(t);
  await m.write('tyres/Grip.pkz', sealed(zip({ 'gfx.cfg': 'x', 'grip.edf': model('tyre') }), true));
  await m.write('tyres/Grip/fwheel.hrc', 'x');
  // tyres/<name>.pkz is the model's own package: sent as it is.
  assert.ok(Buffer.isBuffer(await modelBundle({ modsDir: m.root, kind: 'tyres', name: 'Grip' })));
  await m.write('rider/boots/Kick/boots.edf', model('boots'));
  await m.write('rider/boots/Kick/gfx.cfg', 'x');
  const loose = await modelBundle({ modsDir: m.root, kind: 'boots', name: 'Kick' });
  assert.equal(await validateModel(loose, 'boots'), true);
});

test('packages with programs or unsafe paths are refused', async () => {
  assert.equal(await validateModel(zip({ 'a/helmet.edf': model('helmet'), 'a/tool.exe': 'MZ' }), 'helmet'), false);
  assert.equal(await validateModel(zip({ 'a/paints/x.pnt': 'p', 'a/helmet.edf': model('helmet'), 'a/readme.txt': 'hi' }), 'helmet'), true, 'a creator package may hold paints and notes');
  assert.equal(await validateModel(zip({ 'a/readme.txt': 'no model' }), 'helmet'), false);
});
