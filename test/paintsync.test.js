const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { zip, model } = require('./helpers/assets');
const { paint } = require('./helpers/paint');
const { sealed } = require('./helpers/sealed');
const sync = require('../src/lib/paintsync');
const gear = require('../src/lib/gear-assets');
const { openArchive } = require('../src/lib/assetread');
const { modelBundle, validateModel } = require('../src/lib/gear-sync');
const { mergeMove } = require('../src/lib/merge-move');
const { summary } = require('../src/lib/install-summary');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-sync-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'sender'), receiver = path.join(root, 'receiver');
  const write = async (base, rel, bytes) => { const f = path.join(base, rel); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, bytes); };
  await fs.mkdir(receiver);
  const helmetPaint = sealed(paint('helmet', 150));
  await write(source, 'rider/helmets/Helmet.pkz', zip({ 'Helmet/gfx.cfg': 'model = helmet.hrc', 'Helmet/helmet.edf': model('helmet'), 'Helmet/helmet.hrc': 'level0\n{\nscene = helmet.edf\n}', 'Helmet/paints/Active.pnt': helmetPaint, 'Helmet/paints/Unused.pnt': paint('helmet', 240) }));
  await write(source, 'rider/riders/default_mx/paints/Kit.pnt', paint('rider'));
  await write(source, 'rider/riders/default_mx/paints/Unused.pnt', paint('rider', 200));
  await write(source, 'bikes/Fixture/paints/Livery.pnt', paint('bike'));
  const sections = {};
  for (const [section, value] of Object.entries({ helmet: 'Helmet', helmet_paint: 'Active', suit_paint: 'Kit', paint: 'Livery' })) sections[section] = { values: { Fixture: value } };
  const prof = { sections };
  return { root, source, receiver, prof, write, helmetPaint };
}

test('equipped sync includes the helmet model and chosen paints, excludes unused variants, and keeps original sealed paint bytes', async (t) => {
  const f = await fixture(t);
  const outfit = await sync.outfitFiles(f.source, f.prof, 'Fixture');
  assert.deepEqual(outfit.unavailable, []);
  assert.deepEqual(outfit.items.map((it) => it.slot).sort(), ['bikePaint', 'helmet', 'helmetPaint', 'suitPaint']);
  assert.deepEqual(outfit.items.find((it) => it.slot === 'helmetPaint').buf, f.helmetPaint);
  const bundle = outfit.items.find((it) => it.slot === 'helmet');
  assert.ok(await validateModel(bundle.buf));
  const file = path.join(f.root, 'model.pkz'); await fs.writeFile(file, bundle.buf);
  const archive = await openArchive(file);
  assert.ok(archive.entries.every((e) => !/\.pnt$/i.test(e.fileName)));
  assert.ok(outfit.items.every((it) => !it.label.includes('Unused')));
});

test('store-protected equipped files are reported but never included in friend sync', async (t) => {
  const f = await fixture(t);
  const outfit = await sync.outfitFiles(f.source, f.prof, 'Fixture', ['rider/helmets/Helmet.pkz', 'bikes/Fixture/paints/Livery.pnt']);
  assert.ok(!outfit.items.some((it) => it.path === 'rider/helmets/Helmet.pkz' || it.path === 'bikes/Fixture/paints/Livery.pnt'));
  assert.deepEqual(outfit.unavailable.filter((it) => /store-protected/.test(it.error)).map((it) => it.slot).sort(), ['bikePaint', 'helmet']);
});

