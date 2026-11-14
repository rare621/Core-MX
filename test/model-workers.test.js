const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { model } = require('./helpers/assets');
const { create } = require('../src/lib/model-workers');
test('preview builders run off the app thread and a failed model does not poison the next preview', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-model-workers-')), workers = create();
  t.after(async () => { workers.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  const rider = path.join(root, 'rider/riders/default_mx'); await fs.mkdir(rider, { recursive: true }); await fs.writeFile(path.join(rider, 'rider.edf'), model('body'));
  let ticks = 0; const timer = setInterval(() => ticks++, 1);
  const result = await workers.build('rider', { modsDir: root, current: { rider: 'default_mx' }, only: ['body'], texMax: 64 }); clearInterval(timer);
  assert.equal(result.parts[0].meshes[0].name, 'body'); assert.ok(ticks > 0);
  await assert.rejects(workers.build('unknown', {}), /Unknown preview/);
  const again = await workers.build('rider', { modsDir: root, current: { rider: 'default_mx' }, only: ['body'], texMax: 64 }, true);
  assert.equal(again.parts[0].meshes[0].name, 'body');
});
