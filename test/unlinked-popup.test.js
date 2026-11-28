const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// v30: gear you wear that friends can't get yet (not installed through CoreMX, or out of date) is listed
// in a pop-up the first time you open Friends, and again only when something new is on the list.
test('v30: the Friends pop-up lists gear to reinstall once per new item', () => {
  const opened = [], storage = new Map();
  const context = vm.createContext({
    S: { live: { status: null }, friends: [], accounts: {} },
    api: { on: () => {}, invoke: async () => ({}) },
    document: { addEventListener: () => {} }, setInterval: () => {},
    setTimeout: (fn) => fn(),
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    modal: (opts) => { opened.push(opts); return { addEventListener: () => {}, close: () => {} }; },
    $: () => null, $$: () => [], icon: () => '', esc: (s) => String(s), cleanErr: (e) => e.message, timeAgo: () => 'now', onlineTabs: () => '',
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/live.js'), 'utf8'), context);
  const gloves = { slot: 'glovesPaint', label: "Gloves: 21' Fly Racing Evo G+B", value: "21' Fly Racing Evo G+B", state: 'none', source: null };
  const helmet = { slot: 'helmet', label: 'Helmet: Fox V3', value: 'Fox V3', state: 'outdated', source: { postId: 5, title: 'Fox V3', link: 'https://mxb-mods.com/fox/' } };
  const ps = (rows) => ({ unlinked: rows });

  assert.equal(context.unlinkedTipHtml(ps([])), '', 'nothing to fix: no banner');
  assert.match(context.unlinkedTipHtml(ps([gloves, helmet])), /2 items of your gear can't reach friends yet/);
  assert.match(context.unlinkedTipHtml(ps([gloves, helmet])), /1 is out of date/);

  context.S.live.status = { paintSync: ps([gloves]) };
  context.noteUnlinked(ps([gloves]));
  assert.equal(opened.length, 1, 'first time: shown');
  assert.match(opened[0].body, /Not installed through CoreMX/);
  assert.match(opened[0].body, /Search Get Mods/, 'no page known: search');
  assert.match(opened[0].body, /click Delete, then click Install/);
  context.noteUnlinked(ps([gloves]));
  assert.equal(opened.length, 1, 'same list: not shown again');

  context.S.live.status = { paintSync: ps([gloves, helmet]) };
  context.noteUnlinked(ps([gloves, helmet]));
  assert.equal(opened.length, 2, 'something new: shown again');
  assert.match(opened[1].body, /Out of date/);
  assert.match(opened[1].body, /Reinstall from MXB Mods/, 'its page is known: reinstall from it');
  context.noteUnlinked(ps([helmet]));
  assert.equal(opened.length, 2, 'a smaller list: nothing new');
});
