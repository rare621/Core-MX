const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const installer = require('../src/lib/installer');
const { detectKind } = require('../src/lib/detect');

// Layouts of real MXB Mods downloads, one or more per category (checked 2026-11-20).
const files = (...rels) => rels.map((rel) => ({ rel, abs: '', size: 1 }));
function folders() {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'mxbm-cat-'));
  const mods = path.join(game, 'mods');
  for (const b of ['MX1OEM_2023_Yamaha_YZ450F', 'MX1OEM_2023_KTM_450_SX-F', 'MX1OEM_2023_Kawasaki_KX450']) {
    fs.mkdirSync(path.join(mods, 'bikes', b, 'paints'), { recursive: true });
    fs.writeFileSync(path.join(mods, 'bikes', b + '.pkz'), 'x');
  }
  return { game, mods, done: () => fs.rmSync(game, { recursive: true, force: true }) };
}
const plan = (list, categories, extra = {}, opts = {}) => {
  const f = folders();
  try { return installer.plan(list, { categories, title: '', modsDir: f.mods, installDir: f.game, userDir: f.game, profile: 'Rider', ...extra }, opts); }
  finally { f.done(); }
};
const map = (p) => Object.fromEntries(p.entries.map((e) => [e.rel, e.dest]));

test('fonts, paint templates, wheel textures and 3D assets are saved as files, programs as apps', () => {
  assert.equal(installer.packageKind(files("Jordan's Font Pack V4/KROP2.otf", "Jordan's Font Pack V4/Pluck.ttf"), [29, 42]), 'files');
  assert.equal(installer.packageKind(files('factory_mx.ttf'), [29, 42]), 'files');
  assert.equal(installer.packageKind(files('pirelli/tires.tga', 'pirelli/tires_n.tga'), [29, 382]), 'files', 'tyre textures to pack with paintED');
  assert.equal(installer.packageKind(files('AN - Finish Line/AN - Finish Line.fbx', 'AN - Finish Line/AN - Finish Line.tga'), [40, 119]), 'files');
  assert.equal(installer.packageKind(files('SYDOME MK12.edf'), [40, 136]), 'files', 'a skydome for track builders');
  assert.equal(installer.packageKind(files('MXB-DualSense-Support.exe', 'README.txt', 'LICENSE.txt', 'licenses/cffi-2.1.1-LICENSE'), [40, 55]), 'app');
  // Game mods are never diverted.
  assert.equal(installer.packageKind(files('Deegan_Rider38_Fonts/rider/fonts/Deegan38_B/name.tga', 'Deegan_Rider38_Fonts/rider/fonts/Deegan38_B/Deegan38_B.ini'), [41, 30]), null);
  assert.equal(installer.packageKind(files('MXBikes-PBTool/PBTool.exe', 'root/misc/hud/pitboard_01.cfg'), [40, 605]), null);
  assert.equal(installer.packageKind(files('mxbmrp3.dlo', 'mxbmrp3_data/fonts/a.fnt'), [40, 56]), null);
  assert.equal(installer.packageKind(files('KX_Stand.pnt'), [40, 366]), null);
});

test('wheels go to tyres, not bikes; a loose tyre folder keeps its name', () => {
  const sponge = plan(files('Spongebob Wheels/p_mx.pkz', 'Spongebob Wheels/README.txt'), [29, 95]);
  assert.equal(sponge.kind, 'tyre');
  assert.equal(map(sponge)['Spongebob Wheels/p_mx.pkz'], 'tyres/p_mx.pkz');
  const hotfix = plan(files('m_sm/m_sm.cfg', 'm_sm/m_sm_f_soft.tyre', 'm_sm/m_sm_r_hard.tyre', 'readme.txt'), [29, 95]);
  assert.deepEqual(map(hotfix), { 'm_sm/m_sm.cfg': 'tyres/m_sm/m_sm.cfg', 'm_sm/m_sm_f_soft.tyre': 'tyres/m_sm/m_sm_f_soft.tyre', 'm_sm/m_sm_r_hard.tyre': 'tyres/m_sm/m_sm_r_hard.tyre', 'readme.txt': null });
  assert.equal(hotfix.confident, true);
  // A tyre .pkz posted under Bikes > Others.
  assert.equal(map(plan(files('m_sm.pkz'), [29, 92]))['m_sm.pkz'], 'tyres/m_sm.pkz');
});

