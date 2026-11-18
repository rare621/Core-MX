const { test } = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../src/lib/profile');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('nickname is separate from the profile name; race number is [info] race_number', () => {
  const identity = profile.riderIdentity({ sections: { info: { values: { name: 'Game Profile', race_number: '0' } } } }, 'Public Nickname');
  assert.deepEqual(identity, { nickname: 'Public Nickname', riderNumber: '0' });
  assert.deepEqual(profile.validateRiderIdentity({ nickname: ' New Nickname ' }), []);
  assert.throws(() => profile.validateRiderIdentity({ nickname: 'bad\nname' }), /Nickname/);
  // Verified in game: setting 52 in My Profiles wrote race_number=52 under [info].
  assert.deepEqual(profile.validateRiderIdentity({ riderNumber: ' 052 ' }), [['info', 'race_number', '52']]);
  assert.throws(() => profile.validateRiderIdentity({ riderNumber: '1000' }), /Race number/);
  assert.throws(() => profile.validateRiderIdentity({ riderNumber: 'abc' }), /Race number/);
});

test('Apply writes nickname to global.ini and keeps the profile name untouched', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-rider-identity-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const folder = path.join(dir, 'profiles', 'Fixture');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'profile.ini');
  await fs.writeFile(file, '[info]\r\nname=Fixture\r\nbikeid=FixtureBike\r\n', 'latin1');
  await fs.writeFile(path.join(dir, 'global.ini'), '[profile]\r\nlastprofile=Fixture\r\nnickname=Old Nickname\r\n', 'latin1');
  await profile.writeNickname(dir, 'New Nickname');
  const saved = await profile.readProfile(dir, 'Fixture');
  assert.deepEqual(profile.riderIdentity(saved, await profile.readNickname(dir)), { nickname: 'New Nickname', riderNumber: '' });
  assert.equal(saved.sections.info.values.name, 'Fixture');
  assert.match(await fs.readFile(path.join(dir, 'global.ini.mxbm-backup'), 'latin1'), /nickname=Old Nickname/);
});
