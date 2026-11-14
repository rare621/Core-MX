const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const installer = require('../src/lib/installer');
const packages = require('../src/lib/graphics-packages');

async function fixture(t, transfer) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-graphics-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const game = path.join(root, 'game'), cache = path.join(root, 'packages');
  await fs.mkdir(game); let records = {}, running = false, serial = 0;
  const manager = packages.create({ transfer, gameDir: () => game, cacheDir: () => cache, records: () => records, save: (value) => { records = value; }, isGameRunning: async () => running,
    trash: async (file) => { const target = path.join(root, `recycled-${serial++}`); await fs.rename(file, target); } });
  const install = async (key, contents, fail = false) => {
    const entries = [];
    for (const [dest, bytes] of Object.entries(contents)) { const abs = path.join(root, `${key}-${entries.length}.source`); await fs.writeFile(abs, bytes); entries.push({ dest, abs }); }
    const plan = { root: 'game', entries };
    return manager.install(plan, key, async () => {
      const written = await installer.apply(plan, game);
      if (fail) throw new Error('Fixture failure');
      records = { ...records, [key]: { title: key, installedAt: Date.now(), files: written.map((f) => 'game:' + f) } };
      return written;
    });
  };
  return { root, game, manager, install, records: () => records, running: (value) => { running = value; } };
}

test('graphics packages switch exclusively, retain disabled files, and uninstall restores originals', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.game, 'shared.fx'), 'stock');
  await f.install('A', { 'shared.fx': 'A', 'only-a.fx': 'A extra' });
  await f.install('B', { 'shared.fx': 'B', 'only-b.fx': 'B extra' });
  assert.equal(f.records().A.graphicsActive, false); assert.equal(f.records().B.graphicsActive, true);
  assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'B');
  await assert.rejects(fs.stat(path.join(f.game, 'only-a.fx')), { code: 'ENOENT' });
  await f.manager.setActive('A', true);
  assert.equal(f.records().B.graphicsActive, false);
  assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'A');
  await f.manager.uninstall('A');
  assert.equal(f.records().A, undefined);
  assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'stock');
  await f.manager.setActive('B', true);
  assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'B');
  await f.manager.uninstall('B');
  assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'stock');
  assert.deepEqual(await fs.readdir(f.game), ['shared.fx']);
});

test('failed graphics installation restores the previously working package; running games and unsafe paths are rejected', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.game, 'shared.fx'), 'stock');
  await f.install('A', { 'shared.fx': 'A' });
  await assert.rejects(f.install('B', { 'shared.fx': 'B', 'partial.fx': 'new' }, true), /Fixture failure/);
  assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'A');
  assert.equal(f.records().A.graphicsActive, true);
  await assert.rejects(fs.stat(path.join(f.game, 'partial.fx')), { code: 'ENOENT' });
  f.running(true); await assert.rejects(f.manager.uninstall('A'), /Close MX Bikes/); f.running(false);
  await assert.rejects(f.manager.install({ entries: [{ dest: '../outside.fx' }] }, 'bad', () => {}), /Invalid graphics/);
  await assert.rejects(f.manager.setActive('unknown', true), /not found/);
  assert.equal(f.records().A.graphicsActive, true);
});
test('graphics disabling, re-enabling and uninstalling work across drives with verified copies', async (t) => {
  const transfer = (from, to) => packages.moveAcrossDevices(from, to, async () => { throw Object.assign(new Error('different drive'), { code: 'EXDEV' }); });
  const f = await fixture(t, transfer);
  await fs.writeFile(path.join(f.game, 'shared.fx'), 'stock');
  await f.install('A', { 'shared.fx': 'replacement' });
  await f.manager.setActive('A', false); assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'stock');
  await f.manager.setActive('A', true); assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'replacement');
  await f.manager.uninstall('A'); assert.equal(await fs.readFile(path.join(f.game, 'shared.fx'), 'utf8'), 'stock');
  assert.deepEqual(f.records(), {});
});
