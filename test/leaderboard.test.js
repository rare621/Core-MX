const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseRecords, readBestLaps } = require('../src/lib/laps');

test('best laps are read from MX Bikes\' records.ini of the current profile', async (t) => {
  // Exactly as the game writes it (profiles/<name>/records.ini).
  assert.deepEqual(parseRecords('[ZD - Kato Cycle Club]\r\nMX2OEM_2023_Kawasaki_KX250=109.408569 1794877306\r\n'),
    [{ track: 'ZD - Kato Cycle Club', bike: 'MX2OEM_2023_Kawasaki_KX250', time: 109.408569, at: 1794877306 }]);
  assert.deepEqual(parseRecords('junk\n[Track]\nbad line\nBike=1\n'), [], 'impossible times are ignored');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-laps-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'profiles', 'Rider'), { recursive: true });
  await fs.writeFile(path.join(root, 'global.ini'), 'lastprofile=Rider\n');
  await fs.writeFile(path.join(root, 'profiles', 'Rider', 'records.ini'), '[Loretta]\nMX1OEM_2023_Honda_CRF450R=95.5 1795000000\n');
  assert.equal(readBestLaps(root)[0].track, 'Loretta');
  assert.deepEqual(readBestLaps(path.join(root, 'nope')), []);
});

test('the leaderboard shows the last 8 tracks for you and mutual friends, best lap per class', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-board-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '../server/mxbm-server.js'), '--port', '0', '--openregister', 'yes', '--requireverified', 'no', '--oldapps', 'show', '--data', path.join(root, 'service.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('service did not start')), 10000);
    child.stdout.on('data', (chunk) => { const m = chunk.toString().match(/on port (\d+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
  });
  const call = async (token, route, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const reg = async (id, name) => (await call(null, '/v1/register', { steamId: id, name })).data;
  const me = await reg('76561198000000001', 'Me'), pal = await reg('76561198000000002', 'Pal'), stranger = await reg('76561198000000003', 'Stranger');
  await call(me.token, '/v1/friends', { ids: [pal.id, stranger.id] });
  await call(pal.token, '/v1/friends', { ids: [me.id] }); // the stranger never adds me back
  const T = 1795000000;
  await call(me.token, '/v1/laps', { laps: [
    { track: 'Kato', bike: 'MX2OEM_2023_Kawasaki_KX250', time: 109.4, at: T },
    { track: 'Kato', bike: 'MX1OEM_2023_Honda_CRF450R', time: 101.2, at: T - 10 },
    ...Array.from({ length: 9 }, (_, i) => ({ track: `Old ${i}`, bike: 'MX1OEM_2023_Honda_CRF450R', time: 90 + i, at: T - 1000 - i })),
    { track: 'Kato', bike: 'bad/bike', time: 99, at: T }, { track: 'Kato', bike: 'MX2OEM_2023_Honda_CRF250R', time: 1, at: T },
  ] });
  await call(pal.token, '/v1/laps', { laps: [{ track: 'kato', bike: 'MX2OEM_2023_Honda_CRF250R', time: 108.1, at: T + 5 }, { track: 'Kato', bike: 'MX2OEM_2023_Yamaha_YZ250F', time: 107.9, at: T + 6 }, { track: 'Kato', bike: 'FACTORY_KX250F', time: 99, at: T }] });
  await call(stranger.token, '/v1/laps', { laps: [{ track: 'Kato', bike: 'MX2OEM_2023_Honda_CRF250R', time: 50, at: T + 9 }] });
  const { tracks } = (await call(me.token, '/v1/leaderboard')).data;
  assert.equal(tracks.length, 8);
  assert.equal(tracks[0].track.toLowerCase(), 'kato', 'the same track in different letter case is one track');
  assert.equal(tracks[0].at, T + 6);
  const byClass = Object.fromEntries(tracks[0].classes.map((c) => [c.class, c.entries.map((e) => [e.name, e.time, e.me])]));
  assert.deepEqual(Object.keys(byClass), ['MX1 OEM', 'MX2 OEM', 'Other bikes']);
  assert.deepEqual(byClass['MX2 OEM'], [['Pal', 107.9, false], ['Me', 109.4, true]], 'one best lap per rider per class; strangers and bad entries left out');
  assert.deepEqual(byClass['MX1 OEM'], [['Me', 101.2, true]]);
  assert.deepEqual(byClass['Other bikes'], [['Pal', 99, false]]);
  assert.equal((await call(stranger.token, '/v1/leaderboard')).data.tracks.every((t2) => t2.classes.every((c) => c.entries.every((e) => e.name === 'Stranger'))), true, 'one-way friends see nothing of mine');
  assert.equal((await call(null, '/v1/leaderboard')).status, 401);
});
