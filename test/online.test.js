const { test } = require('node:test');
const assert = require('node:assert/strict');
const online = require('../src/lib/online');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function fixture(overrides = {}) {
  let config = { url: 'http://192.168.0.38:60000', token: 'fixture-token', id: 'fixture-account', paintSync: false };
  let recentServers = [];
  const client = online.create({
    store: { get: (key) => key === 'online' ? config : key === 'friends' ? [] : key === 'recentServers' ? recentServers : undefined, set: (key, value) => { if (key === 'online') config = value; else if (key === 'recentServers') recentServers = value; } },
    appDir: __dirname, userDir: () => null, installDir: () => null,
    isGameRunning: async () => false, steamId: () => '76561198000000000', steamName: () => 'Fixture',
    defaultUrl: 'http://67.84.130.214:60000', previousServiceUrls: ['http://192.168.0.38:60000'],
    onChange: () => {},
    ...overrides,
  });
  return { client, config: () => config, recentServers: () => recentServers, set: (patch) => { config = { ...config, ...patch }; } };
}

test('presence heartbeat exposes the active manager count', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: true, activeUsers: 7 })));
  const { client } = fixture();
  await client.refresh();
  assert.equal(client.status().service.activeUsers, 7);
});

test('Friends refresh notices new shared gear before automatic download and rechecks local files on demand', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-friend-refresh-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const makeItem = (name, bytes) => ({ slot: 'suitPaint', label: name, value: name, rider: 'default_mx',
    path: `rider/riders/default_mx/paints/${name}.pnt`, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, needs: [] });
  const first = makeItem('First', Buffer.from('first paint'));
  const next = makeItem('Next', Buffer.from('next paint'));
  let items = [first], notices = 0, requests = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests++;
    assert.match(url, /\/v1\/loadouts\?pending=1$/);
    return new Response(JSON.stringify({ loadouts: [{ id: 'friend', name: 'Friend', bike: 'Fixture', items, equipped: [], unavailable: [] }] }));
  });
  const cfg = { url: 'https://example.test', token: 'fixture-token', received: {} };
  const { client } = fixture({
    store: { get: (key) => key === 'online' ? cfg : key === 'friends' ? [{ code: 'friend' }] : undefined },
    modsDir: () => root, haveMod: async () => true, onChange: () => { notices++; },
  });
  assert.equal((await client.refreshFriendGear())[0].items[0].state, 'ready');
  await client.refreshFriendGear();
  assert.equal(notices, 1, 'unchanged gear does not redraw the Friends cards');
  items = [first, next];
  assert.equal((await client.refreshFriendGear())[0].items.length, 2);
  assert.equal(client.status().paintSync.friends[0].items[1].state, 'ready');
  assert.equal(notices, 2);
  await fs.mkdir(path.join(root, 'rider/riders/default_mx/paints'), { recursive: true });
  await fs.writeFile(path.join(root, 'rider/riders/default_mx/paints/Next.pnt'), 'next paint');
  assert.equal((await client.refreshFriendGear(true))[0].items[1].state, 'have');
  assert.equal(notices, 3);
  assert.equal(requests, 4);
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

test('discovered addresses stay while riding and clear when the game closes', async (t) => {
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
  assert.deepEqual(f.recentServers().map((server) => [server.name, server.address]), [['Fixture server', address]]);
  assert.equal(reports.at(-1).session, 5, 'Warmup reaches the online service');
  assert.equal(f.config().addresses, undefined, 'discovery must not become a permanent stale mapping');
  address = null; await f.client.refresh();
  assert.equal(reports.at(-1).serverAddress, '203.0.113.21:54210');
  assert.equal(f.recentServers()[0].address, '203.0.113.21:54210', 'a temporary miss must not remove Join while riding');
  address = '203.0.113.22:54210'; await f.client.refresh();
  assert.equal(reports.at(-1).serverAddress, address);
  running = false; await f.client.refresh();
  assert.equal(reports.at(-1).serverAddress, null);
  assert.equal(reports.at(-1).session, null);
});

