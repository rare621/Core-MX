const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { looksText } = require('../src/lib/online');

// Synced files are uploaded only when someone needs them. Apps from before (no onDemand / pending
// flags) keep working: they upload everything, and what they list counts as asked for.
async function service(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxbm-ondemand-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--openregister', 'yes', '--requireverified', 'no', '--oldapps', 'show', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (c) => { const m = c.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const url = `http://127.0.0.1:${port}`;
  const call = (token) => async (method, route, body, extra = {}) => {
    const res = await fetch(url + route, { method, headers: { 'content-type': 'application/json', ...extra, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    const data = await res.json(); assert.ok(res.ok, data.error); return data;
  };
  const reg = async (n, name) => { const r = await call()('POST', '/v1/register', { steamId: `765611980000003${n}0`, name }); return { ...r, c: call(r.token), put: (sha, buf) => fetch(`${url}/v1/files/${sha}`, { method: 'PUT', headers: { authorization: `Bearer ${r.token}` }, body: buf }) }; };
  return { reg };
}
const paint = (fill) => { const b = Buffer.alloc(512, fill); b.write('PNT\0', 0, 'latin1'); b.writeUInt32LE(1, 104); return b; };
const item = (buf, slot) => ({ slot, label: slot, value: slot, path: `rider/riders/default_mx/paints/${slot}.pnt`, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length });

test('files are uploaded once someone needs them; older apps keep working', async (t) => {
  const { reg } = await service(t);
  const owner = await reg(1, 'Owner'), rider = await reg(2, 'Rider'), oldRider = await reg(3, 'OldRider');
  for (const u of [owner, rider, oldRider]) await u.c('POST', '/v1/friends', { ids: [owner.id, rider.id, oldRider.id] });
  const a = paint(1), b = paint(2);
  const loadout = { bike: 'B', items: [item(a, 'suitPaint'), item(b, 'glovesPaint')], equipped: [], unavailable: [{ slot: 'tyres', label: 'Tyres: oem_mx', error: 'Comes with the bike', included: 'bike' }], onDemand: true };
  assert.deepEqual((await owner.c('POST', '/v1/loadout', loadout)).missing, [], 'nobody needs them yet: nothing to upload');
  assert.ok((await owner.c('GET', '/v1/health')).features.includes('on-demand'));

  // A new app sees every item with whether it is uploaded, and whether the owner is online.
  const seen = (await rider.c('GET', '/v1/loadouts?pending=1')).loadouts.find((l) => l.id === owner.id);
  assert.deepEqual(seen.items.map((it) => it.available), [false, false]);
  assert.equal(seen.online, false);
  assert.deepEqual(seen.unavailable[0].included, 'bike', 'files that come with the bike stay marked');
  // It asks for the one it needs: the owner is offline.
  assert.deepEqual((await rider.c('POST', '/v1/want', { shas: [item(a).sha256, 'f'.repeat(64)] })).states, { [item(a).sha256]: 'offline', ['f'.repeat(64)]: 'gone' });
  // The owner comes online: told to upload exactly that file, and the rider now sees "uploading".
  assert.deepEqual((await owner.c('POST', '/v1/presence', { state: { inGame: false } })).upload, [item(a).sha256]);
  assert.deepEqual((await rider.c('POST', '/v1/want', { shas: [item(a).sha256] })).states, { [item(a).sha256]: 'uploading' });
  assert.deepEqual((await owner.c('POST', '/v1/loadout', loadout)).missing, [item(a).sha256]);
  assert.ok((await owner.put(item(a).sha256, a)).ok);
  assert.deepEqual((await owner.c('POST', '/v1/presence', { state: { inGame: false } })).upload, [], 'nothing left to upload');
  assert.deepEqual((await rider.c('POST', '/v1/want', { shas: [item(a).sha256] })).states, { [item(a).sha256]: 'ready' });

  // An app from before on-demand lists only uploaded files, and the rest counts as asked for.
  const old = (await oldRider.c('GET', '/v1/loadouts')).loadouts.find((l) => l.id === owner.id);
  assert.deepEqual(old.items.map((it) => it.slot), ['suitPaint']);
  assert.deepEqual((await owner.c('POST', '/v1/presence', { state: { inGame: false } })).upload, [item(b).sha256]);
  // And an older owner app (no onDemand) is still asked for everything missing.
  const legacy = await reg(4, 'LegacyOwner');
  assert.equal((await legacy.c('POST', '/v1/loadout', { ...loadout, items: [item(paint(3), 'suitPaint')], onDemand: undefined })).missing.length, 1);
});

test('the overlay is told why a rider\'s item is not there yet', () => {
  const text = looksText([{ id: 'r1', num: 2, bikeId: 'MX2OEM_2023_Kawasaki_KX250', name: 'Rare621', equipped: [{ slot: 'helmet', value: '2018_astars_sm_10' }] }], [], 1, {
    r1: { items: [{ state: 'uploading', value: '2018_astars_sm_10' }, { state: 'offline', value: 'Black' }, { state: 'have', value: 'Kit' }],
      unavailable: [{ included: 'bike', state: 'unavailable', label: 'Tyres: oem_mx' }, { included: 'bike', state: 'have', label: 'Bike paint: Stock' }, { error: 'This file is tied to your account. Your friend needs their own copy.', state: 'unavailable', label: 'Helmet: Locked' }] },
  });
  assert.deepEqual(text.trim().split('\n').filter((l) => l.startsWith('wait')), [
    'wait\t2\tMX2OEM_2023_Kawasaki_KX250\tuploading\t2018_astars_sm_10',
    'wait\t2\tMX2OEM_2023_Kawasaki_KX250\toffline\tBlack',
    'wait\t2\tMX2OEM_2023_Kawasaki_KX250\tbike\toem_mx',
    'wait\t2\tMX2OEM_2023_Kawasaki_KX250\tpaid\tLocked',
  ]);
});

// Each CoreMX user on a server reports the riders their own game knows; a late joiner's game only knows
// those who came after it. The list shown stays the host's (or the longest-present reporter's).
test('a server rider list does not jump between reports', async (t) => {
  const { reg } = await service(t);
  const host = await reg(5, 'Host'), late = await reg(6, 'Late'), other = await reg(7, 'Other');
  const state = (riders, extra = {}) => ({ state: { inGame: true, inEvent: true, server: 'What!', trackId: 'Echo', riders: riders.map((name) => ({ name })), ...extra } });
  await host.c('POST', '/v1/presence', state(['Uhh_sal', 'bshoener', 'Rare621'], { hosting: true, hostPort: 54210 }));
  await late.c('POST', '/v1/presence', state(['Rare621']));
  const names = async () => (await other.c('GET', '/v1/servers')).servers.find((s) => s.name === 'What!').riders.map((r) => r.name);
  assert.deepEqual(await names(), ['Uhh_sal', 'bshoener', 'Rare621'], 'the host knows everyone');
  await host.c('POST', '/v1/presence', state(['Uhh_sal', 'Rare621'], { hosting: true, hostPort: 54210 }));
  await late.c('POST', '/v1/presence', state(['Rare621']));
  assert.deepEqual(await names(), ['Uhh_sal', 'Rare621'], 'someone left: the host\'s list follows');
  // Not hosted: the reporter on the server longest wins over a later one.
  const a = await reg(8, 'First'), b = await reg(9, 'Second');
  const join = (riders) => ({ state: { inGame: true, inEvent: true, server: 'Public', trackId: 'T', riders: riders.map((name) => ({ name })) } });
  await a.c('POST', '/v1/presence', join(['First', 'X', 'Y']));
  await b.c('POST', '/v1/presence', join(['Second']));
  assert.deepEqual((await other.c('GET', '/v1/servers')).servers.find((s) => s.name === 'Public').riders.map((r) => r.name), ['First', 'X', 'Y']);
});

// Nothing waits forever: a file asked for that its owner's CoreMX never sends becomes 'stalled' after
// 3 minutes (no more fast re-checks; the normal sync keeps asking), and an owner with CoreMX closed
// shows as 'offline' (not waited for).
test('uploads that never come stop being waited for', async () => {
  const { requestMissing } = require('../src/lib/paintsync');
  const sha = 'c'.repeat(64), other = 'd'.repeat(64);
  const report = () => [{ items: [{ sha256: sha, state: 'waiting' }, { sha256: other, state: 'waiting' }] }];
  const call = async () => ({ states: { [sha]: 'uploading', [other]: 'offline' } });
  const t0 = Date.parse('2026-11-20T10:00:00Z');
  const first = report(); await requestMissing(call, first, t0);
  assert.deepEqual(first[0].items.map((it) => it.state), ['uploading', 'offline']);
  const later = report(); await requestMissing(call, later, t0 + 2 * 60 * 1000);
  assert.equal(later[0].items[0].state, 'uploading', 'still within 3 minutes');
  const stalled = report(); await requestMissing(call, stalled, t0 + 4 * 60 * 1000);
  assert.equal(stalled[0].items[0].state, 'stalled');
});

test('an offline owner gets a fresh upload window when they return', async () => {
  const { requestMissing, pendingState } = require('../src/lib/paintsync');
  const sha = 'e'.repeat(64), t0 = Date.parse('2026-11-20T10:00:00Z');
  let online = false;
  const call = async () => ({ states: { [sha]: online ? 'uploading' : 'offline' } });
  const report = () => [{ items: [{ sha256: sha, state: 'waiting' }] }];
  await requestMissing(call, report(), t0);
  online = true;
  const returned = report();
  await requestMissing(call, returned, t0 + 20 * 60 * 1000);
  assert.equal(returned[0].items[0].state, 'uploading');
  assert.equal(pendingState(sha, false, t0 + 21 * 60 * 1000), 'offline');
  assert.equal(pendingState(sha, true, t0 + 21 * 60 * 1000), 'uploading');
  const stalled = report();
  await requestMissing(call, stalled, t0 + 25 * 60 * 1000);
  assert.equal(stalled[0].items[0].state, 'stalled');
});

// Riders matched only by name on a server's rider list (no plugin) are left out when their CoreMX shows
// them on another server, or is closed with files not uploaded (nobody could send them).
test('name-matched riders who left or cannot share are not offered', async (t) => {
  const { reg } = await service(t);
  const reporter = await reg(1, 'Reporter'), gone = await reg(2, 'GoneRider'), away = await reg(3, 'AwayRider'), viewer = await reg(4, 'Viewer');
  const kit = item(paint(9), 'suitPaint');
  for (const u of [gone, away]) await u.c('POST', '/v1/loadout', { bike: 'B', items: [kit], equipped: [], unavailable: [], onDemand: true });
  await away.c('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Elsewhere', trackId: 'T', riders: [] } });
  await reporter.c('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Busy', trackId: 'T', riders: [{ name: 'GoneRider' }, { name: 'AwayRider' }, { name: 'Reporter' }] } });
  const names = (await viewer.c('POST', '/v1/server-riders', { server: 'Busy', pending: true })).loadouts.map((l) => l.name);
  assert.ok(!names.includes('AwayRider'), 'their CoreMX shows them on another server');
  assert.ok(!names.includes('GoneRider'), 'CoreMX closed and nothing uploaded: could never be sent');
});

