const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { releaseServiceUrl, prepareResources } = require('../scripts/release-hooks.cjs');
const config = require('../electron-builder.config.cjs');

test('release service origins are validated', () => {
  assert.equal(releaseServiceUrl(), '');
  assert.equal(releaseServiceUrl(' https://service.example/ '), 'https://service.example');
  for (const bad of ['file:///etc/passwd', 'https://user:password@example.com', 'https://example.com/private', 'https://example.com?token=abc']) {
    assert.throws(() => releaseServiceUrl(bad));
  }
});

test('installer inherits the HTTPS service and migration aliases unless the build overrides it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-release-config-'));
  const previous = process.env.MXB_SERVICE_URL;
  t.after(async () => {
    if (previous === undefined) delete process.env.MXB_SERVICE_URL;
    else process.env.MXB_SERVICE_URL = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'plugin'));
  await fs.writeFile(path.join(root, 'plugin', 'mxbm_presence.dlo'), 'test plugin');
  await fs.mkdir(path.join(root, 'src', 'lib', 'native'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'lib', 'native', 'coremx_reader.node'), 'test addon');
  await fs.writeFile(path.join(root, 'online.config.json'), JSON.stringify({ serviceUrl: 'https://coremx.app', previousServiceUrls: ['http://67.84.130.214:60000', 'http://192.168.0.38:60000'] }));
  process.env.MXB_SERVICE_URL = '';
  const context = { packager: { projectDir: root } };
  const generated = path.join(root, 'build', 'generated', 'online.config.json');
  await prepareResources(context);
  assert.deepEqual(JSON.parse(await fs.readFile(generated, 'utf8')), { serviceUrl: 'https://coremx.app', previousServiceUrls: ['http://67.84.130.214:60000', 'http://192.168.0.38:60000'] });
  process.env.MXB_SERVICE_URL = 'https://service.example';
  await prepareResources(context);
  assert.deepEqual(JSON.parse(await fs.readFile(generated, 'utf8')), { serviceUrl: 'https://service.example' });
});

test('Windows setup bundles only runtime files and preserves user data on uninstall', () => {
  assert.ok(config.files.includes('main.js'));
  assert.ok(!config.files.includes('**/*'));
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.ok(config.protocols[0].schemes.includes('mxbm'));
});
