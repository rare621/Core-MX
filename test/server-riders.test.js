const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('riders on the same server share gear by plugin report or Steam name match', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxbm-riders-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (c) => { const m = c.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const url = `http://127.0.0.1:${port}`;
  const call = (token) => async (method, route, body) => {
    const res = await fetch(url + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    const data = await res.json(); assert.ok(res.ok, data.error); return data;
  };
  const reg = async (n, name) => { const r = await call()('POST', '/v1/register', { steamId: `7656119800000000${n}`, name }); return { ...r, c: call(r.token) }; };
  const me = await reg(1, 'Me'), plugin = await reg(2, 'PluginRider'), named = await reg(3, 'CaptiveDuck'), shy = await reg(4, 'Shy'), stranger = await reg(5, 'Elsewhere');
  for (const u of [plugin, named, shy, stranger]) await u.c('POST', '/v1/loadout', { bike: 'Fixture', items: [], equipped: [], unavailable: [] });
  // PluginRider's plugin reports the server and its rider list (which includes CaptiveDuck with a team tag, and Shy).
  await plugin.c('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Test Server', trackId: 't', riderName: 'GameAlias', raceNumber: 526, bikeId: 'MX2OEM_2023_Kawasaki_KX250', riders: [{ name: 'GameAlias' }, { name: 'CaptiveDuck | CRMX' }, { name: 'Shy' }] } });
  await shy.c('POST', '/v1/servershare', { share: false });
  const health = await me.c('GET', '/v1/health');
  assert.equal(health.version, 14);
  assert.equal(health.activeUsers, 1);
  const listed = await me.c('GET', '/v1/servers');
  assert.equal(listed.servers[0].riders[0].coremxName, 'PluginRider');
  const { loadouts } = await me.c('POST', '/v1/server-riders', { server: 'test server' });
  const byName = Object.fromEntries(loadouts.map((l) => [l.name, l.via]));
  assert.deepEqual(byName, { PluginRider: 'plugin', CaptiveDuck: 'name' });
  // Live looks: a plugin rider comes with the race number and bike they ride in game; a rider
  // matched only by Steam name has neither (their game was not seen on this server).
  const pr = loadouts.find((l) => l.name === 'PluginRider'), cd = loadouts.find((l) => l.name === 'CaptiveDuck');
  assert.equal(pr.num, 526); assert.equal(pr.bikeId, 'MX2OEM_2023_Kawasaki_KX250');
  assert.equal(cd.num, undefined);
  // Your own gear is never offered back to you, and a server nobody is on returns nothing.
  assert.equal((await plugin.c('POST', '/v1/server-riders', { server: 'Test Server' })).loadouts.some((l) => l.name === 'PluginRider'), false);
  assert.equal((await me.c('POST', '/v1/server-riders', { server: 'Empty Server' })).loadouts.length, 0);
  await me.c('POST', '/v1/friends', { ids: [plugin.id] });
  await plugin.c('POST', '/v1/friends', { ids: [me.id] });
  await me.c('POST', '/v1/modshare', { to: plugin.id, postId: 'coremx:fixture_mod', title: 'Fixture mod' });
  const inbox = await plugin.c('GET', '/v1/notifications');
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.notifications[0].postId, 'coremx:fixture_mod');
  await plugin.c('POST', '/v1/notifications/read', { id: inbox.notifications[0].id });
  assert.equal((await plugin.c('GET', '/v1/notifications')).unread, 0);
  await plugin.c('POST', '/v1/notifications/delete', { id: inbox.notifications[0].id });
  assert.equal((await plugin.c('GET', '/v1/notifications')).notifications.length, 0);
});

