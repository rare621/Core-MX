const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('progress and failed friends refreshes stay bounded instead of immediately retrying', async () => {
  let now = 100000;
  const calls = [], listeners = {}, intervals = [];
  const state = { view: 'online', onlineTab: 'servers', allSrv: {}, friends: [], accounts: { steam: {} } };
  let serverRenders = 0;
  const box = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = value; serverRenders++; },
  };
  const context = vm.createContext({
    S: state, Date: { now: () => now },
    api: { on: (event, cb) => { listeners[event] = cb; }, invoke: async (name) => {
      calls.push(name); await new Promise((resolve) => setImmediate(resolve));
      if (name === 'online:friends') throw new Error('slow down');
      return { servers: [], at: now };
    } },
    document: { addEventListener: () => {} }, setInterval: (cb) => intervals.push(cb),
    $: (selector) => ['#allServers', '#content'].includes(selector) ? box : null,
    $$: () => [],
    icon: () => '', esc: String, cleanErr: (e) => e.message, timeAgo: () => 'just now',
    onlineTabs: () => '',
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/live.js'), 'utf8'), context);
  const status = { service: { connected: true }, plugin: { installed: true }, game: { running: false }, paintSync: {} };
  for (let i = 0; i < 100; i++) listeners['online:status'](status);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((n) => n === 'online:servers').length, 1);
  assert.equal(serverRenders, 1, 'identical status events keep the server cards mounted');
  for (let i = 0; i < 100; i++) listeners['online:status'](status);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  now += 300000;
  await intervals[0]();
  assert.equal(calls.length, 2);
  assert.equal(serverRenders, 1, 'a background refresh with unchanged servers does not flash the list');
  state.onlineTab = 'host'; // Exercise list fetching without drawing the friends screen.
  await context.refreshLiveList('friends');
  for (let i = 0; i < 100; i++) await context.refreshLiveList('friends', true);
  assert.equal(calls.filter((n) => n === 'online:friends').length, 1);
  now += 30000;
  await context.refreshLiveList('friends');
  assert.equal(calls.filter((n) => n === 'online:friends').length, 2);
  state.onlineTab = 'friends'; state.live.friendsNext = 0; state.live.friends = null;
  await context.renderFriends(box);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((n) => n === 'online:friends').length, 3, 'failed initial load does not recursively retry');
  for (let i = 0; i < 100; i++) listeners['online:status'](status);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((n) => n === 'online:friends').length, 3);
});