test('the E10 wheel fix script is replaced by copying the stock wheel files itself', () => {
  const p = plan(files('E10_Bikes_Wheel_Fix/Install_E10_Wheels.ps1', 'E10_Bikes_Wheel_Fix/Run_Install.bat', 'E10_Bikes_Wheel_Fix/README.txt'), [40, 55]);
  assert.equal(p.kind, 'tyre');
  assert.ok(p.entries.filter((e) => /\.(ps1|bat)$/i.test(e.rel)).every((e) => !e.dest && e.how === 'script'), 'scripts are never copied or run');
  const copies = p.entries.filter((e) => e.fromGame);
  assert.deepEqual(copies.map((e) => e.dest).sort(), ['c_p_mx.edf', 'fwheel.hrc', 'gfx.cfg', 'p_mx.edf', 'p_mx_as.edf', 'p_mx_s.edf', 'rwheel.hrc'].map((n) => `tyres/Factory_tyre/${n}`).sort());
  assert.ok(copies.every((e) => e.fromGame.pkz === 'tyres.pkz' && e.fromGame.inner.startsWith('tyres/p_mx/')));
  assert.equal(p.root, 'mods');
  const noGame = plan(files('E10_Bikes_Wheel_Fix/Install_E10_Wheels.ps1'), [40, 55], { installDir: '' });
  assert.ok(noGame.entries.filter((e) => e.fromGame).every((e) => !e.dest));
});

test('apply copies game files from the game folder even for a mods install', async () => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'mxbm-e10-'));
  try {
    const mods = path.join(game, 'mods'); fs.mkdirSync(mods);
    fs.mkdirSync(path.join(game, 'tyres', 'p_mx'), { recursive: true });
    fs.writeFileSync(path.join(game, 'tyres', 'p_mx', 'gfx.cfg'), 'stock');
    const p = { root: 'mods', gameDir: game, entries: [{ rel: '(game)', abs: null, fromGame: { loose: 'tyres/p_mx/gfx.cfg', pkz: 'tyres.pkz', inner: 'tyres/p_mx/gfx.cfg' }, dest: 'tyres/Factory_tyre/gfx.cfg' }] };
    assert.deepEqual(await installer.apply(p, mods), ['tyres/Factory_tyre/gfx.cfg']);
    assert.equal(fs.readFileSync(path.join(mods, 'tyres', 'Factory_tyre', 'gfx.cfg'), 'utf8'), 'stock');
  } finally { fs.rmSync(game, { recursive: true, force: true }); }
});

test('number fonts go to misc/fonts (bike) and rider/fonts (rider); paints in Fonts are liveries', () => {
  const bike = plan(files('Pack/Factory Red/Factory Red.ini', 'Pack/Factory Red/gfx.cfg', 'Pack/Factory Red/plate.tga'), [29, 42]);
  assert.equal(bike.kind, 'bikeFont');
  assert.deepEqual(Object.values(map(bike)), ['misc/fonts/Factory Red/Factory Red.ini', 'misc/fonts/Factory Red/gfx.cfg', 'misc/fonts/Factory Red/plate.tga']);
  const loose = plan(files('Blue.ini', 'gfx.cfg', 'plate.tga'), [29, 42]);
  assert.deepEqual(Object.values(map(loose)), ['misc/fonts/Blue/Blue.ini', 'misc/fonts/Blue/gfx.cfg', 'misc/fonts/Blue/plate.tga']);
  const rider = plan(files('Thor/Thor_W/Thor_W.ini', 'Thor/Thor_W/gfx.cfg', 'Thor/Thor_W/name.tga', 'Thor/Thor_W/number.tga'), [41, 30]);
  assert.equal(rider.kind, 'riderFont');
  assert.ok(Object.values(map(rider)).every((d) => d.startsWith('rider/fonts/Thor_W/')));
  const structured = plan(files('Deegan/rider/fonts/D38/D38.ini', 'Deegan/rider/fonts/D38/name.tga'), [41, 30]);
  assert.deepEqual(Object.values(map(structured)), ['rider/fonts/D38/D38.ini', 'rider/fonts/D38/name.tga']);
  assert.equal(plan(files('GasGas24FactorEd.pnt'), [29, 42]).kind, 'bikePaint');
});

