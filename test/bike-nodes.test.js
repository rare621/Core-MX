const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { selectNode, build } = require('../src/lib/bike3d');
const { model } = require('./helpers/assets');

test('generic HRC names resolve unique variant-suffixed bike nodes', () => {
  for (const variant of ['125', '250', '250f', '350f', '450f']) {
    const nodes = ['chassis', 'steer', 'fsusp', 'rsusp'].map((name) => ({ name: name + variant }));
    for (const role of ['chassis', 'steer', 'fsusp', 'rsusp']) {
      assert.equal(selectNode(nodes, role, role).name, role + variant);
    }
  }
});

test('exact names win and standalone exports retain their arbitrary root', () => {
  const nodes = [{ name: 'steer450f' }, { name: 'Steer' }];
  assert.equal(selectNode(nodes, 'steer', 'steer'), nodes[1]);
  const root = { name: 'Object06' };
  assert.equal(selectNode([root], 'steer', 'steer'), root);
});

test('missing or ambiguous parts never select a whole combined scene', () => {
  assert.equal(selectNode([{ name: 'steer125' }, { name: 'steer450f' }], 'steer', 'steer'), null);
  assert.equal(selectNode([{ name: 'chassis' }, { name: 'rsusp' }], 'steer', 'steer'), null);
  assert.equal(selectNode([], 'steer', 'steer'), null);
});

test('combined variant scene produces one mesh per bike part instead of stacked bikes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-bike-nodes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'bikes', 'Test');
  await fs.mkdir(dir, { recursive: true });
  const roles = { chassis: 'chassis', steer: 'steer', front_susp: 'fsusp', rear_susp: 'rsusp' };
  const scenes = Object.values(roles).map((name) => model(name + '450f'));
  await fs.writeFile(path.join(dir, 'model.edf'), Buffer.concat(scenes.map((buffer, i) => i ? buffer.subarray(0x54) : buffer)));
  await fs.writeFile(path.join(dir, 'gfx.cfg'), Object.keys(roles).map((slot) => `${slot}\n{\nmodel = ${slot}.hrc\n}\n`).join(''));
  for (const [slot, role] of Object.entries(roles)) {
    await fs.writeFile(path.join(dir, `${slot}.hrc`), `level0\n{\nscene = model.edf\n${slot === 'chassis' ? '' : `name = ${role}\n`}}\n`);
  }
  const result = await build({ modsDir: root, bike: 'Test', texMax: 128 });
  assert.equal(result.parts.length, 4);
  for (const part of result.parts) {
    assert.equal(part.meshes.length, 1);
    assert.equal(part.meshes[0].name, roles[part.slot] + '450f');
  }
});

test('the game\'s own wheel models (both wheels in one file, named wheel_front / wheel_sm_rear) are found', () => {
  const nodes = (...names) => names.map((name) => ({ name }));
  // tyres.pkz p_mx: fwheel.hrc level0 names no part, rwheel.hrc names "rwheela"; the EDF has wheel_front, wheel_rear.
  assert.equal(selectNode(nodes('wheel_front', 'wheel_rear'), undefined, 'fwheel').name, 'wheel_front');
  assert.equal(selectNode(nodes('wheel_front', 'wheel_rear'), 'rwheela', 'rwheel').name, 'wheel_rear');
  // tyres.pkz m_sm
  assert.equal(selectNode(nodes('wheel_sm_front', 'wheel_sm_rear'), undefined, 'fwheel').name, 'wheel_sm_front');
  assert.equal(selectNode(nodes('wheel_sm_front', 'wheel_sm_rear'), 'rwheela', 'rwheel').name, 'wheel_sm_rear');
  // OEM wheels and wheel mods keep working
  assert.equal(selectNode(nodes('thefwheel', 'therwheela'), 'thefwheel', 'fwheel').name, 'thefwheel');
  assert.equal(selectNode(nodes('Plane.001'), undefined, 'fwheel').name, 'Plane.001');
});
