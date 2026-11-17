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
  await plugin.c('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Test Server', trackId: 't', riderName: 'GameAlias', riders: [{ name: 'GameAlias' }, { name: 'CaptiveDuck | CRMX' }, { name: 'Shy' }] } });
  await shy.c('POST', '/v1/servershare', { share: false });
  const health = await me.c('GET', '/v1/health');
  assert.equal(health.version, 8);
  assert.equal(health.activeUsers, 1);
  const listed = await me.c('GET', '/v1/servers');
  assert.equal(listed.servers[0].riders[0].coremxName, 'PluginRider');
  const { loadouts } = await me.c('POST', '/v1/server-riders', { server: 'test server' });
  const byName = Object.fromEntries(loadouts.map((l) => [l.name, l.via]));
  assert.deepEqual(byName, { PluginRider: 'plugin', CaptiveDuck: 'name' });
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
});