test('setups go in the profile: setups/common/<bike>', () => {
  const yz = plan(files('documents/piboso/Mx Bikes/Profiles/( your profile)/setups/common/MX1OEM_2023_Yamaha_YZ450F/YZ450F MX setup.stp'), [610, 29]);
  assert.equal(yz.root, 'user');
  assert.equal(yz.entries[0].dest, 'profiles/Rider/setups/common/MX1OEM_2023_Yamaha_YZ450F/YZ450F MX setup.stp');
  assert.equal(yz.confident, true);
  assert.equal(yz.paintModelsBase, null, 'no bike to choose');
  const mds = plan(files('MDS.stp'), [610, 29], { title: 'MDS | YZ450 SETUP' });
  assert.equal(mds.options.paintTarget, 'MX1OEM_2023_Yamaha_YZ450F', 'suggested from the name');
  assert.equal(mds.paintGuess, 'title');
  assert.equal(mds.confident, false, 'the player confirms a suggested bike');
  assert.equal(mds.entries[0].dest, 'profiles/Rider/setups/common/MX1OEM_2023_Yamaha_YZ450F/MDS.stp');
  const unknown = plan(files('fast.stp'), [610, 29], { title: 'my setup' });
  assert.equal(unknown.needsPaintTarget, true);
  assert.equal(unknown.paintModelsBase, 'bikes');
  const chosen = plan(files('fast.stp'), [610, 29], { title: 'my setup' }, { paintTarget: 'MX1OEM_2023_KTM_450_SX-F' });
  assert.equal(chosen.entries[0].dest, 'profiles/Rider/setups/common/MX1OEM_2023_KTM_450_SX-F/fast.stp');
  const inFolder = plan(files('Setups/MX1OEM_2023_Kawasaki_KX450/sand.stp'), [610, 29]);
  assert.equal(inFolder.entries[0].dest, 'profiles/Rider/setups/common/MX1OEM_2023_Kawasaki_KX450/sand.stp');
  const noProfile = plan(files('fast.stp'), [610, 29], { profile: null }, { paintTarget: 'MX1OEM_2023_KTM_450_SX-F' });
  assert.equal(noProfile.installable, 0);
  assert.ok(noProfile.warnings.some((w) => /profile/i.test(w)));
});

test('translations go to MX Bikes/ui as a new language', () => {
  const p = plan(files('italian.str'), [40, 351]);
  assert.equal(p.kind, 'translation');
  assert.equal(p.root, 'game');
  assert.equal(p.entries[0].dest, 'ui/italian.str');
  assert.ok(p.warnings.some((w) => /Language/.test(w)));
});

test('stands go to MX Bikes/misc/stand; a pack of stands asks which one', () => {
  const brands = ['GasGas', 'KTM'].flatMap((b) => ['gfx.cfg', 'stand.edf', 'stand.ini', 'stand_s.edf'].map((n) => `Garb's Risk Stand/Drop in stands/${b}/stand/${n}`));
  const pack = files(...brands, "Garb's Risk Stand/PSD/Stand.psd", "Garb's Risk Stand/TGA's for Paint packing/KTM/Stand_Tex.tga", "Garb's Risk Stand/ReadMe.txt");
  const waiting = plan(pack, [40, 366]);
  assert.equal(waiting.kind, 'stand');
  assert.deepEqual(waiting.variants.map((v) => v.label), ['GasGas', 'KTM']);
  assert.equal(waiting.needsVariant, true);
  assert.equal(waiting.installable, 0);
  const ktm = plan(pack, [40, 366], {}, { variant: "Garb's Risk Stand/Drop in stands/KTM" });
  assert.deepEqual(ktm.entries.filter((e) => e.dest).map((e) => e.dest).sort(), ['misc/stand/gfx.cfg', 'misc/stand/stand.edf', 'misc/stand/stand.ini', 'misc/stand/stand_s.edf']);
  assert.ok(ktm.entries.filter((e) => e.dest).every((e) => e.rel.includes('/KTM/')));
  assert.equal(ktm.needsVariant, false);
  const acerbis = plan(files('CLUBMX/stand.edf', 'HEP/stand.edf'), [40, 366], {}, { variant: 'HEP' });
  assert.deepEqual(map(acerbis), { 'CLUBMX/stand.edf': null, 'HEP/stand.edf': 'misc/stand/stand.edf' });
  assert.equal(plan(files('KX_Stand.pnt'), [40, 366]).kind, 'bikePaint', 'a stand paint is a bike paint');
});

