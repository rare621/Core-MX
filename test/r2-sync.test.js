const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { presign } = require('../server/r2');

test('presigned URLs match the AWS Signature V4 reference example', () => {
  const u = presign({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', expires: 86400, now: new Date('2013-05-24T00:00:00Z') });
  assert.equal(u.split('X-Amz-Signature=')[1], 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

// A tiny stand-in for R2: stores objects in memory and only accepts presigned requests.
function fakeR2() {
  const objects = new Map(), modified = new Map(), log = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    log.push(`${req.method} ${u.pathname}`);
    // Listing the bucket is signed in the Authorization header (ListObjectsV2), objects by presigned links.
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
      if (!/^AWS4-HMAC-SHA256 Credential=/.test(req.headers.authorization || '') || !req.headers['x-amz-date']) { res.writeHead(403); return res.end(); }
      const prefix = u.pathname + '/' + (u.searchParams.get('prefix') || '');
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k.slice(u.pathname.length + 1)}</Key><LastModified>${new Date(modified.get(k) || Date.now()).toISOString()}</LastModified><Size>${objects.get(k).length}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    if (!u.searchParams.get('X-Amz-Signature') || req.headers.authorization) { res.writeHead(403); return res.end(); }
    if (req.method === 'PUT') { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { objects.set(u.pathname, Buffer.concat(c)); modified.set(u.pathname, Date.now()); res.writeHead(200); res.end(); }); return; }
    if (req.method === 'GET') { const o = objects.get(u.pathname); if (!o) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-length': o.length }); return res.end(o); }
    if (req.method === 'DELETE') { objects.delete(u.pathname); res.writeHead(204); return res.end(); }
    res.writeHead(405); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, objects, modified, log, origin: `http://127.0.0.1:${server.address().port}` })));
}

// v30: the service stores no gear. At start it deletes every gear file it ever stored (R2 and its own
// folder), and file uploads and downloads are refused.
test('v30: the service deletes every stored gear file and refuses file uploads and downloads', async (t) => {
  const r2 = await fakeR2();
  t.after(() => r2.server.close());
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxbm-r2-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'r2.json'), JSON.stringify({ accountId: 'a'.repeat(32), accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'coremx-sync', testOrigin: r2.origin }));
  // Stored before v30: tracked and untracked R2 objects, a file on the service PC, and requests.
  const shaA = 'a'.repeat(64), shaB = 'b'.repeat(64), shaC = 'c'.repeat(64);
  r2.objects.set(`/coremx-sync/files/${shaA}`, Buffer.alloc(100, 1));
  r2.objects.set(`/coremx-sync/files/${shaB}`, Buffer.alloc(200, 2));
  r2.objects.set('/coremx-sync/other/keep.txt', Buffer.from('not a gear file'));
  await fs.mkdir(path.join(root, 'mxbm-files'));
  await fs.writeFile(path.join(root, 'mxbm-files', shaC), Buffer.alloc(300, 3));
  await fs.writeFile(path.join(root, 'service.json'), JSON.stringify({ users: {}, r2: { [shaA]: { size: 100, at: 1 } }, wants: { [shaA]: { x: Date.now() + 1e9 } } }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--openregister', 'yes', '--requireverified', 'no', '--oldapps', 'show', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (c) => { out += c; const m = c.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  child.stdout.on('data', (c) => { out += c; });
  const url = `http://127.0.0.1:${port}`;
  const call = (token) => async (method, route, body, raw) => {
    const res = await fetch(url + route, { method, headers: { 'content-type': raw ? 'application/octet-stream' : 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: raw || (body && JSON.stringify(body)) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const a = (await call()('POST', '/v1/register', { steamId: '76561198000000011', name: 'Rider' })).data;
  const c = call(a.token);

  // The purge runs 3 seconds after start.
  const until = Date.now() + 15000;
  while ([...r2.objects.keys()].some((k) => k.includes('/files/')) && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual([...r2.objects.keys()], ['/coremx-sync/other/keep.txt'], 'every gear file in R2 is deleted, tracked or not; nothing else');
  assert.deepEqual(await fs.readdir(path.join(root, 'mxbm-files')), [], 'and the file on the service PC');
  assert.match(out, /deleted 3 stored files/);

  const health = (await c('GET', '/v1/health')).data;
  assert.equal(health.version, 30);
  assert.ok(health.features.includes('links-only') && !health.features.includes('r2-files') && !health.features.includes('on-demand'));

  // A loadout never asks for files, and no file route works.
  const paint = Buffer.alloc(4096, 7); paint.write('PNT\0', 0, 'latin1'); paint.writeUInt32LE(3, 104);
  const sha = crypto.createHash('sha256').update(paint).digest('hex');
  const item = { slot: 'helmetPaint', label: 'Helmet paint', path: 'rider/helmets/X/paints/mine.pnt', sha256: sha, size: paint.length, value: 'mine' };
  assert.deepEqual((await c('POST', '/v1/loadout', { bike: 'B', items: [item], equipped: [], unavailable: [] })).data.missing, []);
  assert.deepEqual((await c('POST', '/v1/loadout', { bike: 'B', items: [item], equipped: [], unavailable: [], onDemand: true })).data.missing, []);
  assert.equal((await c('POST', `/v1/files/${sha}/upload`)).status, 410);
  assert.equal((await c('POST', `/v1/files/${sha}/uploaded`)).status, 410);
  assert.equal((await c('PUT', `/v1/files/${sha}`, null, paint)).status, 410);
  assert.equal((await c('GET', `/v1/files/${sha}`)).status, 410);
  assert.deepEqual((await c('POST', '/v1/want', { shas: [sha] })).data.states, { [sha]: 'gone' });
  assert.deepEqual(await fs.readdir(path.join(root, 'mxbm-files')), []);
  assert.ok(![...r2.objects.keys()].some((k) => k.includes('/files/')), 'nothing reached R2');
  // Its records of stored files and requests are cleared too (saved within a few seconds).
  let db = {};
  for (const end = Date.now() + 8000; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    db = JSON.parse(await fs.readFile(path.join(root, 'service.json'), 'utf8').catch(() => '{}'));
    if (!Object.keys(db.r2 || {}).length && !Object.keys(db.wants || {}).length) break;
  }
  assert.deepEqual(db.r2 || {}, {});
  assert.deepEqual(db.wants || {}, {});
});
