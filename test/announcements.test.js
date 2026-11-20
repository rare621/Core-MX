const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('only the Steam admin with the server key can publish; announcements appear once and remain in the inbox', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-announcements-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--oldapps', 'show', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

// Admin tab: who used CoreMX, one row per account, with daily active counts. Admin only.
test('the admin sees each account once with its activity', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-activity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--oldapps', 'show', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (chunk) => { const match = chunk.toString().match(/on port (\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  const call = async (token, route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const register = async (steamId, name) => (await call(null, '/v1/register', { steamId, name })).data;
  const admin = await register('76561198098586128', 'Rare621'), a = await register('76561198000000001', 'Uhh_sal'), b = await register('76561198000000002', 'Uhh_sal');
  for (let i = 0; i < 3; i++) await call(a.token, '/v1/notifications');
  await call(a.token, '/v1/presence', { name: 'Uhh_sal', state: { inGame: true, inEvent: true, server: 'joeeeee', trackName: 'Kato Cycle Club' } });
  const key = (await fs.readFile(path.join(root, 'admin.key'), 'utf8')).trim();
  assert.equal((await call(a.token, '/v1/admin/activity', { key })).status, 403, 'admin only');
  const { data } = await call(admin.token, '/v1/admin/activity', { key, days: 7 });
  assert.equal(data.users.length, 3, 'one row per account, however often they connect');
  assert.deepEqual(data.users.map((u) => u.id).sort(), ['76561198000000001', '76561198000000002', '76561198098586128']);
  const riding = data.users.find((u) => u.id === '76561198000000001');
  assert.deepEqual([riding.online, riding.inGame, riding.server, riding.track, riding.activeDays], [true, true, 'joeeeee', 'Kato Cycle Club', 1]);
  assert.equal(data.users[0].id, '76561198000000001', 'online riders first');
  assert.equal(data.daily.length, 7);
  assert.equal(data.daily.at(-1).count, 3, 'today: each account counted once');
  assert.deepEqual(data.summary, { accounts: 3, onlineNow: 1, inGame: 1, today: 3, last5Days: 3, last30Days: 3, newThisWeek: 3 });
});

// Admins: the owner adds and removes them by friend code; they unlock Admin with the same server key
// and can use it, but only the owner manages the list.
test('the owner adds admins by friend code; they use the server key; only the owner manages them', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-admins-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--oldapps', 'show', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (chunk) => { const match = chunk.toString().match(/on port (\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  const call = async (token, route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const register = async (steamId, name) => (await call(null, '/v1/register', { steamId, name })).data;
  const owner = await register('76561198098586128', 'Rare621'), friend = await register('76561198000000201', 'Uhh_sal'), other = await register('76561198000000202', 'Other');
  const key = (await fs.readFile(path.join(root, 'admin.key'), 'utf8')).trim();
  assert.deepEqual((await call(owner.token, '/v1/admin/role')).data, { admin: true, owner: true });
  assert.deepEqual((await call(friend.token, '/v1/admin/role')).data, { admin: false, owner: false });
  assert.equal((await call(friend.token, '/v1/admin/status', { key })).status, 403, 'not an admin yet');
  // The owner adds them (and someone not on CoreMX yet).
  assert.equal((await call(owner.token, '/v1/admin/admins/add', { key, id: 'nope' })).status, 400);
  await call(owner.token, '/v1/admin/admins/add', { key, id: '76561198000000201' });
  const added = (await call(owner.token, '/v1/admin/admins/add', { key, id: '76561198000000299' })).data.admins;
  assert.deepEqual(added.map((a) => [a.id, a.name, a.registered]), [['76561198000000201', 'Uhh_sal', true], ['76561198000000299', '', false]]);
  assert.deepEqual((await call(friend.token, '/v1/admin/role')).data, { admin: true, owner: false });
  assert.equal((await call(friend.token, '/v1/admin/status', { key })).status, 200, 'same server key');
  assert.equal((await call(friend.token, '/v1/admin/status', { key: 'wrong' })).status, 403);
  assert.equal((await call(friend.token, '/v1/admin/activity', { key })).status, 200);
  // Only the owner manages admins.
  assert.equal((await call(friend.token, '/v1/admin/admins/add', { key, id: '76561198000000202' })).status, 403);
  assert.equal((await call(friend.token, '/v1/admin/admins', { key })).status, 403);
  assert.equal((await call(other.token, '/v1/admin/role')).data.admin, false);
  // Removed: no more access.
  assert.deepEqual((await call(owner.token, '/v1/admin/admins/remove', { key, id: '76561198000000201' })).data.admins.map((a) => a.id), ['76561198000000299']);
  assert.equal((await call(friend.token, '/v1/admin/status', { key })).status, 403);
  assert.equal((await call(owner.token, '/v1/admin/admins/add', { key, id: '76561198098586128' })).status, 400, 'the owner is always an admin');
});
