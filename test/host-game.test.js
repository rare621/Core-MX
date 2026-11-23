const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Host page's "Ride with friends" (src/renderer/host.js), run with a stand-in for the app.
function hostPage(profileUi, category = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/host.js'), 'utf8');
  const calls = [];
  const context = vm.createContext({
    S: { host: { mode: 'game' } }, document: { addEventListener() {} }, debounce: (fn) => fn, console, esc: (v) => String(v),
    api: { on() {}, invoke: async (ch, ...args) => { calls.push([ch, ...args]); return ch === 'game:settings' ? { values: { ui: profileUi, category } } : null; } },
  });
  vm.runInContext(source + '\n;this.defaultHost = defaultHost; this.loadFromProfile = loadFromProfile; this.setupInGameHost = setupInGameHost; this.categoriesHtml = categoriesHtml;', context);
  return { context, calls };
}

test('Ride with friends writes the bike classes where MX Bikes reads them (race_class)', async () => {
  const { context, calls } = hostPage({});
  const cfg = context.defaultHost();
  cfg.mode = 'game'; cfg.categories = ['MX1 OEM', 'MX2 OEM'];
  context.S.host.cfg = cfg;
  await context.setupInGameHost();
  const written = calls.find((c) => c[0] === 'game:setValues')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(written.filter((v) => /^race_(class|category)$/.test(v[1])))), [['ui', 'race_class', 'MX1 OEM/MX2 OEM'], ['ui', 'race_category', 'MX1 OEM/MX2 OEM']]);
  assert.ok(calls.some((c) => c[0] === 'game:launch'));
  // None picked: the game's own choice stays.
  cfg.categories = []; calls.length = 0;
  await context.setupInGameHost();
  assert.ok(!calls.find((c) => c[0] === 'game:setValues')[1].some((v) => v[1] === 'race_class'));
});

test('Ride with friends reads the game\'s classes, including mod-bike classes', async () => {
  const { context } = hostPage({ race_class: 'MX1/MX1 OEM/MX2 OEM', race_category: 'MX3 OEM' }, { 'E10 250': 'FACTORY_KX250F', 'MX1 OEM': 'x' });
  const cfg = context.defaultHost();
  context.S.host.cfg = cfg;
  await context.loadFromProfile(cfg);
  assert.deepEqual(JSON.parse(JSON.stringify(cfg.categories)), ['MX1', 'MX1 OEM', 'MX2 OEM'], 'race_class wins over the old race_category');
  const chips = context.categoriesHtml(cfg);
  for (const c of ['E10 250', 'MX1', 'MX1 OEM']) assert.ok(chips.includes(`data-hc="${c}"`), c);
});