test('a live server keeps its last join address across one empty refresh', async (t) => {
  let address = '203.0.113.31:54210', live = true;
  t.mock.method(globalThis, 'fetch', async (url) => new Response(JSON.stringify({ servers: live ? [{
    id: 'fixture-row', name: 'Fixture server', trackId: 'fixture-track', address, riders: [], lastSeen: Date.now(),
  }] : [] })));
  const { client } = fixture();
  assert.equal((await client.servers()).servers[0].address, address);
  address = null;
  const kept = (await client.servers()).servers[0];
  assert.equal(kept.address, '203.0.113.31:54210');
  assert.equal(kept.addressRemembered, true);
  live = false;
  assert.equal((await client.servers()).servers.length, 0);
  live = true;
  assert.equal((await client.servers()).servers[0].address, null, 'a departed row must lose its cached address');
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
  t.mock.method(globalThis, 'fetch', async (url) => {
    // An in-flight presence report from another fixture can finish during this test.
    // Count only the Friends requests whose sharing behavior this assertion covers.
    if (!String(url).endsWith('/v1/friends')) return new Response('{}');
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

// Host World: while the player hosts, the game port is opened on the router, and closed after.
test('hosting opens the router port; leaving the game or turning it off closes it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-upnp-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'profiles', 'Rider'), { recursive: true });
  await fs.writeFile(path.join(root, 'global.ini'), '[profile]\nlastprofile=Rider\n');
  await fs.writeFile(path.join(root, 'profiles', 'Rider', 'profile.ini'), '[ui]\nhostsetup_name=My Track Day\n');
  const presence = (server) => fs.writeFile(path.join(root, 'mxbm_presence.json'), JSON.stringify({ inEvent: true, server }));
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const log = [];
  const portMapper = { open: async (port) => { log.push(`open ${port}`); }, close: async () => { log.push('close'); } };
  let running = true;
  const checks = [];
  const firewall = { check: async () => { checks.push(Date.now()); return { state: 'blocked', detail: 'No rule' }; }, allow: async () => {} };
  const f = fixture({ userDir: () => root, isGameRunning: async () => running, portMapper, firewall, resolveServerAddress: async () => null });

  await presence('Someone Else');
  await f.client.refresh();
  assert.deepEqual(log, [], 'joining another server opens nothing');

  await presence('My Track Day');
  await f.client.refresh();
  await f.client.refresh();
  assert.deepEqual(log, ['open 54210'], 'opened once while hosting (renewed later, not every poll)');
  assert.equal(f.client.status().upnp.state, 'open');
  assert.equal(f.client.status().upnp.firewall.state, 'blocked', 'the firewall is checked when hosting starts');
  assert.equal(checks.length, 1, 'not on every poll');

  running = false;
  await f.client.refresh();
  assert.deepEqual(log, ['open 54210', 'close']);
  assert.equal(f.client.status().upnp.state, 'off');

  running = true;
  await f.client.setUpnp(false);
  await f.client.refresh();
  assert.deepEqual(log, ['open 54210', 'close'], 'turned off: hosting opens nothing');
  assert.equal(f.client.status().upnp.enabled, false);
  await f.client.setUpnp(true);
  assert.deepEqual(log, ['open 54210', 'close', 'open 54210']);
  await f.client.stop();
  assert.deepEqual(log, ['open 54210', 'close', 'open 54210', 'close'], 'closing CoreMX removes it');
});

// A server that closed or dropped you: the game can sit on a "connection lost" screen, still in the
// event, but it receives nothing. After 30 seconds of silence CoreMX reports you as off the server.
test('a player whose game stopped receiving is reported off the server', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-lost-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'profiles', 'Rider'), { recursive: true });
  await fs.writeFile(path.join(root, 'global.ini'), '[profile]\nlastprofile=Rider\n');
  await fs.writeFile(path.join(root, 'profiles', 'Rider', 'profile.ini'), '[ui]\nhostsetup_name=My Track Day\n');
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { if (String(url).endsWith('/v1/presence')) sent.push(JSON.parse(options.body).state); return new Response('{}'); });
  const net = (rxAgo) => fs.writeFile(path.join(root, 'mxbm_stun.json'), JSON.stringify({ v: 1, at: Date.now(), rxAgo }));
  const on = (server) => fs.writeFile(path.join(root, 'mxbm_presence.json'), JSON.stringify({ inEvent: 1, server, rider: 'Rider' }));
  const f = fixture({ userDir: () => root, isGameRunning: async () => true, portMapper: { open: async () => {}, close: async () => {} }, firewall: { check: async () => ({ state: 'allowed' }) }, resolveServerAddress: async () => null });
  await on('Public server'); await net(200);
  await f.client.refresh();
  assert.equal(sent.at(-1).server, 'Public server', 'receiving: on the server');
  await net(45000);
  await f.client.refresh();
  assert.deepEqual([sent.at(-1).inEvent, sent.at(-1).server, sent.at(-1).connectionLost], [false, null, true], 'silent for 45 s: off it');
  // Hosting: an empty lobby is quiet, so silence doesn't count.
  await on('My Track Day');
  await f.client.refresh();
  assert.equal(sent.at(-1).server, 'My Track Day');
});

