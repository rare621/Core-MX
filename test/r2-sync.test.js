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
  const objects = new Map(), log = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    log.push(`${req.method} ${u.pathname}`);
    if (!u.searchParams.get('X-Amz-Signature') || req.headers.authorization) { res.writeHead(403); return res.end(); }
    if (req.method === 'PUT') { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { objects.set(u.pathname, Buffer.concat(c)); res.writeHead(200); res.end(); }); return; }
    if (req.method === 'GET') { const o = objects.get(u.pathname); if (!o) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-length': o.length }); return res.end(o); }
    if (req.method === 'DELETE') { objects.delete(u.pathname); res.writeHead(204); return res.end(); }
    res.writeHead(405); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, objects, log, origin: `http://127.0.0.1:${server.address().port}` })));
}

test('with r2.json, paint files go to and come from R2, never through the service', async (t) => {
  const r2 = await fakeR2();
  t.after(() => r2.server.close());
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxbm-r2-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'r2.json'), JSON.stringify({ accountId: 'a'.repeat(32), accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'coremx-sync', testOrigin: r2.origin }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (c) => { const m = c.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const url = `http://127.0.0.1:${port}`;
  const call = (token) => async (method, route, body) => {
    const res = await fetch(url + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const reg = async (n, name) => { const r = (await call()('POST', '/v1/register', { steamId: `7656119800000001${n}`, name })).data; return { ...r, c: call(r.token), token: r.token }; };
  const a = await reg(1, 'Uploader'), b = await reg(2, 'Friend');

  // A plain MX Bikes paint: "PNT\0" header with a small count at byte 104.
  const paint = Buffer.alloc(4096, 7); paint.write('PNT\0', 0, 'latin1'); paint.writeUInt32LE(3, 104);
  const sha = crypto.createHash('sha256').update(paint).digest('hex');
  const item = { slot: 'helmetPaint', label: 'Helmet paint', path: 'rider/helmets/X/paints/mine.pnt', sha256: sha, size: paint.length, value: 'mine' };
  const lo = await a.c('POST', '/v1/loadout', { bike: 'B', items: [item], equipped: [], unavailable: [] });
  assert.deepEqual(lo.data.missing, [sha]);
  assert.ok((await a.c('GET', '/v1/health')).data.features.includes('r2-files'));

  // Someone else can't get an upload link for a file that isn't in their own loadout.
  assert.equal((await b.c('POST', `/v1/files/${sha}/upload`)).status, 400);

  // Upload: link from the service, bytes straight to R2, then the service checks what landed.
  const grant = (await a.c('POST', `/v1/files/${sha}/upload`)).data;
  assert.ok(grant.url.startsWith(r2.origin + '/coremx-sync/files/' + sha + '?'));
  assert.equal((await fetch(grant.url, { method: 'PUT', body: paint })).status, 200);
  assert.deepEqual((await a.c('POST', `/v1/files/${sha}/uploaded`)).data, { ok: true });
  assert.deepEqual((await a.c('POST', `/v1/files/${sha}/upload`)).data, { existed: true });
  assert.deepEqual((await a.c('POST', '/v1/loadout', { bike: 'B', items: [item], equipped: [], unavailable: [] })).data.missing, []);
  assert.deepEqual(await fs.readdir(path.join(root, 'mxbm-files')), [], 'nothing is stored on the service PC');

  // Download: the service answers with a short-lived R2 link; following it (as fetch does) drops the
  // sign-in header and gets the bytes from R2.
  const dl = await fetch(`${url}/v1/files/${sha}`, { headers: { authorization: `Bearer ${b.token}` }, redirect: 'manual' });
  assert.equal(dl.status, 302);
  assert.ok(dl.headers.get('location').startsWith(r2.origin));
  const followed = await fetch(`${url}/v1/files/${sha}`, { headers: { authorization: `Bearer ${b.token}` } });
  assert.equal(followed.status, 200);
  assert.ok(Buffer.from(await followed.arrayBuffer()).equals(paint));

  // A file that doesn't match its hash is rejected and deleted from R2.
  const bad = Buffer.alloc(4096, 1); bad.write('PNT\0', 0, 'latin1'); bad.writeUInt32LE(3, 104);
  const badSha = crypto.createHash('sha256').update(bad).digest('hex');
  await a.c('POST', '/v1/loadout', { bike: 'B', items: [item, { ...item, slot: 'bootsPaint', path: 'rider/boots/Y/paints/b.pnt', sha256: badSha, size: bad.length }], equipped: [], unavailable: [] });
  const g2 = (await a.c('POST', `/v1/files/${badSha}/upload`)).data;
  await fetch(g2.url, { method: 'PUT', body: Buffer.alloc(4096, 2) });
  assert.equal((await a.c('POST', `/v1/files/${badSha}/uploaded`)).status, 400);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(r2.objects.has(`/coremx-sync/files/${badSha}`), false);

  // Older apps that still upload to the service directly get their file moved up to R2 automatically.
  const old = Buffer.alloc(2048, 9); old.write('PNT\0', 0, 'latin1'); old.writeUInt32LE(1, 104);
  const oldSha = crypto.createHash('sha256').update(old).digest('hex');
  await b.c('POST', '/v1/loadout', { bike: 'B', items: [{ ...item, sha256: oldSha, size: old.length }], equipped: [], unavailable: [] });
  const put = await fetch(`${url}/v1/files/${oldSha}`, { method: 'PUT', headers: { authorization: `Bearer ${b.token}` }, body: old });
  assert.equal(put.status, 200);
  for (let i = 0; i < 80 && !r2.objects.has(`/coremx-sync/files/${oldSha}`); i++) await new Promise((r) => setTimeout(r, 250));
  assert.ok(r2.objects.get(`/coremx-sync/files/${oldSha}`).equals(old), 'moved to R2');
  for (let i = 0; i < 20 && (await fs.readdir(path.join(root, 'mxbm-files'))).length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await fs.readdir(path.join(root, 'mxbm-files')), [], 'and removed from the service PC');
});

// Storage upkeep: a file nobody wears is deleted after the grace (2 minutes; 1 s here), and so is the
// gear of a user who hasn't opened CoreMX for the inactive time (5 days; 4 s here). Their app uploads
// it again when they're back.
test('R2 keeps only files that riders using CoreMX wear', async (t) => {
  const r2 = await fakeR2();
  t.after(() => r2.server.close());
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxbm-r2-upkeep-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'r2.json'), JSON.stringify({ accountId: 'a'.repeat(32), accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'coremx-sync', testOrigin: r2.origin }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--data', path.join(root, 'service.json'), '--unusedseconds', '1', '--inactivedays', String(4 / 86400)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (c) => { const m = c.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const call = (token) => async (method, route, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const me = (await call()('POST', '/v1/register', { steamId: '76561198000000021', name: 'Rider' })).data, c = call(me.token);
  const paint = (fill) => { const b = Buffer.alloc(2048, fill); b.write('PNT\0', 0, 'latin1'); b.writeUInt32LE(2, 104); return b; };
  const upload = async (buf, slot) => {
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    return { sha, item: { slot, label: slot, path: `rider/helmets/X/paints/${slot}.pnt`, sha256: sha, size: buf.length, value: slot }, buf };
  };
  const a = await upload(paint(3), 'helmetPaint'), b = await upload(paint(4), 'gogglesPaint');
  await c('POST', '/v1/loadout', { bike: 'B', items: [a.item, b.item], equipped: [], unavailable: [] });
  for (const f of [a, b]) {
    const grant = (await c('POST', `/v1/files/${f.sha}/upload`)).data;
    await fetch(grant.url, { method: 'PUT', body: f.buf });
    assert.deepEqual((await c('POST', `/v1/files/${f.sha}/uploaded`)).data, { ok: true });
  }
  const has = (sha) => r2.objects.has(`/coremx-sync/files/${sha}`);
  const until = async (ok, ms) => { for (let i = 0; i < ms / 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 100)); return ok(); };
  // Changed gear: the paint no longer worn goes, the one still worn stays.
  await c('POST', '/v1/loadout', { bike: 'B', items: [a.item], equipped: [], unavailable: [] });
  assert.ok(await until(() => !has(b.sha), 9000), 'unworn file removed');
  assert.ok(has(a.sha), 'worn file kept');
  // Away (no requests at all): after the inactive time their worn file goes too.
  assert.ok(await until(() => !has(a.sha), 12000), 'away user\'s file removed');
  // Back: the service asks for it again.
  assert.deepEqual((await c('POST', '/v1/loadout', { bike: 'B', items: [a.item], equipped: [], unavailable: [] })).data.missing, [a.sha]);
});
