const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const steam = require('./helpers/steam');

async function service(t, args = [], fakeOptions) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-signin-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fake = await steam.fakeSteam(fakeOptions); t.after(() => fake.close());
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--steamopenid', fake.url, '--data', path.join(root, 'service.json'), ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (chunk) => { const m = chunk.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (token, route, body) => {
    const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  return { base, call, fake };
}

test('Sign in with Steam: Steam confirms the account, and the code only reaches the PC that signed in', async (t) => {
  const { base, call, fake } = await service(t);
  assert.equal((await call(null, '/v1/register', { steamId: '76561198000000001', name: 'x' })).status, 410, 'claiming an ID without Steam is closed');
  const r = await steam.signIn(base, '76561198000000001', { name: 'Rider' });
  assert.equal(r.before.done, false);
  assert.deepEqual(r.withoutCode, { done: false, confirmed: true }, 'confirmed by Steam, but no token without the code from the browser');
  assert.match(r.link, /^mxbm:\/\/signin\//);
  assert.equal(r.done, true);
  assert.equal(r.id, '76561198000000001');
  assert.deepEqual((await call(r.token, '/v1/me')).data, { id: '76561198000000001', name: 'Rider', verified: true });
  assert.equal(fake.checks.at(-1)['openid.mode'], 'check_authentication', 'the service asked Steam to confirm');
  // The sign-in is used up.
  assert.equal((await call(null, '/v1/auth/steam/poll', { state: r.start.state, secret: r.start.secret, code: r.link.split('/').pop() })).status, 404);
  // A wrong secret gets nothing.
  const other = (await call(null, '/v1/auth/steam/start', { steamId: '76561198000000002' })).data;
  assert.equal((await call(null, '/v1/auth/steam/poll', { state: other.state, secret: 'f'.repeat(48) })).status, 404);
});

test('a sign-in link someone sends you does not give them your account', async (t) => {
  const { base, call } = await service(t);
  // The attacker starts a sign-in and sends the Steam link to the victim, who signs in.
  const attacker = (await call(null, '/v1/auth/steam/start', { name: 'attacker' })).data;
  const page = await (await fetch(steam.steamAnswer(attacker.url, '76561198000000077'))).text();
  assert.match(page, /Signed in to CoreMX/);
  // The code went to the victim's own CoreMX (mxbm:// on the victim's PC); the attacker never has it.
  for (const guess of [undefined, '0'.repeat(32)]) {
    const p = (await call(null, '/v1/auth/steam/poll', { state: attacker.state, secret: attacker.secret, ...(guess ? { code: guess } : {}) })).data;
    assert.equal(p.done, false);
    assert.equal(p.token, undefined);
  }
});

test('the real owner takes back a Steam ID someone claimed with an old app; a confirmed account works on several PCs', async (t) => {
  const { base, call } = await service(t, ['--openregister', 'yes']);
  const squatter = (await call(null, '/v1/register', { steamId: '76561198000000005', name: 'fake' })).data;
  assert.equal((await call(squatter.token, '/v1/me')).data.verified, false);
  await call(squatter.token, '/v1/friends', { friends: ['76561198000000006'] });
  const owner = await steam.signIn(base, '76561198000000005', { name: 'Real' });
  assert.equal(owner.done, true);
  assert.equal((await call(squatter.token, '/v1/me')).status, 401, 'the claimed token stops working');
  assert.deepEqual((await call(owner.token, '/v1/me')).data, { id: '76561198000000005', name: 'Real', verified: true });
  assert.equal((await call(null, '/v1/register', { steamId: '76561198000000005', name: 'again' })).status, 409);
  // Second PC.
  const second = await steam.signIn(base, '76561198000000005', { name: 'Real' });
  assert.equal((await call(owner.token, '/v1/me')).status, 200);
  assert.equal((await call(second.token, '/v1/me')).status, 200);
});

test('a different Steam account than this PC, a cancelled or an unconfirmed sign-in give no account', async (t) => {
  const { base, call } = await service(t);
  const wrong = await steam.signIn(base, '76561198000000010', { as: '76561198000000011' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.page, /different Steam account/);
  assert.equal(wrong.link, null);
  assert.match(wrong.withoutCode.error || (await call(null, '/v1/auth/steam/poll', { state: wrong.start.state, secret: wrong.start.secret })).data.error || '', /different Steam account/);
  // Forged answer that doesn't match the sign-in started here.
  const start = (await call(null, '/v1/auth/steam/start', {})).data;
  const forged = new URL(steam.steamAnswer(start.url, '76561198000000012'));
  forged.searchParams.set('openid.return_to', 'http://evil.example/');
  assert.equal((await fetch(forged)).status, 400);
});

test('Steam saying the answer is not genuine stops the sign-in', async (t) => {
  const { base } = await service(t, [], { valid: false });
  const r = await steam.signIn(base, '76561198000000020');
  assert.equal(r.status, 502);
  assert.equal(r.link, null);
  assert.equal(r.done, undefined);
});

test('behind the website proxy, Steam sends people back to the public address, not 127.0.0.1', async (t) => {
  const { base, call } = await service(t);
  const viaProxy = await fetch(base + '/v1/auth/steam/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-coremx-public-origin': 'https://coremx.app' }, body: '{}' }).then((r) => r.json());
  assert.match(new URL(viaProxy.url).searchParams.get('openid.return_to'), /^https:\/\/coremx\.app\/v1\/auth\/steam\/return\?state=/);
  assert.equal(new URL(viaProxy.url).searchParams.get('openid.realm'), 'https://coremx.app');
  const bad = await fetch(base + '/v1/auth/steam/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-coremx-public-origin': 'javascript:alert(1)' }, body: '{}' }).then((r) => r.json());
  assert.match(new URL(bad.url).searchParams.get('openid.return_to'), /^http:\/\/127\.0\.0\.1:/, 'anything that is not an https origin is ignored');
  const direct = (await call(null, '/v1/auth/steam/start', {})).data;
  assert.match(new URL(direct.url).searchParams.get('openid.return_to'), /^http:\/\/127\.0\.0\.1:/);
});