test('with a current service, CoreMX registers nothing until you sign in with Steam; the code from the browser finishes it', async (t) => {
  const calls = [];
  let polls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push(url);
    const body = options.body ? JSON.parse(options.body) : {};
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (url.endsWith('/v1/health')) return reply({ ok: true, version: 24 });
    if (url.endsWith('/v1/auth/steam/start')) { assert.equal(body.steamId, '76561198000000000'); return reply({ state: 'a'.repeat(32), secret: 's'.repeat(48), url: 'https://steamcommunity.com/openid/login?x=1' }); }
    if (url.endsWith('/v1/auth/steam/poll')) { polls++; return reply(body.code === 'c'.repeat(32) ? { done: true, token: 't'.repeat(48), id: '76561198000000000', name: 'Fixture' } : { done: false, confirmed: polls > 1 }); }
    return reply({ friends: [] });
  });
  const f = fixture();
  f.set({ token: null, id: null, url: 'http://67.84.130.214:60000' });
  const st = await f.client.connect();
  assert.equal(st.service.connected, false);
  assert.equal(st.service.needsSignIn, true);
  assert.ok(!calls.some((u) => u.endsWith('/v1/register')), 'nothing is registered without asking');
  let opened = null;
  const done = f.client.signIn(async (url) => { opened = url; });
  await new Promise((resolve) => setTimeout(resolve, 4500));
  assert.equal(opened, 'https://steamcommunity.com/openid/login?x=1');
  assert.equal(f.client.status().service.signingIn.confirmed, true);
  assert.equal(f.client.signInCode('b'.repeat(32), 'c'.repeat(32)), false, 'a link for another sign-in is ignored');
  assert.equal(f.client.signInCode('a'.repeat(32), 'c'.repeat(32)), true);
  const result = await done;
  assert.equal(result.service.connected, true);
  assert.equal(f.config().token, 't'.repeat(48));
  assert.equal(f.config().verified, true);
});

test('a token that stops working (account taken back) asks to sign in again', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'not signed in' }), { status: 401 }));
  const f = fixture();
  await f.client.refresh().catch(() => {});
  assert.equal(f.config().token, null);
  assert.equal(f.client.status().service.needsSignIn, true);
});

test('already online at start: CoreMX asks whether the account is Steam-verified, so it can offer Verify', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => new Response(JSON.stringify(String(url).endsWith('/v1/me') ? { id: 'fixture-account', name: 'Fixture', verified: false } : { friends: [] })));
  const f = fixture();
  f.set({ url: 'http://67.84.130.214:60000' });
  f.client.start();
  await new Promise((resolve) => setTimeout(resolve, 300));
  f.client.stop();
  assert.equal(f.client.status().service.verified, false);
});

test('when the service asks for a Steam-verified account, CoreMX stops asking for anything else until it is', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ error: 'Verify your account with Steam to use CoreMX online.', code: 'verify' }), { status: 403 }); });
  const f = fixture();
  await f.client.refresh().catch(() => {});
  assert.equal(f.config().verified, false);
  assert.equal(f.client.status().service.verified, false);
  const before = urls.length;
  await assert.rejects(f.client.syncFriends(), /Verify/);
  assert.equal(urls.length, before, 'nothing is sent');
});

