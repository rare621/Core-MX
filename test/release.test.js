const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseServiceUrl } = require('../scripts/release-hooks.cjs');
const config = require('../electron-builder.config.cjs');

test('releases do not reuse the developer LAN address and validate an explicit service origin', () => {
  assert.equal(releaseServiceUrl(), '');
  assert.equal(releaseServiceUrl(' https://service.example/ '), 'https://service.example');
  for (const bad of ['file:///etc/passwd', 'https://user:password@example.com', 'https://example.com/private', 'https://example.com?token=abc']) {
    assert.throws(() => releaseServiceUrl(bad));
  }
});

test('Windows setup bundles only runtime files and preserves user data on uninstall', () => {
  assert.ok(config.files.includes('main.js'));
  assert.ok(!config.files.includes('**/*'));
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.ok(config.protocols[0].schemes.includes('mxbm'));
});
