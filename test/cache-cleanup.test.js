const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createCacheCleanup } = require('../server/cache-cleanup');
test('cache cleanup retains shared/offline loadouts and readers, removes only unused cache after grace', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-cache-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const shared = 'a'.repeat(64), obsolete = 'b'.repeat(64), temp = 'c'.repeat(64) + '.tmp';
  for (const name of [shared, obsolete, temp, 'keep.txt']) await fs.writeFile(path.join(dir, name), 'test');
  const users = { a: { loadout: { items: [{ sha256: shared }] } }, b: { loadout: { items: [{ sha256: shared }] } } };
  let clock = 0, reading = false;
  const clean = createCacheCleanup({ directory: dir, users: () => users, now: () => clock, graceMs: 100, busy: (hash) => reading && hash === shared });
  await clean(); clock = 101;
  assert.deepEqual(await clean(), { removed: 2, bytes: 8 });
  users.a.loadout.items = []; await clean();
  assert.ok((await fs.readdir(dir)).includes(shared));
  users.b.sharePaints = false; reading = true; await clean(); clock = 300; await clean();
  assert.ok((await fs.readdir(dir)).includes(shared));
  reading = false; await clean(); clock = 401;
  users.a.loadout.items = [{ sha256: shared }]; await clean();
  assert.ok((await fs.readdir(dir)).includes(shared));
  delete users.a; await clean(); clock = 502; await clean();
  assert.deepEqual(await fs.readdir(dir), ['keep.txt']);
});

// Users who haven't opened CoreMX for 5 days: their synced files are removed (R2 and the service PC);
// their app uploads them again when they come back.
test('files only away users wear are not kept', () => {
  const { liveFiles } = require('../server/cache-cleanup');
  const DAY = 24 * 3600 * 1000, now = 100 * DAY, wear = (sha) => ({ loadout: { items: [{ sha256: sha }] } });
  const users = {
    here: { ...wear('a'), lastSeen: now - 60 * 1000 },
    away: { ...wear('b'), lastSeen: now - 6 * DAY },
    both: { ...wear('a'), lastSeen: now - 30 * DAY },
    never: wear('c'),
    private: { ...wear('d'), lastSeen: now, sharePaints: false },
  };
  assert.deepEqual([...liveFiles(users, { now, inactiveMs: 5 * DAY })], ['a']);
  assert.deepEqual([...liveFiles(users, { now })].sort(), ['a', 'b', 'c'], 'without a limit every sharing user counts');
});
