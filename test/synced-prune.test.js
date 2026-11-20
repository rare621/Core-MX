const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const paintsync = require('../src/lib/paintsync');

const DAY = 24 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('each synced file has its own timer, counted from the last time it was needed', async (t) => {
  const mods = fs.mkdtempSync(path.join(os.tmpdir(), 'mxbm-prune-'));
  t.after(() => fs.rmSync(mods, { recursive: true, force: true }));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(mods, rel)), { recursive: true }); fs.writeFileSync(path.join(mods, rel), text); };
  const now = 100 * DAY;
  put('rider/helmets/Old.pkz', 'old'); put('rider/helmets/Worn.pkz', 'worn'); put('rider/helmets/New.pkz', 'new');
  put('rider/helmets/Mine.pkz', 'mine'); put('rider/helmets/Edited.pkz', 'changed by the player');
  const received = {
    'rider/helmets/Old.pkz': { sha256: sha('old'), at: now - 40 * DAY },
    'rider/helmets/Worn.pkz': { sha256: sha('worn'), at: now - 90 * DAY, used: now - 2 * DAY },
    'rider/helmets/New.pkz': { sha256: sha('new'), at: now - 5 * DAY },
    'rider/helmets/Mine.pkz': { sha256: sha('mine'), at: now - 60 * DAY },
    'rider/helmets/Edited.pkz': { sha256: sha('original'), at: now - 60 * DAY },
    'rider/helmets/Gone.pkz': { sha256: sha('gone'), at: now - 60 * DAY },
  };
  const trashed = [];
  const n = await paintsync.pruneReceived(mods, received, { days: 30, now, keep: (rel) => rel.endsWith('Mine.pkz'), trash: async (p) => { trashed.push(path.basename(p)); fs.rmSync(p); } });
  assert.equal(n, 1);
  assert.deepEqual(trashed, ['Old.pkz'], 'only the file nobody needed for 30 days');
  assert.ok(received['rider/helmets/Worn.pkz'], 'still worn by a friend 2 days ago: kept');
  assert.ok(received['rider/helmets/New.pkz']);
  assert.equal(received['rider/helmets/Mine.pkz'].used, now, 'the player uses it: kept, timer restarts');
  assert.ok(fs.existsSync(path.join(mods, 'rider/helmets/Edited.pkz')), 'a file the player changed is left alone');
  assert.equal(received['rider/helmets/Edited.pkz'], undefined, '...and no longer counted as synced');
  assert.equal(received['rider/helmets/Gone.pkz'], undefined);
  assert.equal(await paintsync.pruneReceived(mods, received, { days: 0, now: now + 999 * DAY, trash: () => assert.fail('Never keeps everything') }), 0);
});

test('gear reports refresh the last-needed time, at most once an hour', () => {
  const received = { 'rider/helmets/A.pkz': { sha256: 'x', at: 1 }, 'rider/helmets/B.pkz': { sha256: 'y', at: 1, used: 10 * 3600 * 1000 } };
  const reports = [{ items: [{ path: 'rider/helmets/A.pkz' }, { path: 'rider/helmets/B.pkz' }, { path: 'rider/helmets/NotSynced.pkz' }] }];
  assert.equal(paintsync.touchReceived(received, reports, 10.5 * 3600 * 1000), true);
  assert.equal(received['rider/helmets/A.pkz'].used, 10.5 * 3600 * 1000);
  assert.equal(received['rider/helmets/B.pkz'].used, 10 * 3600 * 1000, 'touched less than an hour ago');
  assert.equal(received['rider/helmets/NotSynced.pkz'], undefined);
  assert.equal(paintsync.touchReceived(received, reports, 10.6 * 3600 * 1000), false);
});
