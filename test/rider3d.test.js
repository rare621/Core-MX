const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { model, zip } = require('./helpers/assets');
const { build } = require('../src/lib/rider3d');

function fixture(t) {
  const modsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mxb-reader-'));
  t.after(() => fs.rmSync(modsDir, { recursive: true, force: true }));
  const gd = path.join(modsDir, 'rider', 'riders', 'default_mx');
  fs.mkdirSync(gd, { recursive: true });
  fs.writeFileSync(path.join(gd, 'rider.edf'), model('body'));
  const helmetDir = path.join(modsDir, 'rider', 'helmets', 'test_helmet');
  fs.mkdirSync(path.dirname(helmetDir), { recursive: true });
  const render = () => build({ modsDir, gd, current: { helmet: 'test_helmet' }, only: ['helmet'], texMax: 64 });
  return { gd, helmetDir, render };
}

test('a paint-only directory does not hide its packaged helmet model', async (t) => {
  const { helmetDir, render } = fixture(t);
  fs.mkdirSync(path.join(helmetDir, 'paints'), { recursive: true });
  fs.writeFileSync(helmetDir + '.pkz', zip({ 'test_helmet/helmet.edf': model('packaged') }));
  const result = await render();
  assert.equal(result.parts[0].meshes[0].name, 'packaged');
  assert.deepEqual(result.unreadable, []);
});

test('loose model overrides take priority over the sibling package', async (t) => {
  const { helmetDir, render } = fixture(t);
  fs.mkdirSync(helmetDir);
  fs.writeFileSync(path.join(helmetDir, 'helmet.edf'), model('override'));
  fs.writeFileSync(helmetDir + '.pkz', zip({ 'helmet.edf': model('packaged') }));
  assert.equal((await render()).parts[0].meshes[0].name, 'override');
});

test('a packaged helmet loads without a loose directory', async (t) => {
  const { helmetDir, render } = fixture(t);
  fs.writeFileSync(helmetDir + '.pkz', zip({ 'helmet.edf': model('packaged') }));
  assert.equal((await render()).parts[0].meshes[0].name, 'packaged');
});

test('an unsupported model is reported without failing the outfit', async (t) => {
  const { helmetDir, render } = fixture(t);
  fs.mkdirSync(helmetDir);
  fs.writeFileSync(path.join(helmetDir, 'helmet.edf'), Buffer.from('unsupported model'));
  const result = await render();
  assert.deepEqual(result.unreadable, ['helmet']);
  assert.equal(result.parts.length, 0);
});

test('a missing helmet is reported instead of rendering an empty success', async (t) => {
  const { render } = fixture(t);
  assert.deepEqual((await render()).unreadable, ['helmet']);
});

test('a missing custom body never silently renders the stock body', async (t) => {
  const { gd } = fixture(t);
  const modsDir = path.resolve(gd, '../../..');
  const stockPkz = path.join(modsDir, 'stock.pkz');
  fs.writeFileSync(stockPkz, zip({ 'rider/riders/default_mx/rider.edf': model('stock') }));
  await assert.rejects(build({ modsDir, stockPkz, current: { rider: 'Missing hoodie' } }), /Preview unavailable for Missing hoodie/);
});
