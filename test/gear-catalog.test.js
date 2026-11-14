const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { model, zip } = require('./helpers/assets');
const { paint, multiPaint } = require('./helpers/paint');
const profile = require('../src/lib/profile');
const rider3d = require('../src/lib/rider3d');
const installer = require('../src/lib/installer');
const paints = require('../src/lib/rider-paints');
const { openArchive } = require('../src/lib/assetread');
const { dependenciesFromHtml, browseCategory, gearKind } = require('../src/lib/site');
const health = require('../src/lib/health');
const paintCompat = require('../src/lib/paint-compat');

test('modern paint-only folders cannot hide legacy helmets, and package paints stay listed after switching', async (t) => {
  const mods = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-catalog-'));
  t.after(() => fs.rm(mods, { recursive: true, force: true }));
  const root = path.join(mods, 'rider'), modern = path.join(root, 'riders', 'default_mx');
  await fs.mkdir(path.join(root, 'helmets'), { recursive: true });
  await fs.mkdir(path.join(modern, 'helmets', 'Other', 'paints'), { recursive: true });
  await fs.writeFile(path.join(modern, 'rider.edf'), model('body'));
  const helmet = path.join(root, 'helmets', '6D.pkz');
  await fs.writeFile(helmet, zip({ 'readme.pnt': paint(), '6D/gfx.cfg': 'model = helmet.hrc', '6D/helmet.hrc': 'level0\n{\nscene = helmet.edf\n}', '6D/helmet.edf': model('helmet'), '6D/paints/AeroBlue.pnt': paint(), '6D/goggles/Black.pnt': paint() }));
  const prof = { sections: { helmet: { values: { bike: '6D' } } } };
  const first = await profile.loadout(mods, prof, 'bike');
  assert.ok(first.options.helmet.includes('6D'));
  assert.ok(first.options.helmet.includes('Other'));
  assert.deepEqual(first.options.helmetPaint, ['AeroBlue']);
  assert.deepEqual(first.options.gogglesPaint, ['Black']);
  const rendered = await rider3d.build({ modsDir: mods, gd: modern, current: first.current, only: ['helmet'], texMax: 64 });
  assert.deepEqual(rendered.unreadable, []);
  prof.sections.helmet.values.bike = 'Other';
  const second = await profile.loadout(mods, prof, 'bike');
  assert.deepEqual(second.options.helmet, first.options.helmet);
});

test('new helmet bundled with paints is a valid target before it is installed', async (t) => {
  const mods = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-install-'));
  t.after(() => fs.rm(mods, { recursive: true, force: true }));
  await fs.mkdir(path.join(mods, 'rider', 'riders', 'default_mx'), { recursive: true });
  const files = ['NewHelmet.pkz', 'paints/Blue.pnt', 'goggles/Black.pnt'].map((rel) => ({ rel, size: 1 }));
  for (const kind of ['helmet', 'helmetPaint']) {
    const plan = installer.plan(files, { modsDir: mods, title: 'New helmet', categories: [] }, { kind });
    assert.ok(plan.paintModels.includes('NewHelmet'));
    assert.equal(plan.options.paintTarget, 'NewHelmet');
    assert.equal(plan.entries.find((e) => e.rel === 'paints/Blue.pnt').dest, 'rider/riders/default_mx/helmets/NewHelmet/paints/Blue.pnt');
    assert.equal(plan.entries.find((e) => e.rel === 'goggles/Black.pnt').dest, 'rider/riders/default_mx/helmets/NewHelmet/goggles/Black.pnt');
    assert.equal(plan.counts.unresolved || 0, 0);
  }
});

