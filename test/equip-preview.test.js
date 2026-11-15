const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const equip = require('../src/lib/equip-installed');
const profile = require('../src/lib/profile');
const { zip } = require('../src/lib/gear-sync');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-equip-preview-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, put: async (file, content = 'paint') => { const abs = path.join(root, file); await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.writeFile(abs, content); } };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('post-install choices include every bundled helmet paint and goggles but exclude older loose paints', async (t) => {
  const { root, put } = await fixture(t);
  const file = 'rider/helmets/Helmet.pkz';
  await put(file, zip([
    ['Helmet/gfx.cfg', Buffer.from('model')],
    ['Helmet/paints/Blue.pnt', Buffer.from('blue')],
    ['Helmet/paints/Red.pnt', Buffer.from('red')],
    ['Helmet/goggles/Smoke.pnt', Buffer.from('smoke')],
    ['Helmet/goggles/Clear.pnt', Buffer.from('clear')],
  ]));
  await put('rider/helmets/Helmet/paints/Unrelated.pnt');
  const choices = await equip.choicesFromFiles([file], root);
  const helmet = choices.find((c) => c.slot === 'helmetPaint');
  assert.equal(helmet.hasModel, true);
  assert.deepEqual(helmet.paints, ['Blue', 'Red']);
  assert.deepEqual(choices.find((c) => c.slot === 'gogglesPaint').paints, ['Clear', 'Smoke']);
  const lo = await profile.loadout(root, { sections: { helmet: { values: { Bike: 'Helmet' } } } }, 'Bike');
  assert.deepEqual(equip.availablePaints(helmet, lo.options.helmetPaint), ['Blue', 'Red']);
  assert.ok(lo.options.helmetPaint.includes('Unrelated'));
});

test('kit, glove and helmet file casing cannot change their slot or hide matching variants', () => {
  const choices = equip.choices(['rider/riders/default_mx/Gloves/Blue.PNT', 'rider/riders/default_mx/Paints/Flannel.PNT', 'rider/Helmets/Helmet/Goggles/Clear.PNT']);
  assert.deepEqual(choices.map((c) => c.slot), ['glovesPaint', 'suitPaint', 'gogglesPaint']);
  assert.deepEqual(equip.availablePaints(choices[1], ['flannel', 'Unrelated']), ['flannel']);
});

