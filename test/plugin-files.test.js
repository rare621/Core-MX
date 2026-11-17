const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const pluginFiles = require('../src/lib/plugin-files');

test('plugin uninstall only trashes unchanged owned files inside game plugins', async (t) => {
  const gameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-plugin-'));
  t.after(() => fs.rm(gameDir, { recursive: true, force: true }));
  const root = path.join(gameDir, 'plugins'); await fs.mkdir(root);
  const own = path.join(root, 'camera64.dlo'), edited = path.join(root, 'edited.ini'), shared = path.join(root, 'shared.dlo');
  await Promise.all([fs.writeFile(own, 'owner'), fs.writeFile(edited, 'changed'), fs.writeFile(shared, 'shared')]);
  const files = ['game:plugins/camera64.dlo', 'game:plugins/edited.ini', 'game:plugins/shared.dlo', 'game:../outside.dlo'];
  const record = { files, hashes: { [files[0]]: await pluginFiles.digest(own), [files[1]]: 'old-hash', [files[2]]: await pluginFiles.digest(shared), [files[3]]: 'bad' } };
  const trashed = [];
  const result = await pluginFiles.removeOwned({ key: 'one', record, records: { one: record, two: { files: [files[2]] } }, gameDir, trash: async (file) => { trashed.push(file); await fs.unlink(file); } });
  assert.deepEqual(result.removed, [files[0]]);
  assert.deepEqual(result.kept, files.slice(1));
  assert.deepEqual(trashed, [own]);
  assert.equal(await fs.readFile(edited, 'utf8'), 'changed');
  assert.equal(await fs.readFile(shared, 'utf8'), 'shared');
});