test('pitboards: HUD board to MX Bikes/misc/hud, trackside files to misc/pitboard, MXBMRP3 textures to its folder', () => {
  assert.deepEqual(map(plan(files('pitboard.tga'), [40, 605])), { 'pitboard.tga': 'misc/hud/pitboard.tga' });
  assert.deepEqual(map(plan(files('How2Install.txt', 'misc/hud/pitboard.cfg', 'misc/hud/pitboard16seg.tga'), [40, 605])), { 'How2Install.txt': null, 'misc/hud/pitboard.cfg': 'misc/hud/pitboard.cfg', 'misc/hud/pitboard16seg.tga': 'misc/hud/pitboard16seg.tga' });
  const crf = plan(files('Crf/hud/misk/pitboard.cfg', 'Crf/hud/misk/pitboard.edf', 'Crf/hud/misk/pitboard.tga'), [40, 605]);
  assert.deepEqual(Object.values(map(crf)), ['misc/pitboard/pitboard.cfg', 'misc/pitboard/pitboard.edf', 'misc/pitboard/pitboard.tga'], 'a 3D board is the trackside one');
  const brands = plan(files('Factory KTM Board/pitboard.cfg', 'Factory KTM Board/pitboard16seg.tga', 'Factory Honda Board/pitboard.cfg', 'Factory Honda Board/pitboard16seg.tga', 'ReadMe.txt'), [40, 605]);
  assert.equal(brands.needsVariant, true);
  assert.deepEqual(brands.variants.map((v) => v.id), ['Factory Honda Board', 'Factory KTM Board']);
  const lms = plan(files('docs/mods/misc/pitboard/pitboard_01.pnt', 'root/misc/hud/pitboard_01.cfg', 'root/misc/hud/pitboard_01.tga'), [40, 605]);
  assert.equal(map(lms)['docs/mods/misc/pitboard/pitboard_01.pnt'], null);
  assert.equal(map(lms)['root/misc/hud/pitboard_01.cfg'], 'misc/hud/pitboard_01.cfg');
  assert.ok(lms.warnings.some((w) => /rename/.test(w)) && lms.warnings.some((w) => /trackside/.test(w)));
  const mrp3 = plan(files('Pitboards/pitboard_hud_100.tga', 'Pitboards/pitboard_hud_101.tga', 'Pitboards/PREVIEW.png'), [40, 605]);
  assert.equal(mrp3.kind, 'hudTexture');
  assert.equal(mrp3.root, 'user');
  assert.deepEqual(map(mrp3), { 'Pitboards/pitboard_hud_100.tga': 'mxbmrp3/textures/pitboard_hud_100.tga', 'Pitboards/pitboard_hud_101.tga': 'mxbmrp3/textures/pitboard_hud_101.tga', 'Pitboards/PREVIEW.png': null });
});

test('a trackside pitboard.cfg is recognised by its contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mxbm-pit-'));
  try {
    fs.writeFileSync(path.join(dir, 'pitboard.cfg'), 'texture = w_pitboard\nhandgripx = 0.24\n');
    const p = plan([{ rel: 'Board/pitboard.cfg', abs: path.join(dir, 'pitboard.cfg'), size: 1 }, { rel: 'Board/pitboard.tga', abs: '', size: 1 }], [40, 605]);
    assert.deepEqual(Object.values(map(p)), ['misc/pitboard/pitboard.cfg', 'misc/pitboard/pitboard.tga']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('categories without a type use what is inside; a paint that names a bike is a livery', async () => {
  const ktm = plan(files('blue-and-black-ktm.pnt'), [175, 40], { title: 'KTM 450 SX-F 2023 – Custom Black/Blue Paint' });
  assert.equal(ktm.kind, 'bikePaint');
  assert.equal(map(ktm)['blue-and-black-ktm.pnt'], 'bikes/MX1OEM_2023_KTM_450_SX-F/paints/blue-and-black-ktm.pnt');
  assert.equal(plan(files('mystery.pnt'), [175, 40], { title: 'Cool thing' }).kind, 'custom');
  assert.equal((await detectKind(files('YZ 450.stp'))).kind, 'setup');
  assert.equal((await detectKind(files('suomi.str'))).kind, 'translation');
  assert.equal((await detectKind(files('Red/Red.ini', 'Red/plate.tga'))).kind, 'bikeFont');
  assert.equal((await detectKind(files('W/name.tga', 'W/number.tga'))).kind, 'riderFont');
  assert.equal((await detectKind(files('stand/stand.edf', 'stand/gfx.cfg'))).kind, 'stand');
  assert.equal((await detectKind(files('misc/hud/pitboard.tga'))).kind, 'pitboard');
  const hinted = plan(files('booter.stp'), [175, 40], { kindHint: 'setup' }, { paintTarget: 'MX1OEM_2023_KTM_450_SX-F' });
  assert.equal(hinted.kind, 'setup');
});

test('plugin licence files are not copied into the plugins folder', () => {
  const p = plan(files('LICENSE', 'mxbmrp3.dlo', 'mxbmrp3_data/fonts/a.fnt'), [40, 56]);
  assert.equal(map(p).LICENSE, null);
  assert.equal(map(p)['mxbmrp3.dlo'], 'plugins/mxbmrp3.dlo');
});
