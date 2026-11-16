const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/lib/dependency-match');

test('picks the best installed model, not the first loose match', () => {
  const dep = { label: 'Fox Instinct 2.0 boots', url: 'https://mxb-mods.com/fox-instinct-2-0/' };
  assert.equal(m.matchingModel(['fox_comp', 'fox_instinct', 'fox_instinct_2'], dep), 'fox_instinct_2');
});

test('a different generation number is not counted as installed', () => {
  const dep = { label: 'Alpinestars Tech 10', url: 'https://mxb-mods.com/alpinestars-tech-10/' };
  assert.equal(m.matchingModel(['alpinestars_tech7'], dep), null);
  assert.equal(m.matchingModel(['astars_tech10'], dep), 'astars_tech10');
});

test('dependency kinds cover rider models and common product names', () => {
  assert.equal(m.dependencyModelKind({ label: 'ABDesigns Hoodie' }), 'riders');
  assert.equal(m.dependencyModelKind({ label: 'Alpinestars Tech 10' }), 'boots');
  assert.equal(m.dependencyModelKind({ label: 'Airoh Aviator 3' }), 'helmets');
  assert.equal(m.dependencyModelKind({ label: 'Leatt neck brace' }), 'protections');
  assert.equal(m.dependencyModelKind({ label: 'PSD template' }), null);
});

test('templates and social links are never treated as required models', () => {
  assert.equal(m.isModelRequirement({ label: 'Helmet PSD template', url: 'https://mxb-mods.com/psd/' }), false);
  assert.equal(m.isModelRequirement({ label: 'Fox V3 helmet', url: 'https://mxb-mods.com/fox-v3/' }), true);
});

test('search ranking drops results for another generation', () => {
  assert.equal(m.dependencySearchScore({ title: 'Alpinestars Tech 7 boots' }, { label: 'Alpinestars Tech 10' }), 0);
  assert.ok(m.dependencySearchScore({ title: 'Alpinestars Tech 10 boots' }, { label: 'Alpinestars Tech 10' }) > 0);
});

test('tracks and whole bikes are standalone, paint categories are not', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const module = { exports: {} };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/site.js'), 'utf8'), vm.createContext({ module, exports: module.exports, URL, URLSearchParams, AbortSignal, Response, setTimeout, clearTimeout, require: (n) => n === 'electron' ? { net: {} } : require(n) }));
  const { standalone } = module.exports;
  assert.equal(standalone([22]), true);
  assert.equal(standalone([45]), true);
  assert.equal(standalone([127]), false);
  assert.equal(standalone([35, 22]), false);
});
