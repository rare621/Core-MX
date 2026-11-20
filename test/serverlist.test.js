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

test('FrostMod is only detected, never removed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-frost-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal(serverList.frostmodInstalled(root), false);
  assert.equal(serverList.frostmodInstalled(''), false);
  await fs.mkdir(path.join(root, 'plugins'), { recursive: true });
  await fs.writeFile(path.join(root, 'plugins', 'frostmod.dlo'), 'their plugin');
  assert.equal(serverList.frostmodInstalled(root), true);
  assert.equal(serverList.removeBundledFrostmod, undefined, 'no code path deletes it');
  assert.equal(await fs.readFile(path.join(root, 'plugins', 'frostmod.dlo'), 'utf8'), 'their plugin');
});
