const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let running = false;
mock.method(require('node:child_process'), 'execFile', (_exe, _args, _opts, done) => done(null, running ? '"mxbikes.exe","123"' : ''));
const profile = require('../src/lib/profile');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mxb-profiles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'profiles', 'Original'), { recursive: true });
  fs.writeFileSync(path.join(root, 'global.ini'), '[profile]\r\nlastprofile=Original\r\nnickname=Rider\r\n');
  fs.writeFileSync(path.join(root, 'profiles', 'Original', 'profile.ini'), '[info]\r\nbikeid=Bike\r\n[helmet]\r\nBike=custom_helmet\r\n[paint]\r\nBike=custom_paint\r\n[gfx]\r\nx=1920\r\n');
  fs.writeFileSync(path.join(root, 'profiles', 'Original', 'controls.txt'), 'original controls');
  return root;
}

test('deleting the active profile selects another profile, recycles the folder and preserves the last remaining profile', async (t) => {
  const root = fixture(t), recycled = [];
  await profile.createProfile(root, 'Race', 'Original'); await profile.activateProfile(root, 'Race');
  const result = await profile.deleteProfile(root, 'Race', async (folder) => { recycled.push(path.basename(folder)); fs.renameSync(folder, path.join(root, 'recycled-profile')); });
  assert.deepEqual(recycled, ['Race']); assert.equal(result.last, 'Original'); assert.deepEqual(result.profiles, ['Original']);
  await assert.rejects(profile.deleteProfile(root, 'Original', () => {}), /only profile/);
});
test('copying a profile preserves gear and controls without activating it', async (t) => {
  const root = fixture(t), before = fs.readFileSync(path.join(root, 'global.ini'));
  await profile.createProfile(root, 'Race setup', 'Original', true);
  const result = await profile.readProfile(root, 'Race setup');
  assert.equal(result.sections.helmet.values.Bike, 'custom_helmet');
  assert.equal(fs.readFileSync(path.join(root, 'profiles', 'Race setup', 'controls.txt'), 'utf8'), 'original controls');
  assert.deepEqual(fs.readFileSync(path.join(root, 'global.ini')), before);
});
test('a fresh profile resets gear while preserving riding settings', async (t) => {
  const root = fixture(t);
  await profile.createProfile(root, 'Fresh', 'Original', false);
  const result = await profile.readProfile(root, 'Fresh');
  assert.equal(result.sections.helmet, undefined);
  assert.equal(result.sections.paint, undefined);
  assert.equal(result.sections.gfx.values.x, '1920');
});
test('activating a profile updates the game selection with a backup', async (t) => {
  const root = fixture(t), old = fs.readFileSync(path.join(root, 'global.ini'));
  await profile.createProfile(root, 'Race', 'Original');
  await profile.activateProfile(root, 'Race');
  assert.equal((await profile.listProfiles(root)).last, 'Race');
  assert.deepEqual(fs.readFileSync(path.join(root, 'global.ini.mxbm-backup')), old);
});
test('invalid/duplicate names and a running game cannot modify profiles', async (t) => {
  const root = fixture(t);
  await assert.rejects(profile.createProfile(root, '../outside', 'Original'), /profile name/);
  await assert.rejects(profile.createProfile(root, 'Original', 'Original'), /already exists/);
  running = true;
  try { await assert.rejects(profile.createProfile(root, 'Blocked', 'Original'), /Close MX Bikes/); }
  finally { running = false; }
  assert.equal(fs.existsSync(path.join(root, 'profiles', 'Blocked')), false);
});

test('blank bike protection reflects the global chest fallback and applying None clears both', async (t) => {
  const root = fixture(t);
  await profile.writeValues(root, 'Original', [['info', 'protection', 'chest'], ['protection', 'Bike', '']]);
  const before = await profile.loadout(root, await profile.readProfile(root, 'Original'), 'Bike');
  assert.equal(before.current.protection, 'chest');
  await profile.saveLoadouts(root, 'Original', { Bike: { protection: '', protectionPaint: '' } });
  const saved = await profile.readProfile(root, 'Original');
  assert.equal(saved.sections.info.values.protection, '');
  assert.equal(saved.sections.protection.values.Bike, '');
  assert.equal((await profile.loadout(root, saved, 'Bike')).current.protection, '');
});
