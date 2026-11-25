const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const load = source.slice(source.indexOf('async function loadRiderModel()'), source.indexOf('function listPicker('));

test('changing rider models resets body paints in the draft without changing shared gear or saving', async () => {
  const rider = { drafts: { Bike: { suitPaint: 'Previous kit' } }, lo: { savedCurrent: { rider: 'default_mx', suitPaint: 'Saved kit', glovesPaint: 'Saved gloves', helmet: 'Helmet' } } };
  let renders = 0;
  const context = vm.createContext({ S: { rider }, riderDraftKey: () => 'Bike', $: () => ({}), renderRider: () => renders++ });
  vm.runInContext(source.slice(source.indexOf('const RESETS ='), source.indexOf('function gearBrand')) + source.slice(source.indexOf('async function saveSlot('), source.indexOf("document.addEventListener('click'", source.indexOf('async function saveSlot('))), context);
  await context.saveSlot('rider', 'Hoodie');
  assert.deepEqual(JSON.parse(JSON.stringify(rider.drafts.Bike)), { rider: 'Hoodie', suitPaint: '', glovesPaint: '' });
  assert.equal(renders, 1);
});
test('editing either outfit or bike replaces the active profile badge with Preview changes', () => {
  const html = source.slice(source.indexOf('function profileControlsHtml()'), source.indexOf('function mountProfileControls()'));
  let dirty = false;
  const context = vm.createContext({ S: { rider: { profile: 'Practice', profiles: ['Practice'], lo: { profileActive: true } } }, riderDirty: () => dirty, icon: () => '', esc: (s) => s });
  vm.runInContext(html, context);
  assert.match(context.profileControlsHtml(), /Active in game/);
  dirty = true;
  assert.match(context.profileControlsHtml(), /Preview changes/);
  assert.doesNotMatch(context.profileControlsHtml(), /Active in game|Use in game/);
});
test('rider preview sends unsaved outfit paints and ignores an older model response', async () => {
  const requests = [], shown = [], nodes = { '#stageStatus': {}, '#stageNote': {} };
  const rider = { profile: 'Practice', bike: 'KX250', lo: { current: { helmet: 'Helmet', helmetPaint: 'White', gogglesPaint: 'Blue', suitPaint: 'Kit', glovesPaint: 'Gloves' } }, viewer: { load: (m) => shown.push(m.id) } };
  const context = vm.createContext({ S: { rider }, $: (id) => nodes[id], icon: () => '', esc: (s) => s, riderShowBike: () => false, api: { invoke: (channel, ...args) => new Promise((resolve) => requests.push({ channel, args: structuredClone(args), resolve })) } });
  vm.runInContext(load, context);
  const first = context.loadRiderModel();
  assert.equal(requests[0].channel, 'rider:model');
  assert.deepEqual(requests[0].args[2], rider.lo.current);
  rider.lo.current = { ...rider.lo.current, helmetPaint: 'Red', gogglesPaint: 'Yellow' };
  const second = context.loadRiderModel();
  requests[1].resolve({ id: 'new preview', warnings: [] }); await second;
  requests[0].resolve({ id: 'old preview', warnings: [] }); await first;
  assert.deepEqual(shown, ['new preview']);
  assert.equal(nodes['#stageStatus'].hidden, true);
  assert.equal(requests[1].args[2].helmetPaint, 'Red');
  assert.ok(requests.every((r) => r.channel !== 'rider:save' && r.channel !== 'rider:apply'));
});
