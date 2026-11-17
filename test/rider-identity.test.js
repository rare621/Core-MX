const { test } = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../src/lib/profile');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('rider name and number use the game profile fields and validate before save', () => {
  const identity = profile.riderIdentity({ sections: { info: { values: { name: 'Game Rider', race_number: '27' } } } });
  assert.deepEqual(identity, { name: 'Game Rider', number: '27' });
  assert.deepEqual(profile.validateRiderIdentity({ riderName: ' New Rider ', riderNumber: '41' }), [['info', 'name', 'New Rider'], ['info', 'race_number', '41']]);
  assert.throws(() => profile.validateRiderIdentity({ riderName: 'bad\nname' }), /Rider name/);
  assert.throws(() => profile.validateRiderIdentity({ riderNumber: '1000' }), /Rider number/);
});

test('Apply writes rider identity into profile.ini with a backup', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-rider-identity-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const folder = path.join(dir, 'profiles', 'Fixture');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'profile.ini');
  await fs.writeFile(file, '[info]\r\nname=Old Rider\r\nbikeid=FixtureBike\r\n', 'latin1');
  await profile.writeValues(dir, 'Fixture', profile.validateRiderIdentity({ riderName: 'New Rider', riderNumber: '38' }));
  const saved = await profile.readProfile(dir, 'Fixture');
  assert.deepEqual(profile.riderIdentity(saved), { name: 'New Rider', number: '38' });
  assert.match(await fs.readFile(file + '.mxbm-backup', 'latin1'), /name=Old Rider/);
});