// A home-hosted game ends when its host leaves it, even while another player's game (stuck on a
// "connection lost" screen) still reports it.
test('a hosted game leaves the list when its host closes it', async (t) => {
  const { reg } = await service(t);
  const host = await reg(1, 'Host'), stuck = await reg(2, 'Stuck'), viewer = await reg(3, 'Viewer');
  const on = (extra = {}) => ({ state: { inGame: true, inEvent: true, server: 'What!', trackId: 'Echo', riders: [{ name: 'Host' }], ...extra } });
  await host.c('POST', '/v1/presence', on({ hosting: true, hostPort: 54210 }), { 'x-forwarded-for': '203.0.113.9' });
  await stuck.c('POST', '/v1/presence', on());
  const listed = async () => (await viewer.c('GET', '/v1/servers')).servers.some((s) => s.name === 'What!');
  assert.equal(await listed(), true);
  await host.c('POST', '/v1/presence', { state: { inGame: true, inEvent: false } });
  await stuck.c('POST', '/v1/presence', on());
  assert.equal(await listed(), false, 'host closed it: gone, whatever the stuck player reports');
});

// A home-hosted game closed and started again under the same name: a player stuck on the old game's
// "connection lost" screen (an older CoreMX keeps reporting it) doesn't mix into the new game.
test('a restarted hosted game is not mixed with players stuck on the old one', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxbm-restart-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--openregister', 'yes', '--requireverified', 'no', '--oldapps', 'show', '--data', path.join(root, 'service.json'), '--hostgraceseconds', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (c) => { const m = c.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const call = (token) => async (method, route, body, extra = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'content-type': 'application/json', ...extra, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return (await res.json());
  };
  const reg = async (n, name) => { const r = await call()('POST', '/v1/register', { steamId: `7656119800000006${n}`, name }); return call(r.token); };
  const host = await reg(1, 'Host'), stuck = await reg(2, 'Stuck'), viewer = await reg(3, 'Viewer');
  const game = (riders, extra = {}) => ({ state: { inGame: true, inEvent: true, server: 'What!', trackId: 'Echo', riders: riders.map((name) => ({ name })), ...extra } });
  const ip = { 'x-forwarded-for': '203.0.113.9' };
  await host('POST', '/v1/presence', game(['Host', 'Stuck'], { hosting: true, hostPort: 54210 }), ip);
  await stuck('POST', '/v1/presence', game(['Host', 'Stuck'], { serverAddress: '203.0.113.9:54210', serverAddressSource: 'game' }));
  // The host closes the game (stuck stays "in" it) and starts a new one with the same name.
  await host('POST', '/v1/presence', { state: { inGame: true, inEvent: false } }, ip);
  await new Promise((r) => setTimeout(r, 50));
  await host('POST', '/v1/presence', game(['Host', 'NewRider'], { hosting: true, hostPort: 54210 }), ip);
  await stuck('POST', '/v1/presence', game(['Host', 'Stuck'], { serverAddress: '198.51.100.1:61000', serverAddressSource: 'game' }));
  const what = (await viewer('GET', '/v1/servers')).servers.find((s) => s.name === 'What!');
  assert.deepEqual(what.riders.map((r) => r.name), ['Host', 'NewRider'], 'the new game\'s riders');
  assert.equal(what.address, '203.0.113.9:54210', 'not the stuck player\'s old address');
});

