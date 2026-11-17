const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('only the Steam admin with the server key can publish; announcements appear once and remain in the inbox', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-announcements-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (chunk) => { const match = chunk.toString().match(/on port (\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`service exited ${code}`)); });
  });
  const call = async (token, route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const register = async (steamId) => (await call(null, '/v1/register', { steamId, name: steamId })).data;
  const admin = await register('76561198098586128');
  const rider = await register('76561198000000001');
  const key = (await fs.readFile(path.join(root, 'admin.key'), 'utf8')).trim();
  assert.equal((await call(rider.token, '/v1/admin/status', { key })).status, 403);
  assert.equal((await call(admin.token, '/v1/admin/status', { key: 'wrong' })).status, 403);
  assert.equal((await call(admin.token, '/v1/admin/status', { key })).data.accounts, 2);
  const publish = await call(admin.token, '/v1/admin/announcements', { key, title: 'Maintenance', message: 'The server will restart tonight.' });
  assert.equal(publish.status, 200);
  const inbox = (await call(rider.token, '/v1/notifications')).data;
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.notifications[0].kind, 'announcement');
  assert.equal(inbox.notifications[0].seenPopup, false);
  const id = inbox.notifications[0].id;
  await call(rider.token, '/v1/notifications/seen', { ids: [id] });
  assert.equal((await call(rider.token, '/v1/notifications')).data.notifications[0].seenPopup, true);
  await call(rider.token, '/v1/notifications/read', { id });
  assert.equal((await call(rider.token, '/v1/notifications')).data.unread, 0);
  await call(rider.token, '/v1/notifications/delete', { id });
  assert.equal((await call(rider.token, '/v1/notifications')).data.notifications.length, 0);
  assert.equal((await call(admin.token, '/v1/notifications')).data.notifications.length, 1);
});
