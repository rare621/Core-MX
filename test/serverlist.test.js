const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const serverList = require('../src/lib/serverlist');

test('the plugin server list is parsed, deduplicated and ignored once stale', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-serverlist-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const now = Date.now();
  await fs.writeFile(serverList.listPath(root), `coremx-serverlist 1 ${now}\n104.156.148.212:10331\t2Fast\n104.156.148.212:10331\tDuplicate\nnot a row\n152.53.166.98:20086\tSYB LIVE ON TT\n`);
  const list = await serverList.read(root, now);
  assert.deepEqual(list.servers, [{ address: '104.156.148.212:10331', name: '2Fast' }, { address: '152.53.166.98:20086', name: 'SYB LIVE ON TT' }]);
  assert.equal(await serverList.read(root, now + 7 * 3600 * 1000), null);
  assert.equal(serverList.parse('frostmod-masterlist 1 0\n1.2.3.4:1\tx'), null);
});

test('only the FrostMod build CoreMX installed is removed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-frost-clean-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const plugins = path.join(root, 'plugins');
  await fs.mkdir(path.join(plugins, 'frostmod-licenses'), { recursive: true });
  const trashed = [];
  const trash = async (p) => { trashed.push(p); await fs.rm(p); };
  // Someone's own FrostMod: different checksum, untouched.
  await fs.writeFile(path.join(plugins, 'frostmod.dlo'), 'a FrostMod the player installed');
  assert.equal(await serverList.removeBundledFrostmod(root, null, trash), false);
  assert.equal(trashed.length, 0);
  // The bundled build (checksum faked for the test).
  const bytes = Buffer.from('bundled build');
  serverList.BUNDLED_FROSTMOD.add(crypto.createHash('sha256').update(bytes).digest('hex'));
  await fs.writeFile(path.join(plugins, 'frostmod.dlo'), bytes);
  await fs.writeFile(path.join(plugins, 'frostmod-licenses', 'LICENSE.txt'), 'MIT');
  await fs.writeFile(path.join(plugins, 'frostmod_filter.flag'), '');
  await fs.writeFile(path.join(plugins, 'frostmod_serverfilter.yaml'), 'their own settings');
  await fs.writeFile(path.join(plugins, 'mxbm_presence.dlo'), 'ours');
  assert.equal(await serverList.removeBundledFrostmod(root, null, trash), true);
  assert.deepEqual(trashed, [path.join(plugins, 'frostmod.dlo')]);
  const left = (await fs.readdir(plugins)).sort();
  assert.deepEqual(left, ['frostmod_serverfilter.yaml', 'mxbm_presence.dlo']);
  assert.equal(await serverList.removeBundledFrostmod(root, null, trash), false);
});
