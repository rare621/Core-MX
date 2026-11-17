const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const imageCode = source.slice(source.indexOf('function itemImage(it)'), source.indexOf('\nfunction placeholder(it)'));
const drawerCode = source.slice(source.indexOf('async function openItem(id, keepScroll)'), source.indexOf('\nasync function loadPaints(it)'));

test('a saved bike render wins over an older assigned picture on the card', () => {
  const context = { S: { env: { modsDir: 'mods', disabledDir: 'disabled' }, imgVer: {} }, enc: encodeURIComponent };
  vm.runInNewContext(imageCode, context);
  const item = { group: 'bikes', key: 'bikes/test.pkz', parts: ['bikes/test.pkz'], bikePreview: 'mxb://bike-preview/abc', customImage: true, hasImage: true };
  assert.equal(context.itemImage(item), item.bikePreview);
});

test('the bike detail preview displays the saved image without constructing a live 3D viewer', async () => {
  const item = { id: 'bike-1', key: 'bikes/test.pkz', group: 'bikes', kind: 'pkz', name: 'test', title: 'Test bike', label: 'Bike', parts: ['bikes/test.pkz'], size: 100, mtime: 1,
    bikePreview: 'mxb://bike-preview/abc', customImage: true, hasImage: true };
  const drawer = { innerHTML: '', classList: { add() {} } };
  const context = {
    S: { items: [item], env: { modsDir: 'mods', disabledDir: 'disabled' }, imgVer: {}, drawerViewer: null },
    enc: encodeURIComponent, esc: String, icon: () => '', placeholder: () => '<div class="ph"></div>', badgesHtml: () => '',
    fmtSize: () => '100 B', fmtDate: () => 'today', timeAgo: () => 'now',
    $: (selector) => selector === '#drawer' ? drawer : selector === '.drawer-body' ? { scrollTop: 0 } : { classList: { add() {} } },
    loadPaints: () => { throw new Error('Unexpected paint loading'); },
  };
  vm.runInNewContext(`${imageCode}\n${drawerCode}`, context);
  await context.openItem(item.id);
  assert.match(drawer.innerHTML, /class="drawer-bike-render" src="mxb:\/\/bike-preview\/abc"/);
  assert.doesNotMatch(drawer.innerHTML, /drawerBikeModel/);
  assert.match(drawer.innerHTML, /Saved 3D image/);
});
