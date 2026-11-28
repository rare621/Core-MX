const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const livery = require('../src/lib/bike-livery');
const installer = require('../src/lib/installer');

async function fixture(t, bikes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-bike-livery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'bikes'));
  for (const bike of bikes) await fs.writeFile(path.join(root, 'bikes', bike + '.pkz'), 'model');
  return root;
}
const bike = 'MX2OEM_2023_Kawasaki_KX250';
const old = 'MX2OEM_2021_Kawasaki_KX250';
const other = 'MX2OEM_2023_Yamaha_YZ250F';

test('bike identity normalizes spacing and preserves displacement, stroke/model suffix, year and OEM version', () => {
  assert.equal(livery.identify('2023 Kawasaki KX 250').model, 'KX250');
  assert.deepEqual(livery.identify(bike).years, [2023]);
  assert.equal(livery.compare(livery.requirement('paint.pnt', '2023 KX 250'), bike), 'match');
  for (const incompatible of [old, other, 'MX1OEM_2023_Kawasaki_KX450']) assert.equal(livery.compare(livery.requirement('paint.pnt', '2023 KX250'), incompatible), 'incompatible');
  // Kawasaki dropped the F (KX250F is the KX250 from 2021, KX450F the KX450 from 2019): may be the same
  // bike, so the player checks; never a sure match by name alone.
  assert.equal(livery.compare(livery.requirement('paint.pnt', '2023 KX250'), 'MX2OEM_2023_Kawasaki_KX250F'), 'unknown');
  const camo = livery.requirement('Solitude Visuals Camo KX250F.pnt', 'Solitude Visuals Camo KX250F');
  assert.equal(livery.compare(camo, bike), 'unknown', 'a KX250F livery can be for the 2023 KX250');
  assert.equal(livery.compare(camo, 'MX2OEM_2002_Kawasaki_KX250'), 'incompatible', 'a 2002 KX250 is the two-stroke');
  assert.equal(livery.compare(livery.requirement('p.pnt', '2019 KX250F camo'), bike), 'incompatible', 'other years still differ');
  assert.equal(livery.compare(livery.requirement('p.pnt', 'KX450F kit'), 'MX1OEM_2023_Kawasaki_KX450'), 'unknown');
  assert.equal(livery.compare(livery.requirement('p.pnt', 'YZ250F kit'), 'MX2OEM_2023_Yamaha_YZ250'), 'incompatible', 'Yamaha still sells both');
  assert.equal(livery.identify('2023 KTM 250 SX-F').model, livery.identify('2023 KTM SXF250').model);
  assert.equal(livery.identify('Suzuki RM-Z 250 2022').model, 'RMZ250');
  assert.deepEqual(livery.identify('Suzuki RM-Z 250 2022').years, [2022]);
  assert.equal(livery.compare(livery.requirement('Paint.pnt', '2023 KX250 OEM v0.18'), '2023 Kawasaki KX250 OEM v0.19'), 'incompatible');
  assert.equal(livery.compare(livery.requirement('Paint.pnt', '2023 KX250 OEM v0.18'), bike), 'unknown');
});

test('paint/event years do not replace an explicit bike year and ambiguous names stay manual', () => {
  const req = livery.requirement('2023 KX250/Camo.pnt', '2026 Military Day KX250 paint');
  assert.deepEqual(req.years, [2023]);
  assert.equal(livery.resolve(req, [bike, old]).target, bike);
  assert.deepEqual(livery.identify('2026 Military Day KX250 paint').years, []);
  assert.equal(livery.resolve(livery.requirement('Paint.pnt', 'KX250 paint'), [bike]).target, null);
  assert.equal(livery.resolve(livery.requirement('Paint.pnt', '2023 KX250 and YZ250F pack'), [bike]).target, null);
  const range = livery.requirement('Paint.pnt', '2021-2023 Kawasaki KX250');
  assert.deepEqual(range.years, [2021, 2022, 2023]);
  assert.equal(livery.compare(range, old), 'match');
  assert.equal(livery.compare(range, '2024 Kawasaki KX250'), 'incompatible');
});

