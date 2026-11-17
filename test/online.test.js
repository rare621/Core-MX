const { test } = require('node:test');
const assert = require('node:assert/strict');
const online = require('../src/lib/online');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function fixture(overrides = {}) {
  let config = { url: 'http://192.168.0.38:60000', token: 'fixture-token', id: 'fixture-account', paintSync: false };
  const client = online.create({
    store: { get: (key) => key === 'online' ? config : key === 'friends' ? [] : undefined, set: (_key, value) => { config = value; } },
    appDir: __dirname, userDir: () => null, installDir: () => null,
    isGameRunning: async () => false, steamId: () => '76561198000000000', steamName: () => 'Fixture',
    defaultUrl: 'http://67.84.130.214:60000', previousServiceUrls: ['http://192.168.0.38:60000'],
    onChange: () => {},
    ...overrides,
  });
  return { client, config: () => config, set: (patch) => { config = { ...config, ...patch }; } };
}

test('presence heartbeat exposes the active manager count', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: true, activeUsers: 7 })));
  const { client } = fixture();
  await client.refresh();
  assert.equal(client.status().service.activeUsers, 7);
});

test('moving to the public alias keeps the account without registering again', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ friends: [] }) };
  });
  const f = fixture();
  await f.client.connect();
  assert.equal(f.config().url, 'http://67.84.130.214:60000');
  assert.equal(f.config().token, 'fixture-token');
  assert.equal(f.config().id, 'fixture-account');
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => c.url.startsWith('http://67.84.130.214:60000/')));
  assert.ok(!calls.some((c) => c.url.endsWith('/v1/register')));
  assert.equal(calls[0].options.headers.authorization, 'Bearer fixture-token');
});

test('an app upgrade detects an old installed plugin and refreshes it only with the game closed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-plugin-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundled = path.join(root, 'app', 'plugin', online.PLUGIN), installed = path.join(root, 'game', 'plugins', online.PLUGIN);
  await fs.mkdir(path.dirname(bundled), { recursive: true }); await fs.mkdir(path.dirname(installed), { recursive: true });
  await fs.writeFile(bundled, 'updated plugin'); await fs.writeFile(installed, 'previous plugin');
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  let notify;
  const updated = new Promise((resolve) => { notify = resolve; });
  const f = fixture({ appDir: path.join(root, 'app'), installDir: () => path.join(root, 'game'), onChange: (st) => { if (!st.plugin.needsUpdate) notify(); } });
  assert.equal(f.client.status().plugin.needsUpdate, true);
  try { f.client.start(); await updated; }
  finally { f.client.stop(); }
  assert.equal(await fs.readFile(installed, 'utf8'), 'updated plugin');
  assert.equal(f.client.status().plugin.needsUpdate, false);
  await fs.writeFile(installed, 'previous plugin');
  const running = fixture({ appDir: path.join(root, 'app'), installDir: () => path.join(root, 'game'), isGameRunning: async () => true });
  await assert.rejects(running.client.installPlugin(), /Close MX Bikes first/);
  assert.equal(await fs.readFile(installed, 'utf8'), 'previous plugin');
});

test('plugin server events replace game-only presence immediately and closing the game clears them', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-session-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let running = true;
  const reports = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/v1/presence')) reports.push(JSON.parse(options.body).state);
    return new Response('{}');
  });
  const f = fixture({ userDir: () => root, isGameRunning: async () => running });
  const stateFile = path.join(root, online.STATE_FILE);
  await fs.writeFile(stateFile, JSON.stringify({ v: 2, inEvent: 0 }));
  await f.client.refresh();
  assert.equal(reports.at(-1).inGame, true); assert.equal(reports.at(-1).inEvent, false);
  await fs.writeFile(stateFile, JSON.stringify({ v: 2, inEvent: 1, type: 2, server: 'Fixture server', trackName: 'Fixture track' }));
  await f.client.refresh();
  assert.equal(reports.at(-1).server, 'Fixture server'); assert.equal(reports.at(-1).inEvent, true);
  running = false; await f.client.refresh();
  assert.equal(reports.at(-1).inGame, false); assert.equal(reports.at(-1).server, null);
});

