const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const installer = require('../src/lib/installer');
const recent = require('../src/lib/recent-installs');
const equip = require('../src/lib/equip-installed');
const site = require('../src/lib/site');
const pings = require('../src/lib/server-ping');
const { detectKind } = require('../src/lib/detect');

async function folder(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-workflows-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }

test('cancelling during copying restores overwritten files and removes the unfinished install and rollback scratch', async (t) => {
  const root = await folder(t), game = path.join(root, 'game'), rollback = path.join(root, 'rollback');
  await fs.mkdir(game); await fs.mkdir(rollback);
  await fs.writeFile(path.join(game, 'original.fx'), 'original'); await fs.writeFile(path.join(root, 'new.source'), 'new');
  const plan = { root: 'game', entries: [{ abs: path.join(root, 'new.source'), dest: 'original.fx' }, { abs: path.join(root, 'new.source'), dest: 'new.fx' }] };
  let checks = 0;
  await assert.rejects(installer.apply(plan, game, { rollbackDir: rollback, signal: { get aborted() { return ++checks >= 4; } } }), /Cancelled/);
  assert.equal(await fs.readFile(path.join(game, 'original.fx'), 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(game), ['original.fx']); assert.deepEqual(await fs.readdir(rollback), []);
});

test('an install copy failure restores originals rather than leaving a partial mod', async (t) => {
  const root = await folder(t), mods = path.join(root, 'mods'); await fs.mkdir(mods);
  await fs.writeFile(path.join(mods, 'old.pnt'), 'old'); await fs.writeFile(path.join(root, 'new.source'), 'new');
  await assert.rejects(installer.apply({ root: 'mods', entries: [{ abs: path.join(root, 'new.source'), dest: 'old.pnt' }, { abs: path.join(root, 'missing.source'), dest: 'partial.pnt' }] }, mods));
  assert.equal(await fs.readFile(path.join(mods, 'old.pnt'), 'utf8'), 'old'); assert.deepEqual(await fs.readdir(mods), ['old.pnt']);
});

test('recent installs prefill helmet and bike targets and move reviewed files without re-downloading or overwriting', async (t) => {
  const root = await folder(t), mods = path.join(root, 'mods');
  const before = 'rider/riders/default_mx/helmets/Wrong/paints/Blue.pnt', after = 'rider/riders/default_mx/helmets/Correct/paints/Blue.pnt';
  const source = path.join(mods, before); await fs.mkdir(path.dirname(source), { recursive: true }); await fs.writeFile(source, 'paint bytes');
  const opts = recent.previousOptions({ files: [before], kind: 'helmet' });
  assert.equal(opts.kind, 'helmetPaint'); assert.equal(opts.paintTarget, 'Wrong'); assert.equal(opts.riderTarget, 'default_mx');
  const plan = { entries: [{ abs: source, dest: after }] };
  const moved = await recent.relocatePlan(plan, mods); assert.equal(moved.get(before), after);
  assert.equal(await fs.readFile(path.join(mods, after), 'utf8'), 'paint bytes');
  await fs.mkdir(path.dirname(source), { recursive: true }); await fs.writeFile(source, 'another paint');
  await assert.rejects(recent.relocatePlan(plan, mods), /already exists/);
  assert.equal(await fs.readFile(source, 'utf8'), 'another paint');
  assert.equal(recent.previousOptions({ files: ['bikes/KX250/paints/Blue.pnt'] }).paintTarget, 'KX250');
});

test('history retains ten completed jobs and every active job without altering install records', () => {
  const jobs = new Map(Array.from({ length: 15 }, (_, i) => [String(i), { id: String(i), createdAt: i, status: 'done' }]));
  jobs.set('active', { id: 'active', status: 'downloading', createdAt: 0 });
  assert.equal(recent.pruneHistory(jobs).length, 5); assert.equal(jobs.size, 11); assert.ok(jobs.has('active')); assert.ok(jobs.has('14'));
});

test('sealed store rider hoodie packages route as rider models from their package name', async () => {
  const kind = await detectKind([{ rel: 'Rider-Hoodie-ABDesigns.pkz', abs: 'missing-but-sealed.pkz' }]);
  assert.deepEqual(kind, { kind: 'riderModel', reason: 'package-name' });
});

test('mixed gear archives route body, gloves and boot paints from their own paths', () => {
  const files = [
    { rel: 'Royal - Polar/Gear/Royal Black.pnt', abs: 'a', size: 1 },
    { rel: 'Royal - Polar/Gloves/Royal Black.pnt', abs: 'b', size: 1 },
    { rel: 'Royal - Polar/2018_alpinestars_sm_10/Royal Black.pnt', abs: 'c', size: 1 },
  ];
  const plan = installer.plan(files, { modsDir: 'C:/missing-mods', categories: [126], title: 'Royal Polar' });
  assert.equal(plan.kind, 'bootPaint');
  assert.equal(plan.kindLabel, 'Mixed rider gear paints');
  assert.equal(plan.paintModelsBase, null);
  assert.deepEqual(plan.entries.map((entry) => entry.dest), [
    'rider/riders/default_mx/paints/Royal Black.pnt',
    'rider/riders/default_mx/gloves/Royal Black.pnt',
    'rider/boots/2018_alpinestars_sm_10/paints/Royal Black.pnt',
  ]);
});

test('addon listings separate paints from models, tracks and bundles using the website categories', () => {
  assert.equal(site.isAddonPost({ categories: [127, 33] }), true);
  assert.equal(site.isAddonPost({ categories: [37] }), false);
  assert.equal(site.isAddonPost({ categories: [32] }), false);
  assert.equal(site.isAddonPost({ categories: [35, 309] }), false);
  assert.equal(site.isAddonPost({ categories: [35], needsModelNotice: true }), true);
  assert.equal(site.needsCustomModel('Only for the MXB shops hoodie model.'), true);
  assert.equal(site.needsCustomModel('Place these paints in rider/riders/default_mx/paints. No additional models are required.'), false);
  const hoodie = site.listingRequirements('<div id="instructions"><p>Mod Instructions</p><span>YOU MUST HAVE ABDESIGNS HOODIE FOR THIS MOD TO WORK<br></span></div>');
  assert.equal(hoodie.needsModelNotice, true); assert.ok(hoodie.dependencies.some((d) => d.url.endsWith('/rider-hoodie-abdesigns/')));
  for (const categories of [[22], [45], [313], [313, 127], [365]]) assert.equal(site.isAddonPost({ categories }), false);
});

test('equip choices group downloaded paints by item and reset dependent gear only when the model changes', () => {
  const choices = equip.choices(['rider/riders/default_mx/helmets/Helmet.pkz', 'rider/riders/default_mx/helmets/Helmet/paints/Blue.pnt', 'rider/riders/default_mx/helmets/Helmet/paints/Red.pnt', 'bikes/KX250/paints/Camo.pnt', 'game:ReShade.ini']);
  assert.equal(choices.length, 2); assert.deepEqual(choices[0].paints, ['Blue', 'Red']);
  const changes = equip.changesFor(choices[0], { rider: 'default_mx', helmet: 'Old', helmetPaint: 'Old paint', gogglesPaint: 'Old goggles' }, 'Blue');
  assert.equal(changes.helmet, 'Helmet'); assert.equal(changes.helmetPaint, 'Blue'); assert.equal(changes.gogglesPaint, '');
  assert.equal(choices[1].bike, 'KX250');
});

test('network ping probes have bounded concurrency and keep unavailable measurements unknown', async () => {
  let active = 0, max = 0;
  const result = await pings.measure(Array.from({ length: 8 }, (_, i) => ({ address: `203.0.113.${i + 1}:54210` })), async (ip) => { active++; max = Math.max(max, active); await new Promise((r) => setImmediate(r)); active--; return ip.endsWith('.1') ? null : 25; });
  assert.ok(max <= 4); assert.equal(result[0].ping, null); assert.equal(result[1].ping, 25);
});

test('None protection stays empty and paint-only protection folders are not offered as models', async (t) => {
  const root = await folder(t), base = path.join(root, 'rider/protections');
  await fs.mkdir(path.join(base, 'PaintOnly/paints'), { recursive: true });
  await fs.mkdir(path.join(base, 'Actual'), { recursive: true }); await fs.writeFile(path.join(base, 'Actual/gfx.cfg'), 'armour {}');
  const prof = { sections: { protection: { values: { bike: '' } } } };
  const lo = await require('../src/lib/profile').loadout(root, prof, 'bike');
  assert.ok(lo.options.protection.includes('')); assert.ok(lo.options.protection.includes('full')); assert.ok(lo.options.protection.includes('neck')); assert.ok(lo.options.protection.includes('Actual')); assert.ok(!lo.options.protection.includes('PaintOnly'));
  assert.equal(lo.current.protection, ''); assert.deepEqual(lo.options.protectionPaint, []);
});

test('protection inherits the game default until None clears it', async (t) => {
  const root = await folder(t);
  const profile = require('../src/lib/profile');
  const inherited = await profile.loadout(root, { sections: { info: { values: { protection: 'chest' } }, protection: { values: {} } } }, 'bike');
  assert.equal(inherited.current.protection, 'chest');
  const none = await profile.loadout(root, { sections: { info: { values: { protection: '' } }, protection: { values: { bike: '' } } } }, 'bike');
  assert.equal(none.current.protection, '');
});
