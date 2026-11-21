const { test } = require('node:test');
const assert = require('node:assert/strict');
const { looksText, RELOAD_FOR } = require('../src/lib/online');

// The plugin (plugin/mxbm_presence.c, looksPoll) reads: a header "coremx-looks 1 <stamp>", a
// "reload" line, and "look" lines of 15 tab-separated columns (the plugin also accepts the older 12 and 14): look, race number, bike id,
// then bike paint, rider, helmet, helmet paint, goggles, suit, gloves, boots, boots paint,
// protection, protection paint ("None" = no protection).
test('live looks file matches the layout the plugin parses', () => {
  const text = looksText([{
    num: 526, name: 'Uhh_sal', bikeId: 'MX2OEM_2023_Kawasaki_KX250',
    equipped: [
      { slot: 'bikePaint', value: 'Teal_2023_Kawasaki_KX250#152' }, { slot: 'helmet', value: '2021_6D_ATR-2_ARMEGA' },
      { slot: 'helmetPaint', value: '6datr2 FXR\twhiteblue' }, { slot: 'boots', value: 'Fox Instinct 2.0 by Aeffertz' },
      { slot: 'bootsPaint', value: 'Black' }, { slot: 'protection', value: 'RopeChain' },
    ],
  }], ['bikepaints', 'helmets'], 1795044376521);
  const lines = text.replace(/\n$/, '').split('\n'); // (an empty last column ends in a tab)
  assert.equal(lines[0], 'coremx-looks 1 1795044376521');
  assert.equal(lines[1], 'reload\tbikepaints,helmets');
  const cols = lines[2].split('\t');
  assert.equal(cols.length, 15);
  assert.equal(cols[14], 'Uhh_sal', 'the CoreMX name is the last column');
  assert.deepEqual(cols.slice(0, 3), ['look', '526', 'MX2OEM_2023_Kawasaki_KX250']);
  assert.equal(cols[3], 'Teal_2023_Kawasaki_KX250#152');
  assert.equal(cols[4], '', 'a slot the rider did not share is left empty (the plugin keeps the game\'s choice)');
  assert.equal(cols[5], '2021_6D_ATR-2_ARMEGA');
  assert.equal(cols[6], '6datr2 FXR whiteblue', 'tabs inside names cannot break the columns');
  assert.deepEqual(cols.slice(10, 14), ['Fox Instinct 2.0 by Aeffertz', 'Black', 'RopeChain', '']);
  // Every downloaded paint or model maps to a list the plugin knows how to reload.
  for (const kind of Object.values(RELOAD_FOR)) assert.match(kind, /^(bikepaints|helmets|helmetpaints|riderpaints|boots|bootpaints|protections|protectionpaints)$/);
});

test('gear CoreMX is fetching from MXB Mods, or found nothing for, tells the overlay so', () => {
  const report = { items: [], unavailable: [
    { slot: 'helmet', label: 'Big', state: 'unavailable', find: { state: 'searching' } },
    { slot: 'boots', label: 'Boots: B', state: 'unavailable', find: { state: 'nomatch' } },
    { slot: 'protection', label: 'P', state: 'unavailable', error: 'Paid mod — not installing.' },
  ] };
  const lines = looksText([{ id: 'r', num: 2, bikeId: 'b', equipped: [] }], [], 1, { r: report }).trim().split('\n').filter((l) => l.startsWith('wait'));
  assert.deepEqual(lines, ['wait\t2\tb\tinstalling\tBig', 'wait\t2\tb\tnomatch\tB', 'wait\t2\tb\tpaid\tP']);
});

test('a rider found on the server by name (their plugin not reporting) still shows, with number and bike from your game', () => {
  const { withGameRider } = require('../src/lib/online');
  const game = [{ num: 917, name: 'YaBoiChase917 | BSM', bike: 'Kawasaki KX250 2023' }, { num: 501, name: 'Uhh_sal', bike: 'Honda CRF450R 2023' }, { num: 7, name: 'Sam', bike: 'X' }, { num: 8, name: 'Sam Two', bike: 'X' }];
  const out = withGameRider([
    { via: 'name', name: 'YaBoiChase917', bike: 'MX2OEM_2023_Kawasaki_KX250' },
    { via: 'name', name: 'Uhh_sal', bike: 'MX2OEM_2023_Kawasaki_KX250' },   // outfit shared for another bike
    { via: 'name', name: 'Sam', bike: 'X' },                                   // two riders match the name
    { via: 'plugin', name: 'P', num: 5, bikeId: 'B', bike: 'B' },
  ], game);
  assert.deepEqual(out.map((l) => [l.name, l.num, l.bikeId]), [['YaBoiChase917', 917, 'MX2OEM_2023_Kawasaki_KX250'], ['P', 5, 'B']]);
});

test('a paint for paid boots is not looked for or shown as its own problem: the boots are', () => {
  const report = { items: [], unavailable: [
    { slot: 'boots', label: 'A_Boots', state: 'unavailable', error: 'This file is tied to your account. Your friend needs their own copy.' },
    { slot: 'bootsPaint', label: 'Boot paint: Black White Orange', state: 'unavailable', find: { state: 'nomatch' } },
    { slot: 'suitPaint', label: 'Rider kit: OPOlitPROpub', state: 'unavailable', find: { state: 'nomatch' } },
  ] };
  const lines = looksText([{ id: 'r', num: 917, bikeId: 'b', equipped: [] }], [], 1, { r: report }).trim().split('\n').filter((l) => l.startsWith('wait'));
  assert.deepEqual(lines, ['wait\t917\tb\tpaid\tA_Boots', 'wait\t917\tb\tnomatch\tOPOlitPROpub']);
});