test('gear a rider could not send is installed from its MXB Mods page once, and not again once you have it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-friend-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = { postId: 77, title: 'Bell Moto 10', link: 'https://mxb-mods.com/bell-moto-10/', download: 'https://example.test/helmet.zip' };
  const loadout = { id: 'rider', name: 'Rider', bike: 'Fixture', num: 2, items: [], equipped: [{ slot: 'helmet', value: 'Big' }],
    unavailable: [{ slot: 'helmet', label: 'Big', error: 'Too big or locked to send.', source }, { slot: 'boots', label: 'Paid', error: 'Paid mod — not installing.', source: { ...source, postId: 78 } }] };
  t.mock.method(globalThis, 'fetch', async (url) => new Response(JSON.stringify(/health$/.test(url) ? { ok: true, version: 26 } : /server-riders$/.test(url) ? { loadouts: [loadout] } : {})));
  const cfg = { url: 'https://example.test', token: 'fixture-token', received: {} };
  const asked = [];
  let installed = false;
  const { client } = fixture({
    store: { get: (key) => key === 'online' ? cfg : key === 'friends' ? [] : undefined, set: () => {} },
    modsDir: () => root, haveMod: async (n) => n.kind === 'helmet' ? installed : true,
    findGear: (req) => asked.push([req.source && req.source.postId, req.who, req.name, req.catalogKey]),
  });
  const first = await client.syncServerRiders('Server', ['rider']);
  assert.equal(first[0].unavailable[0].state, 'unavailable');
  assert.deepEqual(asked, [[77, 'Rider', 'Big', 'helmets/big']], 'the free helmet is fetched; the paid one never is');
  installed = true;
  const second = await client.syncServerRiders('Server', ['rider']);
  assert.equal(second[0].unavailable[0].state, 'have');
  assert.equal(asked.length, 1);
});

test('v30: an item of a rider with no exact MXB Mods download is nolink; nothing is searched for or fetched from the service', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-nolink-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'd'.repeat(64);
  const loadout = { id: 'rider', name: 'Rider', bike: 'Fixture', num: 2, equipped: [{ slot: 'suitPaint', value: 'Kit' }], unavailable: [],
    items: [{ slot: 'suitPaint', label: 'Kit', value: 'Kit', rider: 'default_mx', path: 'rider/riders/default_mx/paints/Kit.pnt', sha256: sha, size: 10, needs: [], available: false }] };
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => { urls.push(String(url)); return new Response(JSON.stringify(/health$/.test(url) ? { ok: true, version: 30 } : /server-riders$/.test(url) ? { loadouts: [loadout] } : /catalog\/lookup$/.test(url) ? { matches: {} } : {})); });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const asked = [];
  const { client } = fixture({
    store: { get: (key) => key === 'online' ? { url: 'https://example.test', token: 'fixture-token', received: {} } : key === 'friends' ? [] : undefined, set: () => {} },
    modsDir: () => root, haveMod: async () => true, findGear: (req) => asked.push(req.name),
  });
  assert.equal((await client.syncServerRiders('Server', ['rider']))[0].items[0].state, 'nolink');
  now += 11 * 60 * 1000;
  await client.syncServerRiders('Server', ['rider']);
  assert.deepEqual(asked, [], 'never a name search');
  assert.ok(!urls.some((u) => /\/v1\/(files|want|received)/.test(u)), 'nothing is asked of or fetched from the service');
});

