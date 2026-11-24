const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { zip } = require('./helpers/assets');
const { decodeBlob, openArchive } = require('../src/lib/assetread');

test('ordinary files and ZIP archives remain readable', async (t) => {
  const plain = Buffer.from('ordinary asset');
  assert.strictEqual(decodeBlob(plain), plain);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coremx-zip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.pkz');
  fs.writeFileSync(file, zip({ 'bike/gfx.cfg': 'model = bike.hrc' }));
  const archive = await openArchive(file);
  try {
    assert.deepEqual(archive.entries.map((e) => e.fileName), ['bike/gfx.cfg']);
    assert.equal((await archive.read(archive.entries[0])).toString(), 'model = bike.hrc');
  } finally { await archive.close(); }
});