test('deleting a packaged helmet paint preserves the model and other paints and leaves no scratch files', async (t) => {
  const mods = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-paint-delete-'));
  t.after(() => fs.rm(mods, { recursive: true, force: true }));
  const dir = path.join(mods, 'rider', 'helmets');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'Helmet.pkz');
  const original = zip({ 'helmet.edf': model('helmet'), 'paints/Blue.pnt': paint(), 'paints/Red.pnt': paint('helmet', 200) });
  await fs.writeFile(file, original);
  let recycled;
  await paints.remove({ modsDir: mods, current: { helmet: 'Helmet' }, bike: 'bike', slot: 'helmetPaint', value: 'Blue', trash: async (target) => { recycled = await fs.readFile(target); await fs.rm(target); } });
  assert.deepEqual(recycled, original);
  const updated = await openArchive(file);
  assert.deepEqual(updated.entries.map((e) => e.fileName), ['helmet.edf', 'paints/Red.pnt']);
  assert.deepEqual(await updated.read(updated.entries[0]), model('helmet'));
  assert.deepEqual(await fs.readdir(dir), ['Helmet.pkz']);
});

test('paint-only model folders are not treated as installed dependencies', async (t) => {
  const mods = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-dependency-'));
  t.after(() => fs.rm(mods, { recursive: true, force: true }));
  await fs.mkdir(path.join(mods, 'rider', 'helmets', 'Missing', 'paints'), { recursive: true });
  const files = [{ rel: 'rider/helmets/Missing/paints/Blue.pnt', size: 1 }];
  const plan = installer.plan(files, { modsDir: mods, categories: [127] });
  assert.equal(plan.requiredModels[0].installed, false);
  assert.equal(plan.confident, false);
  assert.ok(plan.warnings.some((w) => w.includes('Missing model')));
  assert.ok(!installer.listModels(mods, 'rider/helmets').includes('Missing'));
  assert.deepEqual(dependenciesFromHtml('<p>These paints need the helmet model: <a href="https://mxbikes-shop.com/downloads/helmet/">6 Helmet</a></p><p>My template <a href="https://unrelated.example/">Template</a></p>'), [{ label: '6 Helmet', url: 'https://mxbikes-shop.com/downloads/helmet/' }]);
  const plainLink = dependenciesFromHtml('<p>This paint needs its hoodie model (https://mxbikes-shop.com/downloads/rider-hoodie-abdesigns/) to work.</p>');
  assert.equal(plainLink[0].url, 'https://mxbikes-shop.com/downloads/rider-hoodie-abdesigns/');
});

test('old archive gear paths are translated to the current rider layout even on a fresh install', async (t) => {
  const mods = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-modern-install-'));
  t.after(() => fs.rm(mods, { recursive: true, force: true }));
  const files = ['rider/paints/Kit.pnt', 'rider/gloves/Gloves.pnt', 'rider/helmets/Helmet/paints/Blue.pnt'].map((rel) => ({ rel, size: 1 }));
  const plan = installer.plan(files, { modsDir: mods, categories: [127, 35] });
  assert.ok(plan.entries.every((e) => e.dest.startsWith('rider/riders/default_mx/')));
  const local = installer.plan(files, { modsDir: mods, local: true, categories: [] });
  assert.ok(local.entries.every((e) => e.dest.startsWith('rider/riders/default_mx/')));
  await fs.mkdir(path.join(mods, 'rider', 'riders', 'default_mx'), { recursive: true });
  const issues = await health.scan({ modsDir: mods, items: [
    { id: 'active', group: 'rider', parts: ['rider/helmets/Helmet'], sub: 'legacy/helmets' },
    { id: 'disabled', group: 'rider', parts: ['rider/helmets/Other'], sub: 'helmets', disabled: true },
  ] });
  assert.equal(issues.find((i) => i.id === 'legacy-gear').fixId, 'trash-items');
  assert.equal(issues.find((i) => i.id === 'disabled-legacy-gear').fixId, 'trash-items');
  assert.ok(!issues.some((i) => i.fixId === 'disable-items'));
});

test('Get Mods separates helmet, boot and protection models from paint-only listings', () => {
  assert.deepEqual(browseCategory('helmets', 'models').cats, [313]);
  assert.deepEqual(browseCategory('helmets', 'paints').cats, [127]);
  assert.deepEqual(browseCategory('boots', 'models').cats, [343]);
  assert.deepEqual(browseCategory('protection', 'paints').cats, [135]);
  assert.equal(gearKind([33, 127]), 'paint');
  assert.equal(gearKind([33, 313]), 'model');
  assert.equal(gearKind([33, 313, 127]), 'bundle');
});

