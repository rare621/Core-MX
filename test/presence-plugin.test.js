const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('the shipped presence plugin enables events and reports/clears real ABI session packets', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('python', [path.join(__dirname, 'helpers/presence.py'), path.join(__dirname, '../plugin/mxbm_presence.dlo')], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  assert.match(result.stdout, /race\/bike callbacks/);
});
