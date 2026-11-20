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
  assert.ok(archive.entries.some((e) => e.fileName === 'Helmet/'));
  assert.ok(archive.entries.some((e) => e.fileName === 'Helmet/helmet.edf'));
  assert.ok(archive.entries.every((e) => e.fileName.startsWith('Helmet/')));
  assert.ok(archive.entries.every((e) => !/\.pnt$/i.test(e.fileName)));
  assert.ok(outfit.items.every((it) => !it.label.includes('Unused')));
});

test('an older flat CoreMX helmet package is replaced with a game-readable model folder', async (t) => {
  const f = await fixture(t);
  const outfit = await sync.outfitFiles(f.source, f.prof, 'Fixture');
  const helmet = outfit.items.find((it) => it.slot === 'helmet');
  const old = zip({ 'gfx.cfg': 'model = helmet.hrc', 'helmet.edf': model('helmet'),
    'helmet.hrc': 'level0\n{\nscene = helmet.edf\n}' });
  const rel = 'rider/helmets/Helmet.pkz';
  await f.write(f.receiver, rel, old);
  const received = { [rel]: { sha256: sha(old), from: 'friend', at: Date.now() } };
  const options = { call: async () => ({ loadouts: [{ id: 'friend', name: 'friend', items: [helmet] }] }),
    modsDir: f.receiver, received, have: () => true, download: async () => helmet.buf };
  const before = await sync.listFriends(options);
  assert.equal(before[0].items[0].state, 'ready');
  const result = await sync.fetchFriends(options);
  assert.equal(result[0].items[0].state, 'downloaded');
  assert.equal(sha(await fs.readFile(path.join(f.receiver, rel))), helmet.sha256);
  const archive = await openArchive(path.join(f.receiver, rel));
  assert.ok(archive.entries.some((e) => e.fileName === 'Helmet/helmet.edf'));
});

test('a free sealed helmet and its selected paint use normal friend sync even when the MXB Mods source is known', async (t) => {
  const f = await fixture(t);
  const freePackage = sealed(zip({
    'Helmet/gfx.cfg': 'model = helmet.hrc',
    'Helmet/helmet.edf': model('helmet'),
    'Helmet/helmet.hrc': 'level0\n{\nscene = helmet.edf\n}',
    'Helmet/paints/Active.pnt': f.helmetPaint,
    'Helmet/paints/Unused.pnt': paint('helmet', 240),
  }), true);
  await f.write(f.source, 'rider/helmets/Helmet.pkz', freePackage);
  const uploaded = [];
  const shared = await sync.share({
    call: async (_method, _route, payload) => ({ missing: uploaded.length ? [] : payload.items.map((it) => it.sha256) }),
    upload: async (hash, bytes) => uploaded.push({ hash, bytes }),
    modsDir: f.source, prof: f.prof, bike: 'Fixture',
    sourceFor: () => ({ postId: 123, link: 'https://mxb-mods.com/free-helmet/' }),
  });
  assert.deepEqual(shared.unavailable, []);
  assert.ok(shared.items.some((it) => it.slot === 'helmet'));
  assert.ok(shared.items.some((it) => it.slot === 'helmetPaint'));
  assert.equal(uploaded.length, shared.items.length);
  assert.deepEqual(uploaded.find((it) => it.hash === shared.items.find((x) => x.slot === 'helmetPaint').sha256).bytes, f.helmetPaint);
});

test('a protected helmet remains paid even if a free post claims its file', async (t) => {
  const f = await fixture(t);
  const shared = await sync.share({
    call: async () => ({ missing: [] }), upload: async () => {},
    modsDir: f.source, prof: f.prof, bike: 'Fixture',
    protectedPaths: ['rider/helmets/Helmet.pkz'],
    sourceFor: () => ({ postId: 123, link: 'https://mxb-mods.com/free-helmet/' }),
  });
  const helmet = shared.unavailable.find((it) => it.slot === 'helmet');
  assert.equal(helmet.error, 'Paid mod — not installing.');
  assert.equal(helmet.source, undefined);
});

test('store-protected equipped files are reported but never included in friend sync', async (t) => {
  const f = await fixture(t);
  const outfit = await sync.outfitFiles(f.source, f.prof, 'Fixture', ['rider/helmets/Helmet.pkz', 'bikes/Fixture/paints/Livery.pnt']);
  assert.ok(!outfit.items.some((it) => it.path === 'rider/helmets/Helmet.pkz' || it.path === 'bikes/Fixture/paints/Livery.pnt'));
  assert.deepEqual(outfit.unavailable.filter((it) => /Paid mod/.test(it.error)).map((it) => it.slot).sort(), ['bikePaint', 'helmet']);
});