test('discovered addresses are reported to friends and cleared when discovery expires or the game closes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-address-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let address = '203.0.113.21:54210', running = true;
  const reports = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/v1/presence')) reports.push(JSON.parse(options.body).state);
    return new Response('{}');
  });
  const f = fixture({ userDir: () => root, isGameRunning: async () => running,
    resolveServerAddress: async (name) => name === 'Fixture server' ? address : null });
  await fs.writeFile(path.join(root, online.STATE_FILE), JSON.stringify({ v: 2, inEvent: 1, server: 'Fixture server', session: 5 }));
  await f.client.refresh();
  assert.equal(reports.at(-1).serverAddress, address);
  assert.equal(reports.at(-1).session, 5, 'Warmup reaches the online service');
  assert.equal(f.config().addresses, undefined, 'discovery must not become a permanent stale mapping');
  address = null; await f.client.refresh();
  assert.equal(reports.at(-1).serverAddress, null);
  address = '203.0.113.22:54210'; await f.client.refresh();
  assert.equal(reports.at(-1).serverAddress, address);
  running = false; await f.client.refresh();
  assert.equal(reports.at(-1).serverAddress, null);
  assert.equal(reports.at(-1).session, null);
});

test('startup migrates only configured aliases and respects opting out', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({}) }));
  for (const [url, expectedToken] of [['http://192.168.0.38:60000', 'fixture-token'], ['http://different.example', null]]) {
    const f = fixture();
    f.set({ url, optedOut: true });
    try {
      f.client.start();
      assert.equal(f.config().url, 'http://67.84.130.214:60000');
      assert.equal(f.config().token, expectedToken);
      assert.equal(f.config().optedOut, true);
      await f.client.refresh();
    } finally { f.client.stop(); }
  }
});

test('a different service registers a new account without sending the previous token', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/v1/register') ? { token: 'new-fixture-token', id: 'new-account' } : { friends: [] } };
  });
  const f = fixture();
  f.set({ url: 'http://different.example' });
  await f.client.connect();
  assert.equal(calls[0].options.headers.authorization, undefined);
  const registration = calls.find((c) => c.url.endsWith('/v1/register'));
  assert.ok(registration);
  assert.equal(registration.options.headers.authorization, undefined);
  assert.equal(f.config().token, 'new-fixture-token');
  assert.equal(f.config().id, 'new-account');
});

test('the manager sends heartbeats while MX Bikes is closed, so active app users stay online', async (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const presence = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/v1/presence')) presence.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({}) };
  });
  const f = fixture();
  await f.client.refresh();
  now += 31000; await f.client.refresh();
  now += 31000; await f.client.refresh();
  assert.equal(presence.length, 3);
  assert.ok(presence.every((p) => p.state.inGame === false));
  assert.ok(presence.every((p) => p.state.inEvent === false));
});

test('rate limiting pauses all online calls until Retry-After expires, then recovers', async (t) => {
  let now = 100000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ error: 'slow down' }), { status: 429, headers: { 'retry-after': '45' } })
      : new Response(JSON.stringify({ servers: [], friends: [] }));
  });
  const f = fixture();
  await assert.rejects(f.client.servers(), /Retrying in 45 seconds/);
  for (let i = 0; i < 20; i++) await assert.rejects(f.client.syncFriends(), /Online service is busy/);
  assert.equal(calls, 1);
  now += 44000;
  await assert.rejects(f.client.servers(), /Retrying in 1 seconds/);
  now += 1000;
  assert.deepEqual((await f.client.servers()).servers, []);
  assert.equal(calls, 2);
});

test('legacy rate-limit errors without Retry-After wait a minute; simultaneous list requests share one fetch', async (t) => {
  let now = 100000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return calls === 1 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify({ friends: [] }));
  });
  const f = fixture();
  await Promise.all(Array.from({ length: 25 }, () => assert.rejects(f.client.syncFriends(), /Retrying in 60 seconds/)));
  assert.equal(calls, 1);
  now += 60000;
  await Promise.all(Array.from({ length: 25 }, () => f.client.syncFriends()));
  assert.equal(calls, 2);
});

// The bundled HTTPS endpoint is an alias of the same account database, never a fallback.
test('bundled HTTPS migration keeps existing credentials and never calls the public IP', async t => {
  const bundled = require('../online.config.json');
  assert.equal(bundled.serviceUrl, 'https://coremx.app');
  assert.ok(bundled.previousServiceUrls.includes('http://67.84.130.214:60000'));
  for (const legacyUrl of bundled.previousServiceUrls) {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return new Response('{}'); });
    const f = fixture({ defaultUrl: bundled.serviceUrl, previousServiceUrls: bundled.previousServiceUrls });
    f.set({ url: legacyUrl });
    await f.client.connect();
    assert.equal(f.config().url, bundled.serviceUrl);
    assert.equal(f.config().token, 'fixture-token');
    assert.equal(f.config().id, 'fixture-account');
    assert.ok(calls.length > 0);
    assert.ok(calls.every(c => c.url.startsWith('https://coremx.app/v1/')));
    assert.ok(!calls.some(c => c.url.endsWith('/v1/register')));
    assert.equal(calls[0].options.headers.authorization, 'Bearer fixture-token');
    t.mock.restoreAll();
  }
});
