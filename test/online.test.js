const { test } = require('node:test');
const assert = require('node:assert/strict');
const online = require('../src/lib/online');

function fixture() {
  let config = { url: 'http://192.168.0.38:60000', token: 'fixture-token', id: 'fixture-account', paintSync: false };
  const client = online.create({
    store: { get: (key) => key === 'online' ? config : key === 'friends' ? [] : undefined, set: (_key, value) => { config = value; } },
    appDir: __dirname, userDir: () => null, installDir: () => null,
    isGameRunning: async () => false, steamId: () => '76561198000000000', steamName: () => 'Fixture',
    defaultUrl: 'http://67.84.130.214:60000', previousServiceUrls: ['http://192.168.0.38:60000'],
    onChange: () => {},
  });
  return { client, config: () => config, set: (patch) => { config = { ...config, ...patch }; } };
}

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