test('account-bound models are identified before decoding, and installed recipient models enable their free paints', async (t) => {
  const f = await fixture(t);
  const bound = sealed(zip({ 'Helmet/helmet.edf': model('helmet') }), true, true);
  await f.write(f.source, 'rider/helmets/Helmet.pkz', bound);
  await f.write(f.source, 'rider/helmets/Helmet/paints/Active.pnt', f.helmetPaint);
  const outfit = await sync.outfitFiles(f.source, f.prof, 'Fixture');
  assert.equal(outfit.unavailable.find((it) => it.slot === 'helmet').error, 'This file is tied to your account. Your friend needs their own copy.');
  assert.ok(!outfit.items.some((it) => it.slot === 'helmet'));
  assert.ok(outfit.items.some((it) => it.slot === 'helmetPaint'));
  const shared = await sync.share({ call: async () => ({ missing: [] }), upload: async () => {},
    modsDir: f.source, prof: f.prof, bike: 'Fixture',
    sourceFor: () => ({ postId: 123, link: 'https://mxb-mods.com/free-helmet/' }) });
  assert.equal(shared.unavailable.find((it) => it.slot === 'helmet').source.postId, 123);
  const options = { call: async () => ({ loadouts: [{ id: 'friend', ...outfit }] }), modsDir: f.receiver,
    have: (n) => n.kind === 'helmet' ? gear.hasModel({ modsDir: f.receiver }, 'helmets', n.name) : true };
  let report = await sync.listFriends(options);
  assert.equal(report[0].unavailable[0].state, 'unavailable');
  assert.equal(report[0].items.find((it) => it.slot === 'helmetPaint').needs.length, 1);
  // A paints-only folder does not prove the base model is installed.
  await f.write(f.receiver, 'rider/helmets/Helmet/paints/Other.pnt', paint('helmet'));
  assert.equal(await gear.hasModel({ modsDir: f.receiver }, 'helmets', 'Helmet'), false);
  await f.write(f.receiver, 'rider/helmets/Helmet.pkz', bound);
  report = await sync.listFriends(options);
  assert.equal(report[0].unavailable[0].state, 'have');
  assert.deepEqual(report[0].items.find((it) => it.slot === 'helmetPaint').needs, []);
  await assert.rejects(modelBundle({ modsDir: f.receiver, kind: 'helmet', name: 'Helmet' }), { code: 'MXBM_ACCOUNT_BOUND' });
  const received = {};
  await sync.fetchFriends({ ...options, received, download: async (hash) => outfit.items.find((it) => it.sha256 === hash).buf });
  assert.deepEqual(await fs.readFile(path.join(f.receiver, 'rider/helmets/Helmet/paints/Active.pnt')), f.helmetPaint);
  assert.deepEqual(await fs.readFile(path.join(f.receiver, 'rider/helmets/Helmet.pkz')), bound);
  // A store record still gives the correct explanation if its package cannot be read.
  await f.write(f.source, 'rider/helmets/Helmet.pkz', Buffer.from('unreadable'));
  const stored = await sync.outfitFiles(f.source, f.prof, 'Fixture', ['rider/helmets/Helmet.pkz']);
  assert.equal(stored.unavailable.find((it) => it.slot === 'helmet').error, 'Paid mod — not installing.');
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
  await f.write(f.source, 'rider/helmets/Helmet.pkz', sealed(zip({
    'Helmet/gfx.cfg': 'model = helmet.hrc',
    'Helmet/helmet.edf': model('helmet'),
    'Helmet/helmet.hrc': 'level0\n{\nscene = helmet.edf\n}',
    'Helmet/paints/Active.pnt': f.helmetPaint,
  }), true));
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
  const health = await ac('GET', '/v1/health'); assert.equal(health.version, 19);
  const shared = await sync.share({ call: ac, upload: async (hash, bytes) => {
    const res = await fetch(url + '/v1/files/' + hash, { method: 'PUT', headers: { authorization: `Bearer ${a.token}` }, body: bytes });
    assert.ok(res.ok, (await res.json()).error);
  }, modsDir: f.source, prof: f.prof, bike: 'Fixture' });
  assert.equal(shared.items.length, 4);
  assert.equal((await bc('GET', '/v1/loadouts')).loadouts.length, 0);
  await bc('POST', '/v1/friends', { ids: [a.id] });
  const report = await sync.fetchFriends({ call: bc, download: async (hash) => Buffer.from(await (await fetch(url + '/v1/files/' + hash, { headers: { authorization: `Bearer ${b.token}` } })).arrayBuffer()), modsDir: f.receiver, received: {}, have: () => true });
  assert.equal(report[0].items.filter((it) => it.state === 'downloaded').length, 4);
  assert.ok(report[0].equipped.some((entry) => entry.slot === 'bootsPaint'), 'the server must retain the final outfit slots for the full 3D preview');
  await ac('POST', '/v1/presence', { state: { inGame: false } });
  const friend = (await bc('GET', '/v1/friends')).friends[0];
  assert.equal(friend.online, true); assert.equal(friend.inGame, false);
  await ac('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Fixture server', serverAddress: '203.0.113.7:54210', trackId: 'fixture', trackName: 'Fixture track', session: 5 } });
  const riding = (await bc('GET', '/v1/friends')).friends[0];
  assert.equal(riding.inEvent, true); assert.equal(riding.server, 'Fixture server'); assert.equal(riding.trackName, 'Fixture track');
  assert.equal(riding.session, 5);
  assert.equal(riding.address, '203.0.113.7:54210');
  assert.equal((await ac('GET', '/v1/servers')).servers[0].session, 5);
  await ac('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Fixture server', trackId: 'fixture', session: 7 } });
  assert.equal((await bc('GET', '/v1/friends')).friends[0].session, 7);
  assert.equal((await ac('GET', '/v1/servers')).servers[0].session, 7);
  assert.equal((await ac('GET', '/v1/servers')).servers[0].address, null, 'expired discovery does not retain an old server address');
  assert.equal((await ac('GET', '/v1/friends')).friends.find((f) => f.id === a.id).server, 'Fixture server');
  await ac('POST', '/v1/presence', { state: { inGame: false, inEvent: false } });
  assert.equal((await ac('GET', '/v1/servers')).servers.length, 0, 'leaving a server removes the stale live row immediately');
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