test('sync previews before download, skips identical loose and packaged files, and skips every download on a repeat sync', async (t) => {
  const f = await fixture(t);
  const outfit = await sync.outfitFiles(f.source, f.prof, 'Fixture');
  await f.write(f.receiver, 'rider/riders/default_mx/paints/Kit.pnt', paint('rider'));
  const lo = { id: 'friend', name: 'Fixture', bike: 'Fixture', items: outfit.items.map(({ buf, ...it }) => it), equipped: outfit.equipped };
  let downloads = 0;
  const received = {}, changes = [];
  const options = { call: async () => ({ loadouts: [lo] }), modsDir: f.receiver, received,
    have: async (n) => n.kind !== 'helmet' || (await gear.modelSources({ modsDir: f.receiver }, 'helmets', n.name)).length > 0,
    download: async (hash, progress) => { downloads++; const bytes = outfit.items.find((it) => it.sha256 === hash).buf; progress(bytes.length); return bytes; },
    onProgress: (p) => changes.push(p) };
  const preview = await sync.listFriends(options);
  assert.equal(downloads, 0);
  assert.equal(preview[0].items.find((it) => it.slot === 'suitPaint').state, 'have');
  const result = await sync.fetchFriends(options);
  assert.equal(downloads, 3);
  assert.ok(result[0].items.every((it) => ['have', 'downloaded'].includes(it.state)));
  assert.ok(changes.some((p) => p.loaded > 0));
  assert.ok(result[0].items.every((it) => !it.needs.length || it.slot === 'bikePaint'));
  await sync.fetchFriends(options);
  assert.equal(downloads, 3);
  // An original full package also counts as installed despite unused paints in it.
  await f.write(f.receiver, 'rider/helmets/Other.pkz', zip({ 'helmet.edf': model('other') }));
  const before = await modelBundle({ modsDir: f.source, kind: 'helmet', name: 'Helmet' });
  const after = await modelBundle({ modsDir: f.receiver, kind: 'helmet', name: 'Helmet' });
  assert.equal(sha(before), sha(after));
});

test('only the selected bike tyre dependency syncs, includes physics files, and skips an identical installed package', async (t) => {
  const f = await fixture(t);
  await f.write(f.source, 'bikes/Fixture/gfx.cfg', 'tyres = FixtureTyres');
  const packageBytes = zip({ 'gfx.cfg': 'front_wheel\n{\nmodel = front.hrc\n}', 'model.edf': model('wheel'), 'front.tyre': 'fixture physics', 'unused.pnt': paint('wheel') });
  await f.write(f.source, 'tyres/FixtureTyres.pkz', packageBytes);
  await f.write(f.source, 'tyres/Unused.pkz', packageBytes);
  const outfit = await sync.outfitFiles(f.source, f.prof, 'Fixture');
  const tyre = outfit.items.find((it) => it.modelKind === 'tyres');
  assert.equal(tyre.path, 'tyres/FixtureTyres.pkz');
  assert.equal(await validateModel(tyre.buf, 'tyres'), true);
  assert.ok(!outfit.items.some((it) => /Unused/.test(it.path)));
  await f.write(f.receiver, 'tyres/FixtureTyres.pkz', packageBytes);
  const report = await sync.listFriends({ call: async () => ({ loadouts: [{ id: 'friend', items: [tyre] }] }), modsDir: f.receiver });
  assert.equal(report[0].items[0].state, 'have');
});

test('different existing paints are kept, and corrupt or unsafe downloads cannot be installed', async (t) => {
  const f = await fixture(t);
  await f.write(f.receiver, 'rider/riders/default_mx/paints/Kit.pnt', paint('rider', 1));
  const outfit = await sync.outfitFiles(f.source, f.prof, 'Fixture');
  const item = outfit.items.find((it) => it.slot === 'suitPaint');
  const received = {};
  const options = { call: async () => ({ loadouts: [{ id: 'friend', items: [item] }] }), modsDir: f.receiver, received, have: () => true,
    download: async () => { throw new Error('Should not download a conflicting paint'); } };
  assert.equal((await sync.fetchFriends(options))[0].items[0].state, 'name-taken');
  assert.deepEqual(await fs.readFile(path.join(f.receiver, 'rider/riders/default_mx/paints/Kit.pnt')), paint('rider', 1));
  assert.equal(sync.safeRel('rider/../../outside.pnt'), false);
  assert.equal(sync.safeRel('bikes/Fixture/executable.pkz'), false);
  assert.equal(sync.safeRel('rider/helmets/Helmet.pkz'), true);
  assert.equal(sync.safeRel('rider/riders/default_mx/helmets/Helmet.pkz'), false);
  assert.equal(await validateModel(zip({ 'run.exe': 'unsafe', 'helmet.edf': model('helmet') })), false);
});

