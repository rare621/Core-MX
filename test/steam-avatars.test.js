const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const steam = require('../src/lib/steam');

// Friends tab: each friend's Steam profile photo, from Steam's own files on this PC.
test('friend photos come from the avatar cache, else the photo id Steam keeps per friend', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-steam-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const me = '76561198000000100', friendA = '76561198000000101', friendB = '76561198000000102', stranger = '76561198000000103';
  const account = (id) => (BigInt(id) - 76561197960265728n).toString();
  await fs.mkdir(path.join(root, 'userdata', account(me), 'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'config', 'avatarcache'), { recursive: true });
  const hash = 'ab'.repeat(20);
  await fs.writeFile(path.join(root, 'userdata', account(me), 'config', 'localconfig.vdf'),
    `"UserLocalConfigStore"\n{\n\t"friends"\n\t{\n\t\t"${account(friendA)}"\n\t\t{\n\t\t\t"avatar"\t\t"${hash}"\n\t\t\t"name"\t\t"Uhh_sal"\n\t\t}\n\t\t"${account(friendB)}"\n\t\t{\n\t\t\t"name"\t\t"NoPhoto"\n\t\t\t"avatar"\t\t"not-a-hash"\n\t\t}\n\t}\n}\n`);
  await fs.writeFile(path.join(root, 'config', 'avatarcache', `${friendB}.png`), Buffer.from('png-bytes'));
  const list = steam.friends(root, me);
  assert.deepEqual(list.find((f) => f.steamId === friendA), { steamId: friendA, name: 'Uhh_sal', avatar: `https://avatars.steamstatic.com/${hash}_full.jpg` });
  assert.equal(list.find((f) => f.steamId === friendB).avatar, undefined, 'only real photo ids');
  const photos = steam.avatars(root, me, [friendA, friendB, stranger, 'not-an-id']);
  assert.equal(photos[friendA], `https://avatars.steamstatic.com/${hash}_full.jpg`);
  assert.equal(photos[friendB], 'data:image/png;base64,' + Buffer.from('png-bytes').toString('base64'), 'the local cache first');
  assert.deepEqual(Object.keys(photos).sort(), [friendA, friendB].sort(), 'unknown riders get their letter');
});
