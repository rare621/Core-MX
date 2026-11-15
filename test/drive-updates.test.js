const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DriveProvider, folderFiles } = require('../src/lib/drive-updates');
const name = 'MX-Bikes-Manager-Setup-1.0.10-x64.exe';
const listing = `<div data-id="manifest12345" aria-label="latest.yml"></div><div data-id="installer12345" aria-label="${name}"></div>`;
test('Drive updater resolves folder files and a confirmation page without GitHub', async () => {
  const sha = Buffer.alloc(64).toString('base64'), calls = [];
  const provider = new DriveProvider({ fetch: async (url) => {
    calls.push(url);
    if (url.includes('/folders/')) return new Response(listing);
    if (url.includes('manifest12345')) return new Response(`version: 1.0.10\nfiles:\n  - url: ${name}\n    sha512: ${sha}\n    size: 100`);
    return new Response('<form id="download-form" action="https://drive.usercontent.google.com/download"><input name="id" value="installer12345"><input name="confirm" value="yes"></form>', { headers: { 'content-type': 'text/html' } });
  } }, {}, {});
  assert.equal((await provider.getLatestVersion()).version, '1.0.10');
  assert.equal(provider.resolveFiles()[0].info.sha512, sha);
  assert.match(provider.resolveFiles()[0].url.href, /confirm=yes/);
  assert.ok(calls.every((url) => !url.includes('github')));
  assert.throws(() => folderFiles(listing + '<div data-id="another12345" aria-label="latest.yml"></div>'), /Duplicate/);
});
test('Drive file records parse as data and missing manifests report actionable errors', async () => {
  const html = `AF_initDataCallback({key: 'ds:3', data:[["manifest12345",null,"latest.yml"]], sideChannel: {}});`;
  assert.equal(folderFiles(html).get('latest.yml'), 'manifest12345');
  const provider = new DriveProvider({ fetch: async () => new Response('<html>Empty folder</html>') }, {}, {});
  await assert.rejects(provider.getLatestVersion(), /Could not find latest.yml/);
});

test('Drive decorated file labels retain the exact visible filenames and detect duplicate copies', () => {
  const row = (id, name, type) => `<div data-id="${id}" role="row" aria-label="${name} ${type} Shared"><div role="gridcell"><div data-id="${id}" data-tooltip="${name} ${type}"><span><strong>${name}</strong></span></div><span>Shared</span></div><div role="gridcell">12:00</div></div>`;
  const html = row('manifest12345', 'latest.yml', 'Binary') + row('installer12345', name, 'Unknown');
  assert.deepEqual([...folderFiles(html)], [['manifest12345', 'latest.yml'], ['installer12345', name]].map(([id, n]) => [n, id]));
  assert.throws(() => folderFiles(html + row('othermanifest12345', 'latest.yml', 'Binary')), /Duplicate latest.yml/);
  assert.equal(folderFiles(row('wrongmanifest12345', 'latest.yml.txt', 'Text')).size, 0);
});

test('Drive reports the exact missing installer instead of blaming valid manifest uploads', async () => {
  const provider = new DriveProvider({ fetch: async (url) => new Response(url.includes('/folders/') ? '<div data-id="manifest12345">latest.yml</div>' : `version: 1.0.10\nfiles:\n  - url: ${name}\n    sha512: ${Buffer.alloc(64).toString('base64')}`) }, {}, {});
  await assert.rejects(provider.getLatestVersion(), (error) => error.code === 'DRIVE_UPDATE' && error.message.includes(name));
});