test('two real clients exchange only mutual-friend equipped files through the online service', async (t) => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--data', path.join(f.root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture service did not start')), 10000);
    child.once('error', reject);
    child.stdout.on('data', (chunk) => { const match = chunk.toString().match(/on port (\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  const url = `http://127.0.0.1:${port}`;
  const call = (token) => async (method, route, body) => {
    const res = await fetch(url + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    const data = await res.json(); assert.ok(res.ok, data.error); return data;
  };
  const a = await call()('POST', '/v1/register', { steamId: '76561198000000001', name: 'A' });
  const b = await call()('POST', '/v1/register', { steamId: '76561198000000002', name: 'B' });
  const ac = call(a.token), bc = call(b.token);
  await ac('POST', '/v1/friends', { ids: [a.id, b.id] });
  const health = await ac('GET', '/v1/health'); assert.equal(health.version, 4);
  const shared = await sync.share({ call: ac, upload: async (hash, bytes) => {
    const res = await fetch(url + '/v1/files/' + hash, { method: 'PUT', headers: { authorization: `Bearer ${a.token}` }, body: bytes });
    assert.ok(res.ok, (await res.json()).error);
  }, modsDir: f.source, prof: f.prof, bike: 'Fixture' });
  assert.equal(shared.items.length, 4);
  assert.equal((await bc('GET', '/v1/loadouts')).loadouts.length, 0);
  await bc('POST', '/v1/friends', { ids: [a.id] });
  const report = await sync.fetchFriends({ call: bc, download: async (hash) => Buffer.from(await (await fetch(url + '/v1/files/' + hash, { headers: { authorization: `Bearer ${b.token}` } })).arrayBuffer()), modsDir: f.receiver, received: {}, have: () => true });
  assert.equal(report[0].items.filter((it) => it.state === 'downloaded').length, 4);
  await ac('POST', '/v1/presence', { state: { inGame: false } });
  const friend = (await bc('GET', '/v1/friends')).friends[0];
  assert.equal(friend.online, true); assert.equal(friend.inGame, false);
  await ac('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Fixture server', trackId: 'fixture', trackName: 'Fixture track' } });
  const riding = (await bc('GET', '/v1/friends')).friends[0];
  assert.equal(riding.inEvent, true); assert.equal(riding.server, 'Fixture server'); assert.equal(riding.trackName, 'Fixture track');
  assert.equal((await ac('GET', '/v1/friends')).friends.find((f) => f.id === a.id).server, 'Fixture server');
  // One client cannot exhaust another rider's allowance behind the same NAT.
  let limited;
  for (let i = 0; i < 301; i++) {
    const res = await fetch(url + '/v1/health', { headers: { authorization: `Bearer ${a.token}` } });
    await res.json();
    if (res.status === 429) { limited = res; break; }
    assert.equal(res.status, 200);
  }
  assert.ok(limited, 'signed-in requests still have a bounded allowance');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await bc('GET', '/v1/friends')).friends[0].online, true);
  assert.equal((await call()('GET', '/v1/health')).ok, true);
});

test('merging old gear handles existing folders, recycles identical duplicates and preserves conflicts', async (t) => {
  const f = await fixture(t), old = path.join(f.root, 'old'), modern = path.join(f.root, 'modern');
  await f.write(old, 'same.pnt', 'same'); await f.write(modern, 'same.pnt', 'same');
  await f.write(old, 'different.pnt', 'old'); await f.write(modern, 'different.pnt', 'new');
  await f.write(old, 'unique.pnt', 'unique');
  const recycled = [];
  const result = await mergeMove(old, modern, async (file) => { recycled.push(path.basename(file)); await fs.rm(file); });
  assert.deepEqual(recycled, ['same.pnt']); assert.equal(result.conflicts.length, 1);
  assert.equal(await fs.readFile(path.join(modern, 'different.pnt'), 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(old), ['different.pnt']);
  assert.equal(summary(['rider/paints/Kit.pnt', 'rider/gloves/Glove.pnt', 'rider/helmets/Helmet/paints/Blue.pnt']), '1 rider kit paints, 1 gloves, 1 helmet paints');
});
