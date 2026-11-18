const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const animation = require('../src/lib/animation-install');
const state = require('../src/lib/animation-state');
const installer = require('../src/lib/installer');

test('creator instructions choose the game install folder or the mods folder', () => {
  assert.equal(animation.destination('Put the .ANM in Steam/steamapps/common/MX Bikes/rider/animations/mx/. Replacing via Mods does NOT WORK.'), 'game');
  assert.equal(animation.destination('To make these work, you need to put the ".ANM" file into "Steam/steamapps/common/MX Bikes/rider/animations/mx/". Replacing stock rider animations via "Mods" does NOT WORK currently.'), 'game');
  assert.equal(animation.destination('', 'Installation into mods folder! Move the Rider folder to MX Bikes MODS folder.'), 'mods');
  assert.equal(animation.destination('', 'Enjoy these animations.'), null);
});

test('several animation variants targeting the same filename require a separate choice', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'coremx-anim-variants-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const modsDir = path.join(root, 'mods'), gameDir = path.join(root, 'game');
  await fsp.mkdir(modsDir); await fsp.mkdir(gameDir);
  const files = ['standing/rider10.anm', 'sitting/rider10.anm'].map((rel) => ({ rel, abs: path.join(root, rel), size: 4 }));
  const plan = installer.plan(files, { title: 'Custom rider animations', categories: [519], modsDir, installDir: gameDir, animationLocation: 'game' }, { kind: 'animationGame' });
  assert.equal(plan.installable, 0);
  assert.ok(plan.entries.every((entry) => entry.status === 'unresolved' && !entry.dest));
  assert.match(plan.warnings.join(' '), /multiple variants/i);
});

test('animation plans put loose ANM files in the creator-required folder and leave unrelated files out', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'coremx-anim-plan-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const modsDir = path.join(root, 'mods'), gameDir = path.join(root, 'game');
  await fsp.mkdir(modsDir); await fsp.mkdir(gameDir);
  const files = [
    { rel: 'download/rider10.anm', abs: path.join(root, 'rider10.anm'), size: 4 },
    { rel: 'download/README.txt', abs: path.join(root, 'README.txt'), size: 4 },
  ];
  const ctx = { title: 'Menu animation', categories: [519], modsDir, installDir: gameDir };
  const game = installer.plan(files, ctx, { kind: 'animationGame' });
  assert.equal(game.root, 'game');
  assert.deepEqual(game.entries.map((e) => e.dest), ['rider/animations/mx/rider10.anm', null]);
  const user = installer.plan(files, ctx, { kind: 'animation' });
  assert.equal(user.root, 'mods');
  assert.equal(user.entries[0].dest, 'rider/animations/mx/rider10.anm');
});

test('a game-folder animation replaces one file and backs up its original', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'coremx-anim-copy-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const gameDir = path.join(root, 'game'), modsDir = path.join(root, 'mods');
  const file = path.join(root, 'new-rider10.anm');
  const target = path.join(gameDir, 'rider', 'animations', 'mx', 'rider10.anm');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.mkdir(modsDir);
  await fsp.writeFile(file, 'replacement');
  await fsp.writeFile(target, 'original');
  const plan = installer.plan([{ rel: 'package/rider10.anm', abs: file, size: 11 }],
    { title: 'insane’s custom rider animations', categories: [519], modsDir, installDir: gameDir, animationLocation: 'game' }, { kind: 'animationGame' });
  assert.equal(plan.entries[0].status, 'overwrite');
  assert.deepEqual(await installer.apply(plan, gameDir), ['rider/animations/mx/rider10.anm']);
  assert.equal(await fsp.readFile(target, 'utf8'), 'replacement');
  assert.equal(await fsp.readFile(target + '.mxbm-bak', 'utf8'), 'original');
});

test('My Mods finds and toggles animations in both install locations', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'coremx-anim-state-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const game = path.join(root, 'game'), mods = path.join(root, 'mods'), disabled = path.join(root, 'disabled');
  const gamePath = path.join(game, 'rider', 'animations', 'mx', 'rider10.anm');
  const modPath = path.join(mods, 'rider', 'animations', 'mx', 'style.anm');
  await fsp.mkdir(path.dirname(gamePath), { recursive: true });
  await fsp.mkdir(path.dirname(modPath), { recursive: true });
  await fsp.writeFile(gamePath, 'gesture'); await fsp.writeFile(modPath, 'style');
  const records = { owned: { title: 'Custom gestures', files: ['game:rider/animations/mx/rider10.anm'] } };
  let items = await state.list(game, mods, disabled, records);
  assert.deepEqual(items.map((item) => [item.id, item.enabled]), [['game:rider10.anm', true], ['mods:mx/style.anm', true]]);
  assert.equal(items[0].recordKey, 'owned');
  await state.setEnabled(game, mods, disabled, 'game:rider10.anm', false);
  await state.setEnabled(game, mods, disabled, 'mods:mx/style.anm', false);
  items = await state.list(game, mods, disabled, records);
  assert.equal(items.every((item) => !item.enabled), true);
  await state.setEnabled(game, mods, disabled, 'game:rider10.anm', true);
  assert.equal(await fsp.readFile(gamePath, 'utf8'), 'gesture');
  await assert.rejects(state.setEnabled(game, mods, disabled, 'game:../outside.anm', false), /Invalid animation file/);
});
