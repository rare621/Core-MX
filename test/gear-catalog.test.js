const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const keys = require('../src/lib/gear-keys');
const friendGear = require('../src/lib/friend-gear');

test('gear keys come from the files an install really wrote', () => {
  assert.deepEqual(keys.keysForFiles([
    'rider/helmets/Bellmoto10-FCR.pkz', 'rider/helmets/BellMoto10-EKS.pkz',
    'rider/helmets/Fox V3/helmet.edf', 'rider/helmets/Fox V3/paints/Team.pnt', 'rider/helmets/Fox V3/goggles/Clear.pnt',
    'rider/riders/default_mx/paints/Kit.pnt', 'rider/riders/default_mx/gloves/G.pnt', 'rider/paints/Old.pnt',
    'rider/boots/Tech10/paints/White.pnt', 'rider/protections/Neck/model.edf',
    'bikes/KX250/paints/Livery.pnt', 'bikes/KX250.pkz', 'tyres/Dunlop.pkz', 'game:plugins/x.dlo', 'tracks/Some Track/track.trk',
  ]), [
    'helmets/bellmoto10-fcr', 'helmets/bellmoto10-eks', 'helmets/fox v3', 'helmetpaints/fox v3/team', 'goggles/fox v3/clear',
    'suits/default_mx/kit', 'gloves/default_mx/g', 'suits/default_mx/old', 'bootpaints/tech10/white', 'protections/neck',
    'bikepaints/kx250/livery', 'bikes/kx250', 'tyres/dunlop',
  ]);
  assert.equal(keys.keyForItem('helmet', 'Bellmoto10-FCR'), 'helmets/bellmoto10-fcr');
  assert.equal(keys.keyForItem('helmetPaint', 'Team', { helmet: 'Fox V3' }), 'helmetpaints/fox v3/team');
  assert.equal(keys.keyForItem('suitPaint', 'Kit', {}), 'suits/default_mx/kit');
  assert.equal(keys.keyForItem('bikePaint', 'Livery', {}, 'KX250'), 'bikepaints/kx250/livery');
  assert.equal(keys.keyForItem('helmetPaint', 'Team', {}), null, 'a paint needs its model');
  assert.deepEqual(keys.keysForFile('rider/helmets/../x.pkz'), []);
});