test('--publicurl sets the return address', async (t) => {
  const { call } = await service(t, ['--publicurl', 'https://coremx.app']);
  const r = (await call(null, '/v1/auth/steam/start', {})).data;
  assert.match(new URL(r.url).searchParams.get('openid.return_to'), /^https:\/\/coremx\.app\/v1\/auth\/steam\/return\?state=/);
});

test('an account Steam has not verified can only verify, read announcements and leave until it does', async (t) => {
  const { base, call } = await service(t, ['--openregister', 'yes']);
  const old = (await call(null, '/v1/register', { steamId: '76561198000000030', name: 'Old' })).data;
  const blocked = await call(old.token, '/v1/presence', { state: { inGame: false } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'verify');
  assert.equal((await call(old.token, '/v1/friends')).status, 403);
  assert.equal((await call(old.token, '/v1/leaderboard')).status, 403);
  assert.equal((await fetch(base + '/v1/files/' + 'a'.repeat(64), { headers: { authorization: `Bearer ${old.token}` } })).status, 403, 'gear files too');
  assert.equal((await call(old.token, '/v1/notifications')).status, 200);
  assert.equal((await call(old.token, '/v1/me')).data.verified, false);
  const verified = await steam.signIn(base, '76561198000000030', { name: 'Old' });
  assert.equal((await call(verified.token, '/v1/presence', { state: { inGame: false } })).status, 200);
});

test('--requireverified no lets older accounts keep using everything', async (t) => {
  const { call } = await service(t, ['--openregister', 'yes', '--requireverified', 'no']);
  const old = (await call(null, '/v1/register', { steamId: '76561198000000031', name: 'Old' })).data;
  assert.equal((await call(old.token, '/v1/presence', { state: { inGame: false } })).status, 200);
});

test('apps the service hears from count as online, verified or not (v26)', async (t) => {
  const { call } = await service(t, ['--openregister', 'yes']);
  assert.equal((await call(null, '/v1/health')).data.activeUsers, 0);
  const old = (await call(null, '/v1/register', { steamId: '76561198000000040', name: 'Old app' })).data;
  assert.equal((await call(old.token, '/v1/presence', { state: { inGame: true } })).status, 403, 'its report is refused (not verified)');
  const health = (await call(null, '/v1/health')).data;
  assert.equal(health.version, 29);
  assert.equal(health.activeUsers, 1, 'but it is online');
});
