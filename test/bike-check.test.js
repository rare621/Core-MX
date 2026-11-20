const { test } = require('node:test');
const assert = require('node:assert/strict');
const bikeCheck = require('../src/renderer/bike-check');

// The game's names (bike .ini "name") against folder names, as seen in the MX OEM pack (2026-11-20).
const installed = ['MX1OEM_2023_Kawasaki_KX450', 'MX2OEM_2023_Honda_CRF250R', 'MX1OEM_2023_KTM_250_SX', 'MXEOEM_2023_Stark_VARG', 'FACTORY_KX250F'];

test('OEM bikes match the game\'s name to the folder; missing ones point to their official pack', () => {
  assert.equal(bikeCheck.haveBike('Kawasaki KX450 2023', installed), true);
  assert.equal(bikeCheck.haveBike('Honda CRF250R 2023', installed), true);
  assert.equal(bikeCheck.haveBike('KTM 250 SX 2023', installed), true);
  assert.equal(bikeCheck.haveBike('Kawasaki KX450 2024', installed), false, 'another year is another bike');
  assert.equal(bikeCheck.haveBike('', installed), null);
  const r = bikeCheck.check([
    { name: 'A', bike: 'Kawasaki KX450 2023', category: 'MX1 OEM' },
    { name: 'B', bike: 'Yamaha YZ450F 2024', category: 'MX1 OEM' },
    { name: 'C', bike: 'Yamaha YZ450F 2024', category: 'MX1 OEM' },
    { name: 'D', bike: 'Husqvarna FE 350 2024', category: 'Enduro OEM' },
    { name: 'E', bike: 'E10 KX250F', category: 'E10 250' },
  ], installed);
  assert.deepEqual(r.packs.map((p) => [p.pack, p.bikes.map((b) => b.bike)]), [['mx', ['Yamaha YZ450F 2024']], ['enduro', ['Husqvarna FE 350 2024']]]);
  assert.deepEqual(r.packs[0].bikes[0].riders, ['B', 'C'], 'one row per bike');
  assert.deepEqual(r.mods.map((b) => b.bike), ['E10 KX250F']);
  assert.equal(r.noneOwned, false);
});

test('no bikes in common is flagged; an empty server is not', () => {
  assert.equal(bikeCheck.check([{ name: 'A', bike: 'Yamaha YZ450F 2024', category: 'MX1 OEM' }], installed).noneOwned, true);
  assert.equal(bikeCheck.check([], installed).missing.length, 0);
  assert.equal(bikeCheck.check([{ name: 'A', bike: 'Stark VARG 2023', category: 'MX-E OEM' }], installed).missing.length, 0);
  assert.equal(bikeCheck.packFor('SM OEM'), 'sm');
  assert.equal(bikeCheck.packFor('MX2-2T OEM'), 'mx');
  assert.equal(bikeCheck.packFor('E10 250'), null);
});