test('livery install routes the exact named year and rejects a wrong year even when manually forced', async (t) => {
  const modsDir = await fixture(t, [old, bike, other]);
  const files = [{ rel: 'Blue.pnt', size: 1 }], ctx = { modsDir, categories: [37], title: '2023 Kawasaki KX 250 Blue' };
  const plan = installer.plan(files, ctx);
  assert.equal(plan.options.paintTarget, bike);
  assert.equal(plan.entries[0].dest, `bikes/${bike}/paints/Blue.pnt`);
  assert.equal(plan.bikeCompatibility.blocked, false);
  assert.equal(plan.bikeCompatibility.targets.find((b) => b.name === old).status, 'incompatible');
  const forced = installer.plan(files, ctx, { paintTarget: old });
  assert.equal(forced.entries[0].dest, null);
  assert.equal(forced.bikeCompatibility.blocked, true);
  assert.match(forced.bikeCompatibility.messages[0], /Incompatible bike/);
  await assert.rejects(installer.apply(forced, modsDir), /Incompatible bike/);
});

test('a missing older bike never falls back to an installed newer generation or creates a paint-only bike', async (t) => {
  const modsDir = await fixture(t, [bike]);
  const plan = installer.plan([{ rel: `mods/bikes/${old}/paints/Blue.pnt`, size: 1 }], { modsDir, categories: [37], title: 'Blue livery' });
  assert.equal(plan.entries[0].dest, null);
  assert.equal(plan.bikeCompatibility.blocked, true);
  assert.match(plan.bikeCompatibility.messages[0], /Bike mod not installed/);
  await assert.rejects(installer.apply(plan, modsDir), /older bike or mod version/);
});

test('multi-bike downloads resolve each file independently, including gear bundles and included bike models', async (t) => {
  const modsDir = await fixture(t, [bike, other]);
  const files = [{ rel: '2023 KX250/Blue.pnt', size: 1 }, { rel: '2023 YZ250F/Blue.pnt', size: 1 }];
  const plan = installer.plan(files, { modsDir, categories: [37], title: 'Team pack' });
  assert.deepEqual(plan.entries.map((e) => e.dest), [`bikes/${bike}/paints/Blue.pnt`, `bikes/${other}/paints/Blue.pnt`]);
  assert.equal(plan.bikeCompatibility.multiple, true);
  const mixed = installer.plan([{ rel: `bikes/${bike}/paints/Blue.pnt` }, { rel: 'Gear/Blue.pnt' }], { modsDir, categories: [35] });
  assert.equal(mixed.entries[0].dest, `bikes/${bike}/paints/Blue.pnt`);
  assert.equal(mixed.entries[1].dest, 'rider/riders/default_mx/paints/Blue.pnt');
  const bundled = installer.plan([{ rel: `bikes/${old}.pkz` }, { rel: `bikes/${old}/paints/Red.pnt` }], { modsDir, categories: [45] });
  assert.equal(bundled.bikeCompatibility.blocked, false);
  assert.equal(bundled.entries[1].dest, `bikes/${old}/paints/Red.pnt`);
});

test('unknown years require review without a generic paint dependency popup', async (t) => {
  const modsDir = await fixture(t, [bike]);
  const files = [{ rel: 'KX250 Blue.pnt' }], ctx = { modsDir, categories: [37] };
  const plan = installer.plan(files, ctx);
  assert.equal(plan.options.paintTarget, null); assert.equal(plan.confident, false);
  assert.equal(plan.requiresModelWarning, false);
  const reviewed = installer.plan(files, ctx, { paintTarget: bike });
  assert.equal(reviewed.entries[0].dest, `bikes/${bike}/paints/KX250 Blue.pnt`);
  assert.equal(reviewed.bikeCompatibility.blocked, false); assert.equal(reviewed.confident, false);
});
