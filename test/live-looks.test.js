const { test } = require('node:test');
const assert = require('node:assert/strict');
const { looksText, RELOAD_FOR } = require('../src/lib/online');

// The plugin (plugin/mxbm_presence.c, looksPoll) reads: a header "coremx-looks 1 <stamp>", a
// "reload" line, and "look" lines of 14 tab-separated columns (the plugin also accepts the older 12): look, race number, bike id,
// then bike paint, rider, helmet, helmet paint, goggles, suit, gloves, boots, boots paint,
// protection, protection paint ("None" = no protection).
test('live looks file matches the layout the plugin parses', () => {
  const text = looksText([{
    num: 526, bikeId: 'MX2OEM_2023_Kawasaki_KX250',
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
  assert.equal(cols.length, 14);
  assert.deepEqual(cols.slice(0, 3), ['look', '526', 'MX2OEM_2023_Kawasaki_KX250']);
  assert.equal(cols[3], 'Teal_2023_Kawasaki_KX250#152');
  assert.equal(cols[4], '', 'a slot the rider did not share is left empty (the plugin keeps the game\'s choice)');
  assert.equal(cols[5], '2021_6D_ATR-2_ARMEGA');
  assert.equal(cols[6], '6datr2 FXR whiteblue', 'tabs inside names cannot break the columns');
  assert.deepEqual(cols.slice(10), ['Fox Instinct 2.0 by Aeffertz', 'Black', 'RopeChain', '']);
  // Every downloaded paint or model maps to a list the plugin knows how to reload.
  for (const kind of Object.values(RELOAD_FOR)) assert.match(kind, /^(bikepaints|helmets|helmetpaints|riderpaints|boots|bootpaints|protections|protectionpaints)$/);
});