test('custom hoodie paints require a compatible rider instead of silently installing on the default rider', async (t) => {
  const mods = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-hoodie-'));
  t.after(() => fs.rm(mods, { recursive: true, force: true }));
  const file = path.join(mods, 'Essentials.pnt'), bytes = multiPaint(['rider', 'ABHOODIE']);
  await fs.writeFile(file, bytes);
  const files = [{ rel: 'Essentials.pnt', abs: file, size: bytes.length }];
  const inspected = await paintCompat.inspect(files, mods);
  assert.deepEqual(inspected.bodyPaintTextures, ['rider', 'abhoodie']);
  const context = { modsDir: mods, categories: [35], ...inspected };
  const missing = installer.plan(files, context);
  assert.equal(missing.needsRiderTarget, true);
  assert.equal(missing.installable, 0);
  assert.equal(missing.confident, false);
  assert.ok(inspected.dependencies[0].url.includes('rider-hoodie-abdesigns'));
  context.riderModels.push({ name: 'AB-HOODIE', textures: ['rider', 'abhoodie'] });
  const compatible = installer.plan(files, context);
  assert.equal(compatible.needsRiderTarget, false);
  assert.equal(compatible.entries[0].dest, 'rider/riders/AB-HOODIE/paints/Essentials.pnt');
  const dir = path.join(mods, 'rider', 'riders', 'default_mx', 'paints'); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'Essentials.pnt'), bytes);
  await assert.rejects(paintCompat.validateRiderPaint({ modsDir: mods, current: { rider: 'default_mx', suitPaint: 'Essentials' } }), /matching rider model/);
});

test('helmet paints with shared rider/eye textures never require a rider body or install as a rider kit', async (t) => {
  const mods = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-helmet-face-'));
  t.after(() => fs.rm(mods, { recursive: true, force: true }));
  const modelDir = path.join(mods, 'rider', 'riders', 'default_mx', 'helmets', 'BHelmet');
  await fs.mkdir(modelDir, { recursive: true }); await fs.writeFile(path.join(modelDir, 'helmet.edf'), model('helmet'));
  const file = path.join(mods, 'Bhelmet_Eyeballs.pnt'), bytes = multiPaint(['rider', 'eyes']);
  await fs.writeFile(file, bytes);
  const files = [{ rel: 'Bhelmet_Eyeballs.pnt', abs: file, size: bytes.length }];
  const inspected = await paintCompat.inspect(files, mods, null, 'helmetPaint');
  assert.deepEqual(inspected.bodyPaintFiles, []);
  assert.deepEqual(inspected.riderModels, []);
  const context = { modsDir: mods, categories: [127], ...inspected,
    // Stale classification must also be ignored when the user changes the type.
    knownBodyPaintFiles: [files[0].rel], bodyPaintTextures: ['rider', 'eyes'], riderModels: [{ name: 'default_mx', textures: ['rider'] }] };
  const plan = installer.plan(files, context, { kind: 'helmetPaint', paintTarget: 'BHelmet' });
  assert.equal(plan.needsRiderTarget, false);
  assert.deepEqual(plan.riderModels, []);
  assert.equal(plan.entries[0].dest, 'rider/riders/default_mx/helmets/BHelmet/paints/Bhelmet_Eyeballs.pnt');
  assert.equal(plan.counts.unresolved || 0, 0);
});

test('ordinary rider paints use the default body without asking the user to pick another rider', async (t) => {
  const mods = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-stock-kit-'));
  t.after(() => fs.rm(mods, { recursive: true, force: true }));
  const files = [{ rel: 'StockKit.pnt', size: 1 }];
  const plan = installer.plan(files, { modsDir: mods, categories: [35], paintTextures: { 'StockKit.pnt': ['rider', 'skin'] }, riderModels: [{ name: 'default_mx', textures: ['rider', 'skin'] }] });
  assert.equal(plan.needsRiderTarget, false);
  assert.deepEqual(plan.riderModels, []);
  assert.equal(plan.entries[0].dest, 'rider/riders/default_mx/paints/StockKit.pnt');
});
