const { test } = require('node:test');
const assert = require('node:assert/strict');
const sg = require('../src/lib/synced-gear');

const received = {
  'rider/helmets/Bell Moto 10 EKS.pkz': { from: 'Rare621' },
  'rider/helmets/Bell Moto 10 EKS/paints/Team Red.pnt': { from: 'Rare621' },
  'rider/helmets/My Own Lid/paints/Friend Paint.pnt': { from: 'Rare621' },
  'rider/riders/default_mx/paints/BLACK CAMO FXR.pnt': { from: 'Uhh_sal' },
  'rider/riders/default_mx/gloves/wldvln-frenzy-black.pnt': { from: 'Uhh_sal' },
  'bikes/MX2OEM_2023_Kawasaki_KX250/paints/SV Camo KX250F Public.pnt': { from: 'Uhh_sal' },
  'rider/boots/TCrainTech10.pkz': { from: 'Uhh_sal' },
};
const installs = { 9: { postId: 9, files: ['rider/riders/default_mx/gloves/wldvln-frenzy-black.pnt'] } };

test('synced files nobody installed are kept apart', () => {
  const synced = sg.syncedOnly(received, installs);
  assert.ok(synced.has('rider/helmets/bell moto 10 eks.pkz'));
  assert.ok(!synced.has('rider/riders/default_mx/gloves/wldvln-frenzy-black.pnt'), 'installed from Get Mods too: ordinary gear');
});

test('the Rider tab does not offer synced-only gear, except what is selected', () => {
  const synced = sg.syncedOnly(received, installs);
  const hide = sg.hiddenChoices(synced, { helmet: 'Bell Moto 10 EKS', boots: 'TCrainTech10' }, 'MX2OEM_2023_Kawasaki_KX250', (kind, name) => kind === 'boots' && name === 'tcraintech10');
  assert.deepEqual([...hide.helmet], ['bell moto 10 eks']);
  assert.deepEqual([...hide.helmetPaint], ['team red']);
  assert.equal(hide.boots, undefined, 'boots also installed another way stay a choice');
  assert.deepEqual([...hide.suitPaint], ['black camo fxr']);
  assert.deepEqual([...hide.bikePaint], ['sv camo kx250f public']);
  const options = { helmet: ['default', 'Bell Moto 10 EKS', '2018_astars_sm_10'], suitPaint: ['BLACK CAMO FXR', 'Mine'], bikePaint: ['', 'SV Camo KX250F Public'] };
  const out = sg.filterOptions(options, hide, { helmet: 'default', suitPaint: 'BLACK CAMO FXR' });
  assert.deepEqual(out.helmet, ['default', '2018_astars_sm_10']);
  assert.deepEqual(out.suitPaint, ['BLACK CAMO FXR', 'Mine'], 'the selected one stays');
  assert.deepEqual(out.bikePaint, ['']);
});

test('installing the mod yourself makes it ordinary gear again', () => {
  // Get Mods wrote the helmet as a folder: the synced package is a duplicate and goes; its synced paint stays synced.
  const folder = sg.releaseAfterInstall(received, ['rider/helmets/Bell Moto 10 EKS/helmet.edf', 'rider/helmets/Bell Moto 10 EKS/paints/Stock.pnt']);
  assert.deepEqual(folder, { forget: ['rider/helmets/Bell Moto 10 EKS.pkz'], trash: ['rider/helmets/Bell Moto 10 EKS.pkz'] });
  // Same package path: the install owns the file now (nothing to delete).
  assert.deepEqual(sg.releaseAfterInstall(received, ['rider/helmets/Bell Moto 10 EKS.pkz']), { forget: ['rider/helmets/Bell Moto 10 EKS.pkz'], trash: [] });
  // A paint pack for a synced helmet is not the helmet.
  assert.deepEqual(sg.releaseAfterInstall(received, ['rider/helmets/Bell Moto 10 EKS/paints/Pack.pnt']), { forget: [], trash: [] });
});

test('the in-game overlay gets the same list', () => {
  const synced = sg.syncedOnly(received, installs);
  const text = sg.overlayList(synced, (kind, name) => kind === 'boots' && name === 'tcraintech10');
  assert.deepEqual(text.trim().split('\n').sort(), [
    'bikePaint\tmx2oem_2023_kawasaki_kx250\tsv camo kx250f public',
    'coremx-synced 1',
    'helmet\t\tbell moto 10 eks',
    'helmetPaint\tbell moto 10 eks\tteam red',
    'helmetPaint\tmy own lid\tfriend paint',
    'suitPaint\t\tblack camo fxr',
  ]);
});
