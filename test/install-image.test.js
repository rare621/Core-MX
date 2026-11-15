const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ownsInstallFile } = require('../src/lib/install-image');
test('rider artwork does not come from paints or nested accessories, but their own cards retain install artwork', () => {
  const rider = 'rider/riders/default_mx';
  for (const child of ['gloves/red.pnt', 'paints/kit.pnt', 'helmets/helmet/helmet.edf', 'boots/boot.pkz', 'red.pnt']) assert.equal(ownsInstallFile(rider, rider + '/' + child), false);
  assert.equal(ownsInstallFile(rider, rider + '/rider.edf'), true);
  assert.equal(ownsInstallFile(rider, rider + '/gfx.cfg'), true);
  assert.equal(ownsInstallFile(rider + '/gloves/red.pnt', rider + '/gloves/red.pnt'), true);
  assert.equal(ownsInstallFile('rider/helmets/H', 'rider/helmets/H/helmet.edf'), true);
});