// Two servers with the same name (another host, another track) are separate rows, by the server's IP
// as the players' games connected to it; a report without an address stays on its row.
test('servers with the same name are listed separately', async (t) => {
  const { reg } = await service(t);
  const a = await reg(1, 'RiderA'), b = await reg(2, 'RiderB'), c = await reg(3, 'RiderC'), viewer = await reg(4, 'Viewer');
  const at = (address, track, riders, extra = {}) => ({ state: { inGame: true, inEvent: true, server: 'Practice', trackId: track, riders: riders.map((name) => ({ name })), ...(address ? { serverAddress: address, serverAddressSource: 'game' } : {}), ...extra } });
  await a.c('POST', '/v1/presence', at('198.51.100.10:54210', 'Echo', ['RiderA']));
  await b.c('POST', '/v1/presence', at('198.51.100.20:54210', 'Kato', ['RiderB']));
  let rows = (await viewer.c('GET', '/v1/servers')).servers.filter((s) => s.name === 'Practice');
  assert.equal(rows.length, 2, 'two servers named Practice');
  assert.deepEqual(rows.map((r) => r.trackId).sort(), ['Echo', 'Kato']);
  assert.notEqual(rows[0].id, rows[1].id);
  // C's game hasn't read the address: C joins the newest row (Kato) and stays there.
  await c.c('POST', '/v1/presence', at(null, 'Kato', ['RiderB', 'RiderC']));
  await a.c('POST', '/v1/presence', at('198.51.100.10:54210', 'Echo', ['RiderA']));
  await c.c('POST', '/v1/presence', at(null, 'Kato', ['RiderB', 'RiderC']));
  rows = (await viewer.c('GET', '/v1/servers')).servers.filter((s) => s.name === 'Practice');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.trackId === 'Kato').reporters, 2, 'C stayed on the Kato server');
  // Riders on a server: the row clicked (its id), not just its name.
  const echo = rows.find((r) => r.trackId === 'Echo'), kato = rows.find((r) => r.trackId === 'Kato');
  for (const u of [a, b, c]) await u.c('POST', '/v1/loadout', { bike: 'B', items: [], equipped: [], unavailable: [] });
  const on = async (row) => (await viewer.c('POST', '/v1/server-riders', { server: 'Practice', id: row.id, pending: true })).loadouts.map((l) => l.name).sort();
  assert.deepEqual(await on(echo), ['RiderA']);
  assert.deepEqual(await on(kato), ['RiderB', 'RiderC']);
  // A name-only row is taken over once someone's game knows the address (no duplicate).
  const d = await reg(5, 'RiderD'), e = await reg(6, 'RiderE');
  await d.c('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Solo', trackId: 'T', riders: [{ name: 'RiderD' }] } });
  await e.c('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Solo', trackId: 'T', riders: [{ name: 'RiderD' }, { name: 'RiderE' }], serverAddress: '198.51.100.30:54210', serverAddressSource: 'game' } });
  await d.c('POST', '/v1/presence', { state: { inGame: true, inEvent: true, server: 'Solo', trackId: 'T', riders: [{ name: 'RiderD' }] } });
  const solo = (await viewer.c('GET', '/v1/servers')).servers.filter((s) => s.name === 'Solo');
  assert.equal(solo.length, 1);
  assert.equal(solo[0].reporters, 2);
});

// Servers only reported by apps without the disconnect check (1.0.47 and earlier) stay off the Online
// list: a player stuck on a closed game would keep it there. One current app is enough to list it.
test('servers only older apps report are not listed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxbm-oldapps-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--openregister', 'yes', '--requireverified', 'no', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (c) => { const m = c.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const call = (token) => async (method, route, body) => (await (await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })).json());
  const reg = async (n, name) => { const r = await call()('POST', '/v1/register', { steamId: `7656119800000007${n}`, name }); return call(r.token); };
  const old = await reg(1, 'OldApp'), current = await reg(2, 'NewApp'), viewer = await reg(3, 'Viewer');
  const on = (extra = {}) => ({ state: { inGame: true, inEvent: true, server: 'Stuck Server', trackId: 'T', riders: [], ...extra } });
  await old('POST', '/v1/presence', on());
  const listed = async () => (await viewer('GET', '/v1/servers')).servers.some((s) => s.name === 'Stuck Server');
  assert.equal(await listed(), false, 'only an older app reports it');
  await current('POST', '/v1/presence', on({ connCheck: true }));
  assert.equal(await listed(), true, 'a current app is on it');
});
