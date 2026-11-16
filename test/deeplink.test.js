const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, fromArgv } = require('../src/lib/deeplink');

test('join links keep working', () => {
  assert.deepEqual(parse('mxbm://join/1.2.3.4:54210'), { type: 'join', address: '1.2.3.4:54210' });
  assert.deepEqual(parse('mxbm://join/1.2.3.4%3A54210/'), { type: 'join', address: '1.2.3.4:54210' });
});
test('install links from the website', () => {
  assert.deepEqual(parse('mxbm://install/mxbmods/193092'), { type: 'install', source: 'mxbmods', id: 193092 });
  assert.deepEqual(parse('mxbm://install/mxbmods/193092?file=2'), { type: 'install', source: 'mxbmods', id: 193092, file: 2 });
  assert.deepEqual(parse('mxbm://install/mxbmods/193092/?file=0'), { type: 'install', source: 'mxbmods', id: 193092, file: 0 });
  assert.deepEqual(parse('mxbm://install/hub/4411'), { type: 'install', source: 'hub', id: 4411 });
  assert.deepEqual(parse('MXBM://install/MXBS/77/'), { type: 'install', source: 'mxbs', id: 77 });
});
test('oem pack links', () => {
  for (const pack of ['mx', 'enduro', 'sm', 'freeride']) assert.deepEqual(parse(`mxbm://oem/${pack}`), { type: 'oem', pack });
  assert.deepEqual(parse('mxbm://oem/mx/'), { type: 'oem', pack: 'mx' });
});
test('anything else is ignored', () => {
  for (const bad of ['mxbm://install/evil/1', 'mxbm://install/mxbmods/abc', 'mxbm://install/mxbmods/0', 'mxbm://install/mxbmods/1?file=x', 'mxbm://install/mxbmods/1?file=1&x=2',
    'mxbm://install/mxbmods/1/../2', 'mxbm://oem/other', 'mxbm://oem/mx?x=1', 'mxbm://join/', 'mxbm://join/a b', 'mxbm://run/calc.exe', 'https://coremx.app', '', null, 'mxbm://' + 'a'.repeat(400)]) assert.equal(parse(bad), null);
});
test('finds the link among process arguments', () => {
  assert.deepEqual(fromArgv(['C:\\app.exe', '--flag', 'mxbm://oem/sm']), { type: 'oem', pack: 'sm' });
  assert.equal(fromArgv(['C:\\app.exe']), null);
  assert.equal(fromArgv(undefined), null);
});
