const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const installer = require('../src/lib/installer');

// Layouts of real MXB Mods "UI" and "Menu Backgrounds" downloads (checked 2026-11-19).
const files = (...rels) => rels.map((rel) => ({ rel, abs: '', size: 1 }));
const dests = (list) => Object.fromEntries([...installer.menuDestinations(list)].map(([rel, d]) => [rel, d]));

test('menus and loading screens go to MX Bikes/ui, menu backgrounds to MX Bikes/misc', () => {
  // NMLD UI v2.0.1: a menu inside a wrapper folder.
  assert.deepEqual(dests(files('NMLD UI v2.0.1/main.mnu', 'NMLD UI v2.0.1/tiles/main/background.tga', 'NMLD UI v2.0.1/tiles/main/discord1.tga')), {
    'NMLD UI v2.0.1/main.mnu': 'ui/main.mnu', 'NMLD UI v2.0.1/tiles/main/background.tga': 'ui/tiles/main/background.tga', 'NMLD UI v2.0.1/tiles/main/discord1.tga': 'ui/tiles/main/discord1.tga' });
  // Lawrence brothers / MXON Brazil wallpapers: loose loading screens.
  assert.deepEqual(dests(files('bkgrnd.tga', 'Splash.tga')), { 'bkgrnd.tga': 'ui/bkgrnd.tga', 'Splash.tga': 'ui/splash.tga' });
  // MSX The Game UI: an UI folder.
  assert.deepEqual(dests(files('UI/bkgrnd.tga', 'UI/splash.tga')), { 'UI/bkgrnd.tga': 'ui/bkgrnd.tga', 'UI/splash.tga': 'ui/splash.tga' });
  // Semi trailer backgrounds: a bare bg.map; others ship misc/bg/... or a bg folder, or bg.pkz.
  assert.deepEqual(dests(files('bg.map')), { 'bg.map': 'misc/bg/bg.map' });
  assert.deepEqual(dests(files('Dolu/misc/bg/bg.map', 'Dolu/misc/bg/bg.amb', 'readme.txt')), { 'Dolu/misc/bg/bg.map': 'misc/bg/bg.map', 'Dolu/misc/bg/bg.amb': 'misc/bg/bg.amb', 'readme.txt': null });
  assert.deepEqual(dests(files('Camper/bg/bg.map')), { 'Camper/bg/bg.map': 'misc/bg/bg.map' });
  assert.deepEqual(dests(files('bg.pkz')), { 'bg.pkz': 'misc/bg.pkz' });
});

test('launchers, previews and unknown or clashing files are not placed by guess', () => {
  const d = dests(files('Rotating/random.bat', 'Rotating/splash/01.tga', 'Rotating/preview.jpg',
    'Booth/Option A/bkgrnd.tga', 'Booth/Option B/bkgrnd.tga'));
  assert.equal(d['Rotating/random.bat'], null, 'never copied (and never run)');
  assert.equal(d['Rotating/preview.jpg'], null);
  assert.equal(d['Rotating/splash/01.tga'], undefined, 'no known place: the player chooses');
  assert.equal(d['Booth/Option A/bkgrnd.tga'], undefined, 'two options for one file: the player chooses');
  assert.equal(d['Booth/Option B/bkgrnd.tga'], undefined);
});

test('MXB Mods UI and Menu Backgrounds posts install into the game folder', () => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'mxb-menu-'));
  try {
    fs.mkdirSync(path.join(game, 'ui')); fs.writeFileSync(path.join(game, 'ui', 'bkgrnd.tga'), 'original');
    for (const cat of [168, 57]) assert.equal(installer.kindFromCategories([cat]), 'menuUi');
    const p = installer.plan(files('bkgrnd.tga', 'Splash.tga', 'launch.bat'), { categories: [168], title: 'Loading screen', modsDir: path.join(game, 'mods'), installDir: game }, {});
    assert.equal(p.root, 'game');
    assert.deepEqual(p.entries.map((e) => [e.dest, e.status]), [['ui/bkgrnd.tga', 'overwrite'], ['ui/splash.tga', 'new'], [null, 'skip']]);
    assert.ok(p.warnings.some((w) => /never runs/.test(w)));
    assert.ok(p.warnings.some((w) => /backed up first/.test(w)), 'the replaced game file is backed up');
  } finally { fs.rmSync(game, { recursive: true, force: true }); }
});