test('uploads to R2 report bytes sent, have no overall time limit, and give up on a dead connection', async (t) => {
  const http = require('node:http');
  let got = null, headers = null;
  const server = http.createServer((req, res) => {
    if (req.url === '/dead') return; // reads nothing, never answers
    const parts = []; headers = req.headers;
    req.on('data', (c) => parts.push(c)); req.on('end', () => { got = Buffer.concat(parts); res.end('ok'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const buf = crypto.randomBytes(3 * 1024 * 1024 + 123), seen = [];
  const r = await online.putFile(`${base}/ok`, buf, (n) => seen.push(n));
  assert.equal(r.ok, true);
  assert.ok(got.equals(buf), 'the whole file arrives unchanged');
  assert.equal(headers['content-length'], String(buf.length), 'sized upload (cloud storage needs it)');
  assert.ok(seen.length > 5 && seen.at(-1) === buf.length && seen.every((n, i) => i === 0 || n >= seen[i - 1]), 'progress counts up to the size');
  await assert.rejects(online.putFile(`${base}/dead`, crypto.randomBytes(8 * 1024 * 1024), () => {}, 300), /no progress|stalled|socket|hang up|ECONNRESET/i);
});

test('v30: an item of a friend comes from the exact MXB Mods download their CoreMX installed it from', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-friend-exact-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = '9'.repeat(64);
  const source = { postId: 42, title: 'Camo kit', link: 'https://mxb-mods.com/camo/', download: 'https://example.test/camo.zip', exact: true };
  const loadout = { id: 'friend', name: 'Uhh_sal', bike: 'B', equipped: [{ slot: 'suitPaint', value: 'BLACK CAMO FXR' }], unavailable: [],
    items: [{ slot: 'suitPaint', label: 'Kit', value: 'BLACK CAMO FXR', rider: 'default_mx', path: 'rider/riders/default_mx/paints/BLACK CAMO FXR.pnt', sha256: sha, size: 10, needs: [], available: false, source }] };
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => { urls.push(String(url)); return new Response(JSON.stringify(/health$/.test(url) ? { ok: true, version: 30 } : /loadouts/.test(url) ? { loadouts: [loadout] } : {})); });
  const asked = [];
  const { client } = fixture({
    store: { get: (key) => key === 'online' ? { url: 'https://example.test', token: 't', received: {}, paintSync: true } : key === 'friends' ? [{ code: 'friend' }] : undefined, set: () => {} },
    modsDir: () => root, haveMod: async () => true, currentOutfit: async () => null,
    findGear: (req) => asked.push(req), gearStatus: () => ({ state: 'installing' }),
  });
  const st = await client.syncPaints();
  assert.equal(st.paintSync.friends[0].items[0].state, 'page');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].exact, true);
  assert.equal(asked[0].source.download, source.download, 'that very download');
  assert.ok(!urls.some((u) => /\/v1\/(files|want|received)/.test(u)), 'nothing comes through the service');
});

test('v30: between syncs a friend item keeps what the last sync found (no flipping back to ready)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-friend-keep-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = '7'.repeat(64);
  const loadout = { id: 'friend', name: 'Shawn', bike: 'B', equipped: [{ slot: 'glovesPaint', value: 'Evo' }], unavailable: [],
    items: [{ slot: 'glovesPaint', label: 'Gloves', value: 'Evo', rider: 'default_mx', path: 'rider/riders/default_mx/gloves/Evo.pnt', sha256: sha, size: 10, needs: [], available: false }] };
  t.mock.method(globalThis, 'fetch', async (url) => new Response(JSON.stringify(/health$/.test(url) ? { ok: true, version: 30 } : /loadouts/.test(url) ? { loadouts: [loadout] } : /catalog\/lookup$/.test(url) ? { matches: {} } : {})));
  const changes = [];
  const { client } = fixture({
    store: { get: (key) => key === 'online' ? { url: 'https://example.test', token: 't', received: {}, paintSync: true } : key === 'friends' ? [{ code: 'friend' }] : undefined, set: () => {} },
    modsDir: () => root, haveMod: async () => true, currentOutfit: async () => null, onChange: () => changes.push(1),
  });
  const st = await client.syncPaints();
  assert.equal(st.paintSync.friends[0].items[0].state, 'nolink');
  for (let i = 0; i < 3; i++) await client.refreshFriendGear(true);
  assert.equal(client.status().paintSync.friends[0].items[0].state, 'nolink', 'a refresh keeps it');
  assert.equal((await client.friendLoadout('friend')).items[0].state, 'nolink', 'opening their gear keeps it');
  await client.refreshFriendGear(true);   // once after opening their gear: your files are checked again
  const before = changes.length;
  for (let i = 0; i < 3; i++) await client.refreshFriendGear(true);
  assert.equal(changes.length, before, 'nothing changed: the page is not redrawn again and again');
});
