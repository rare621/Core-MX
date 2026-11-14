const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const frost = require('../src/lib/frostmod');

test('discovery cleanup removes expired and interrupted outputs, preserves fresh lists and unrelated files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-discovery-clean-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const [list] = frost.listCandidates(root);
  await fs.mkdir(path.dirname(list), { recursive: true });
  const now = Date.now();
  await fs.writeFile(list, `frostmod-masterlist 1 ${now}\n8.8.8.8:54210\tTest\n`);
  await fs.writeFile(list + '.tmp', 'interrupted');
  await fs.utimes(list + '.tmp', new Date(now - 600000), new Date(now - 600000));
  const keep = path.join(root, 'plugins/frostmod_serverfilter.yaml');
  await fs.writeFile(keep, 'user configuration');
  assert.equal(await frost.cleanup(root, null, { now }), 1);
  assert.match(await fs.readFile(list, 'utf8'), /Test/);
  await fs.writeFile(list, `frostmod-masterlist 1 ${now - 7 * 3600000}\n`);
  assert.equal(await frost.cleanup(root, null, { now }), 1);
  await fs.writeFile(list, `frostmod-masterlist 1 ${now}\n`);
  await fs.writeFile(list + '.tmp', 'new temporary');
  await fs.writeFile(frost.pluginPath(root) + '.part', 'interrupted plugin install');
  assert.equal(await frost.cleanup(root, null, { all: true, now }), 3);
  assert.equal(await fs.readFile(keep, 'utf8'), 'user configuration');
});

test('bundled discovery plugin verifies and installs offline, preserves an existing plugin, and creates the browser flag', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-discovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await frost.installBundled(path.join(__dirname, '..'), root);
  assert.equal(result.version, 'v0.52.0-mxbm.1');
  assert.equal((await fs.stat(frost.flagPath(root))).size, 0);
  assert.match(await fs.readFile(path.join(root, 'plugins/frostmod-licenses/LICENSE.txt'), 'utf8'), /Frostn1/);
  await fs.writeFile(frost.pluginPath(root), 'user-installed newer plugin');
  const again = await frost.installBundled(path.join(__dirname, '..'), root);
  assert.equal(again.installed, false);
  assert.equal(await fs.readFile(frost.pluginPath(root), 'utf8'), 'user-installed newer plugin');
  const broken = path.join(root, 'broken');
  await fs.mkdir(path.join(broken, 'plugin/frostmod'), { recursive: true });
  await fs.writeFile(path.join(broken, 'plugin/frostmod/release.json'), JSON.stringify({ size: 2, sha256: 'bad' }));
  await fs.writeFile(path.join(broken, 'plugin/frostmod/frostmod.dlo'), 'MZ');
  await assert.rejects(frost.installBundled(broken, root), /failed verification/);
  assert.equal(await fs.readFile(frost.pluginPath(root), 'utf8'), 'user-installed newer plugin');
});

test('only a pinned previous plugin is upgraded and temporary installation files are removed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-discovery-upgrade-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'app/plugin/frostmod'), game = path.join(root, 'game');
  await fs.cp(path.join(__dirname, '../plugin/frostmod'), source, { recursive: true });
  await fs.mkdir(path.join(game, 'plugins'), { recursive: true });
  const old = Buffer.from('previous managed binary');
  await fs.writeFile(frost.pluginPath(game), old);
  const releasePath = path.join(source, 'release.json');
  const release = JSON.parse(await fs.readFile(releasePath, 'utf8'));
  release.replaces = [require('crypto').createHash('sha256').update(old).digest('hex')];
  await fs.writeFile(releasePath, JSON.stringify(release));
  const result = await frost.installBundled(path.join(root, 'app'), game);
  assert.equal(result.installed, true);
  assert.deepEqual(await fs.readFile(frost.pluginPath(game)), await fs.readFile(path.join(source, 'frostmod.dlo')));
  await assert.rejects(fs.stat(frost.pluginPath(game) + '.part'), { code: 'ENOENT' });
  assert.equal((await frost.installBundled(path.join(root, 'app'), game)).installed, false);
});