test('Get Mods uses the requested profile, bike and unsaved outfit, returning a draft without writing the game', async (t) => {
  const { root, put } = await fixture(t);
  const file = 'rider/riders/default_mx/paints/New Kit.pnt';
  await put(file);
  const saved = { sections: { info: { values: { bikeid: 'SavedBike' } }, rider: { values: { PreviewBike: 'Hoodie' } }, suit_paint: { values: { PreviewBike: 'Old Kit' } } } };
  const handlers = {}, reads = [], validated = [];
  const source = await fs.readFile(path.join(__dirname, '../main.js'), 'utf8');
  const context = vm.createContext({ structuredClone, jobs: new Map([['job', { status: 'done', equipCandidates: equip.choices([file]) }]]),
    handle: (name, fn) => { handlers[name] = fn; }, equipInstalled: equip,
    profile: { ...profile, listProfiles: async () => ({ last: 'SavedProfile' }), readProfile: async (_, name) => { reads.push(name); return saved; }, writeValues: () => { throw Error('Unexpected profile write'); } },
    gearAssets: require('../src/lib/gear-assets'), modsDir: () => root, profUserDir: () => 'isolated', stockRiderPkz: () => null,
    bike3d: require('../src/lib/bike3d'), store: { get: () => ({}) },
    paintCompat: { validateRiderPaint: async (data) => validated.push(data.current) },
  });
  vm.runInContext(source.slice(source.indexOf('  function draftProfile('), source.indexOf("  handle('rider:loadout'")) + source.slice(source.indexOf('  async function equipContext('), source.indexOf("  handle('jobs:cancel'")), context);
  const target = { profile: 'EditingProfile', bike: 'PreviewBike', changes: { rider: 'Hoodie', helmet: 'DraftHelmet', helmetPaint: 'DraftPaint', protection: '' } };
  const ctx = await handlers['jobs:equipContext']('job', 0, target);
  assert.equal(ctx.profile, 'EditingProfile'); assert.equal(ctx.bike, 'PreviewBike');
  assert.equal(ctx.lo.current.helmet, 'DraftHelmet'); assert.equal(ctx.lo.current.helmetPaint, 'DraftPaint');
  assert.equal(ctx.lo.current.rider, 'default_mx'); assert.equal(ctx.lo.current.suitPaint, 'New Kit');
  assert.deepEqual(ctx.preferred, ['New Kit']);
  const result = await handlers['jobs:equip']('job', 0, 'New Kit', target);
  assert.deepEqual(plain(result), { profile: 'EditingProfile', bike: 'PreviewBike', changes: { rider: 'default_mx', suitPaint: 'New Kit', glovesPaint: '' } });
  assert.ok(reads.every((name) => name === 'EditingProfile'));
  assert.equal(validated[0].helmetPaint, 'DraftPaint'); assert.equal(validated[0].protection, '');
  assert.equal(saved.sections.suit_paint.values.PreviewBike, 'Old Kit');
  await assert.rejects(handlers['jobs:equip']('job', 0, 'Not in this download', target), /Choose an installed paint/);
  const bikeFile = 'bikes/NewBike.pkz';
  await put(bikeFile, zip([['NewBike/gfx.cfg', Buffer.from('model')], ['NewBike/paints/Camo.pnt', Buffer.from('paint')]]));
  context.jobs.set('bike-job', { status: 'done', equipCandidates: await equip.choicesFromFiles([bikeFile], root) });
  const bikeContext = await handlers['jobs:equipContext']('bike-job', 0, { profile: 'EditingProfile', bike: 'NewBike', changes: {} });
  assert.deepEqual(plain(bikeContext.preferred), ['camo']);
  const bikeResult = await handlers['jobs:equip']('bike-job', 0, bikeContext.preferred[0], { profile: 'EditingProfile', bike: 'NewBike', changes: {} });
  assert.deepEqual(plain(bikeResult), { profile: 'EditingProfile', bike: 'NewBike', changes: { bikePaint: 'camo' } });
});

test('equipping a download merges into the current draft and leaves other profiles and saved gear alone', async () => {
  const source = await fs.readFile(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  const calls = [], rider = { profile: 'Editing', bike: 'PreviewBike', drafts: { 'Editing|PreviewBike': { helmetPaint: 'Draft Red', suitPaint: 'Old Kit' }, 'Other|Bike': { suitPaint: 'Keep' } }, lo: { current: { suitPaint: 'Old Kit' } } };
  const context = vm.createContext({ S: { rider, view: 'browse', gearThumbs: new Map() }, api: { invoke: async (...args) => { calls.push(args); return { profile: 'Editing', bike: 'PreviewBike', changes: { suitPaint: 'New Kit', rider: 'default_mx' } }; } }, toast() {} });
  vm.runInContext(source.slice(source.indexOf('function installedEquipTarget('), source.indexOf('async function offerEquip(')), context);
  const target = context.installedEquipTarget({ changes: {} });
  assert.deepEqual(plain(target), { profile: 'Editing', bike: 'PreviewBike', changes: { helmetPaint: 'Draft Red', suitPaint: 'Old Kit' } });
  await context.equipInstalledPreview({ id: 'job' }, 0, 'New Kit', target);
  assert.deepEqual(plain(rider.drafts['Editing|PreviewBike']), { helmetPaint: 'Draft Red', suitPaint: 'New Kit', rider: 'default_mx' });
  assert.deepEqual(rider.drafts['Other|Bike'], { suitPaint: 'Keep' });
  assert.equal(rider.lo, null); assert.equal(rider.saveState, 'Preview changes');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'jobs:equip');
  rider.drafts['Editing|NewBike'] = { tyres: 'AvailableTyres' };
  assert.deepEqual(plain(context.installedEquipTarget({ bike: 'NewBike' })), { profile: 'Editing', bike: 'NewBike', changes: { tyres: 'AvailableTyres' } });
});