test('the service keeps one shared catalog: reports, lookups and installs that turned out wrong', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-catalog-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--openregister', 'yes', '--requireverified', 'no', '--oldapps', 'show', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (chunk) => { const m = chunk.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const call = async (token, route, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const reg = async (id, name) => (await call(null, '/v1/register', { steamId: id, name })).data;
  const a = await reg('76561198000000001', 'A'), b = await reg('76561198000000002', 'B'), c = await reg('76561198000000003', 'C');
  assert.equal((await call(null, '/v1/health')).data.version, 27);
  const page = { postId: 91257, link: 'https://mxb-mods.com/bell-moto-10s-different-googles/', title: 'Bell Moto 10´S different Googles', download: 'https://www.mediafire.com/file/k/Bell+moto+10.rar/file' };
  assert.equal((await call(a.token, '/v1/catalog/report', { ...page, keys: ['helmets/bellmoto10-fcr', 'helmets/bellmoto10-eks', 'Helmets/UPPER', 'weird/x', 'helmets/../x'] })).data.keys, 2, 'bad keys are dropped');
  assert.equal((await call(a.token, '/v1/catalog/report', { ...page, link: 'https://evil.test/x', keys: ['helmets/x'] })).status, 400, 'only MXB Mods pages');
  assert.equal((await call(null, '/v1/catalog/report', { ...page, keys: ['helmets/x'] })).status, 401);
  let found = (await call(c.token, '/v1/catalog/lookup', { keys: ['helmets/bellmoto10-fcr', 'helmets/none'] })).data.matches;
  assert.deepEqual(Object.keys(found), ['helmets/bellmoto10-fcr']);
  assert.deepEqual(found['helmets/bellmoto10-fcr'][0], { ...page, votes: 1 });
  await call(a.token, '/v1/catalog/report', { ...page, keys: ['helmets/bellmoto10-fcr'] });
  found = (await call(c.token, '/v1/catalog/lookup', { keys: ['helmets/bellmoto10-fcr'] })).data.matches;
  assert.equal(found['helmets/bellmoto10-fcr'][0].votes, 1, 'the same rider reporting again counts once');
  // A wrong page someone reported: installs that didn't contain the item push it out.
  const wrong = { postId: 5, link: 'https://mxb-mods.com/other/', title: 'Other', download: 'https://a.test/o.zip' };
  await call(b.token, '/v1/catalog/report', { ...wrong, keys: ['helmets/bellmoto10-fcr'] });
  assert.equal((await call(c.token, '/v1/catalog/lookup', { keys: ['helmets/bellmoto10-fcr'] })).data.matches['helmets/bellmoto10-fcr'].length, 2);
  await call(c.token, '/v1/catalog/bad', { key: 'helmets/bellmoto10-fcr', postId: 5 });
  assert.deepEqual((await call(c.token, '/v1/catalog/lookup', { keys: ['helmets/bellmoto10-fcr'] })).data.matches['helmets/bellmoto10-fcr'].map((e) => e.postId), [91257]);
  // Kept after a restart.
  await new Promise((r) => setTimeout(r, 2600));   // the service writes its data at most 2 s after a change
  child.kill(); await new Promise((r) => child.once('exit', r));
  const saved = JSON.parse(await fs.readFile(path.join(root, 'service.json'), 'utf8'));
  assert.equal(saved.catalog['helmets/bellmoto10-fcr'].length, 2);
});

test('the shared catalog is tried after the owner\'s page and before a name search; a wrong install moves on', async () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const jobs = new Map(), started = [], bad = [], searched = [];
  const posts = {
    91257: { id: 91257, title: 'Bell Moto 10´S different Googles', link: 'https://mxb-mods.com/bell-moto-10s/', downloads: [{ label: 'mediafire', url: 'https://www.mediafire.com/file/k/Bell+moto+10.rar/file' }] },
    5: { id: 5, title: 'Other', link: 'https://mxb-mods.com/other/', downloads: [{ label: 'Get', url: 'https://a.test/o.zip' }] },
  };
  const fg = friendGear.create({
    site: { post: async (id) => posts[id], search: async ({ query }) => { searched.push(query); return { posts: [] }; } },
    startJob: (post, dl) => { const id = 'job' + (jobs.size + 1); jobs.set(id, { status: 'downloading' }); started.push(post.id); return id; },
    jobStatus: (id) => jobs.get(id) || null,
    isInstalled: () => false,
    lookup: async (k) => ({ [k[0]]: [{ postId: 5, link: 'https://mxb-mods.com/other/', download: 'https://a.test/o.zip' }, { postId: 91257, link: 'https://mxb-mods.com/bell-moto-10s/', download: 'https://evil.test/x.exe' }] }),
    reportBad: (key, postId) => bad.push([key, postId]),
  });
  fg.find({ slot: 'helmet', name: 'Bellmoto10-FCR', catalogKey: 'helmets/bellmoto10-fcr' });
  await tick();
  assert.deepEqual(started, [5]);
  assert.equal(fg.status('helmet', 'Bellmoto10-FCR').via, 'catalog');
  jobs.get('job1').status = 'done';
  fg.stillMissing('helmet', 'Bellmoto10-FCR');   // installed, but the helmet isn't there
  await tick();
  assert.deepEqual(bad, [['helmets/bellmoto10-fcr', 5]]);
  assert.deepEqual(started, [5, 91257], 'the next catalog page, with the link from the page itself');
  fg.stillMissing('helmet', 'Bellmoto10-FCR');
  assert.equal(bad.length, 1, 'once per install');
  assert.deepEqual(searched, [], 'no name search while the catalog has options');
});
