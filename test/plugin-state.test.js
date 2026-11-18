const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const state = require('../src/lib/plugin-state');

test('each plugin can be disabled and restored without changing its bytes or install record', async (t) => {
  const game = await fsp.mkdtemp(path.join(os.tmpdir(), 'coremx-plugins-'));
  t.after(() => fsp.rm(game, { recursive: true, force: true }));
  await fsp.mkdir(path.join(game, 'plugins'));
  const active = path.join(game, 'plugins', 'camera64.dlo');
  await fsp.writeFile(active, Buffer.from([1, 2, 3, 4]));
  const records = { owned: { title: 'Rider POV+', files: ['game:plugins/camera64.dlo'] } };
  assert.deepEqual((await state.list(game, records)).map((p) => [p.name, p.enabled, p.recordKey]), [['camera64.dlo', true, 'owned']]);
  await state.setEnabled(game, 'camera64.dlo', false);
  assert.equal(fs.existsSync(active), false);
  assert.deepEqual((await state.list(game, records)).map((p) => [p.name, p.enabled, p.recordKey]), [['camera64.dlo', false, 'owned']]);
  assert.equal(state.revealPath(game, 'camera64.dlo'), path.join(game, 'plugins_disabled (CoreMX)', 'camera64.dlo'));
  await state.setEnabled(game, 'camera64.dlo', true);
  assert.deepEqual(await fsp.readFile(active), Buffer.from([1, 2, 3, 4]));
});

test('plugin controls reject unsafe names and do not replace a conflicting file', async (t) => {
  const game = await fsp.mkdtemp(path.join(os.tmpdir(), 'coremx-plugins-'));
  t.after(() => fsp.rm(game, { recursive: true, force: true }));
  await fsp.mkdir(path.join(game, 'plugins'));
  await fsp.mkdir(path.join(game, 'plugins_disabled (CoreMX)'));
  await fsp.writeFile(path.join(game, 'plugins', 'same.dlo'), 'active');
  await fsp.writeFile(path.join(game, 'plugins_disabled (CoreMX)', 'same.dlo'), 'disabled');
  await assert.rejects(state.setEnabled(game, '../outside.dlo', false), /Invalid game plugin path/);
  await assert.rejects(state.setEnabled(game, 'same.dlo', false), /already exists/);
  assert.equal(await fsp.readFile(path.join(game, 'plugins', 'same.dlo'), 'utf8'), 'active');
  assert.equal(await fsp.readFile(path.join(game, 'plugins_disabled (CoreMX)', 'same.dlo'), 'utf8'), 'disabled');
});