test('a Host World session gets the host public IP and the game port as its address', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxbm-host-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (c) => { const m = c.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const url = `http://127.0.0.1:${port}`;
  const call = (token, extra = {}) => async (method, route, body) => {
    const res = await fetch(url + route, { method, headers: { 'content-type': 'application/json', ...extra, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    const data = await res.json(); assert.ok(res.ok, data.error); return data;
  };
  const host = await call()('POST', '/v1/register', { steamId: '76561198000000011', name: 'Host' });
  // The test connects through loopback, like the reverse proxy in front of the service.
  const viaProxy = call(host.token, { 'x-forwarded-for': '203.0.113.9' });
  await viaProxy('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'joeeeee', trackId: 'ZD - Echo Valley MX', hosting: true, hostPort: 54210 } });
  const hosted = (await call(host.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'joeeeee');
  assert.equal(hosted.address, '203.0.113.9:54210');
  assert.equal(hosted.addressObserved, false);
  const rider = await call()('POST', '/v1/register', { steamId: '76561198000000013', name: 'JoinedRider' });
  const riderCall = call(rider.token);
  const riderState = { inGame: true, inEvent: true, server: 'joeeeee', trackId: 'ZD - Echo Valley MX', serverAddress: '198.51.100.22:61234' };
  // A name-based browser lookup cannot replace the host address.
  await riderCall('POST', '/v1/presence', { state: { ...riderState, serverAddressSource: 'browser' } });
  assert.equal((await call(host.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'joeeeee').address, '203.0.113.9:54210');
  // An endpoint read from a rider's connected game wins and survives host heartbeats.
  await riderCall('POST', '/v1/presence', { state: { ...riderState, serverAddressSource: 'game' } });
  const observed = (await call(host.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'joeeeee');
  assert.equal(observed.address, '198.51.100.22:61234');
  assert.equal(observed.addressObserved, true);
  await viaProxy('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'joeeeee', trackId: 'ZD - Echo Valley MX', hosting: true, hostPort: 54210 } });
  assert.equal((await call(host.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'joeeeee').address, '198.51.100.22:61234');
  // Not hosting: no address is invented.
  await viaProxy('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Someone else', trackId: 't' } });
  const joined = (await call(host.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'Someone else');
  assert.equal(joined.address, null);
  // Reusing the old session name must start with the host's own unverified address again.
  await viaProxy('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'joeeeee', trackId: 'ZD - Echo Valley MX', hosting: true, hostPort: 54210 } });
  const restarted = (await call(host.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'joeeeee');
  assert.equal(restarted.address, '203.0.113.9:54210');
  assert.equal(restarted.addressObserved, false);
  // A host whose app reaches the service over IPv6: presence carries no IPv4, so the IPv4 seen on
  // /v1/hostip (requested over IPv4) is used.
  const v6 = await call()('POST', '/v1/register', { steamId: '76561198000000012', name: 'V6Host' });
  await call(v6.token, { 'x-forwarded-for': '198.51.100.7' })('POST', '/v1/hostip', {});
  await call(v6.token, { 'x-forwarded-for': '2001:db8::7' })('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'What!', trackId: 'Havoc Raceway', hosting: true, hostPort: 54210 } });
  assert.equal((await call(v6.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'What!').address, '198.51.100.7:54210');
  // The STUN address from the game socket (router maps 54210 to 61890) is used when its IP matches
  // the IP the service sees for this player; any other IP is ignored.
  const hostingState = { inGame: true, inEvent: true, server: 'What!', trackId: 'Havoc Raceway', hosting: true, hostPort: 54210 };
  await call(v6.token, { 'x-forwarded-for': '2001:db8::7' })('POST', '/v1/presence', { state: { ...hostingState, hostAddress: '203.0.113.50:61890' } });
  assert.equal((await call(v6.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'What!').address, '198.51.100.7:54210');
  await call(v6.token, { 'x-forwarded-for': '2001:db8::7' })('POST', '/v1/presence', { state: { ...hostingState, hostAddress: '198.51.100.7:61890' } });
  assert.equal((await call(v6.token)('GET', '/v1/servers')).servers.find((s) => s.name === 'What!').address, '198.51.100.7:61890');
});
