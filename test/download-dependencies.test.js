const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enrich, forDownload } = require('../src/lib/download-dependencies');
test('separate helmet downloads match their own model, including roman numeral names', () => {
  const dependencies = enrich([{ label: 'AIROH AVIATOR III – JPD', url: 'https://mxb-mods.com/airoh-aviator-iii-jpd/' }], [], '<p>Remember to have the correct helmet models installed<br>AIROH https://mxb-mods.com/airoh-aviator-iii-jpd/<br>ASTARS SM10 https://mxb-mods.com/astars-sm10-24-jpd/<br>6D https://mxb-mods.com/2021-6d-atr-2/</p>');
  assert.equal(dependencies.length, 3);
  const downloads = ['Alpinestars SM10', '6D ATR-2', 'Airoh Aviator 3'].map((label) => ({ label }));
  for (const [i, slug] of ['astars-sm10', '6d-atr-2', 'airoh-aviator'].entries()) {
    const matched = forDownload(downloads[i], dependencies, downloads);
    assert.equal(matched.length, 1); assert.ok(matched[0].url.includes(slug));
  }
  assert.deepEqual(forDownload({ label: 'Download' }, dependencies, downloads), []);
});
test('explicit model swap download links become named requirements, not generic here buttons', () => {
  const downloads = [{ label: 'Modelswap 450 link', shop: 'mxbs', url: 'https://mxbikes-shop.com/downloads/2027-husqvarna-450/' }, { label: 'Modelswap 250 link', shop: 'mxbs', url: 'https://mxbikes-shop.com/downloads/2027-husqvarna-250/' }];
  const deps = enrich([], downloads);
  assert.equal(deps.length, 2); assert.ok(deps.every((d) => d.kind === 'bikeSwap' && d.label.includes('husqvarna')));
  assert.deepEqual(forDownload(downloads[0], deps, downloads), []);
});
