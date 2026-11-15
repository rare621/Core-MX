const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { create } = require('../src/lib/app-updates');
test('checks share one request; an update requires consent before download and restarts after explicit install', async () => {
  const updater = new EventEmitter(), events = []; let checks = 0, release, installs = 0;
  updater.checkForUpdates = () => { checks++; updater.emit('checking-for-update'); return new Promise((r) => { release = r; }); };
  updater.quitAndInstall = (silent, runAfter) => { assert.equal(silent, true); assert.equal(runAfter, true); installs++; };
  updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 50 }); updater.emit('update-downloaded', { version: '1.0.8' }); };
  const manager = create({ updater, packaged: true, version: '1.0.7', notify: (s) => events.push(s) });
  const start = manager.start(), again = manager.start(), manual = manager.check();
  await Promise.resolve();
  assert.equal(checks, 1); assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.throws(() => manager.install(), /not finished/);
  updater.emit('update-available', { version: '1.0.8', releaseNotes: 'New preview' });
  assert.equal(manager.status().phase, 'available'); assert.equal(installs, 0); assert.equal(manager.status().notes, 'New preview');
  await manager.download(); release(); await Promise.all([start, again, manual]);
  assert.equal(manager.status().phase, 'ready'); updater.emit('update-not-available'); updater.emit('error', new Error('network disconnected'));
  assert.equal(manager.status().phase, 'ready'); await manager.check(); assert.equal(checks, 1);
  manager.install(); assert.equal(installs, 1); assert.ok(events.some((e) => e.percent === 50));
});
test('development does not hit GitHub and failed startup checks can be retried', async () => {
  const updater = new EventEmitter(); let count = 0;
  updater.checkForUpdates = async () => { if (++count === 1) throw new Error('unreachable'); updater.emit('update-not-available'); };
  const dev = create({ updater, packaged: false, version: 'dev' }); await dev.start(); assert.equal(count, 0);
  const manager = create({ updater: Object.assign(new EventEmitter(), { checkForUpdates: updater.checkForUpdates }), packaged: true, version: '1.0.7' });
  await manager.start(); assert.equal(manager.status().phase, 'error'); await manager.check(); assert.equal(count, 2);
});

test('Drive configuration errors reach Settings without exposing raw response bodies', async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { throw Object.assign(new Error('Duplicate latest.yml in the update folder. Keep one current copy.'), { code: 'DRIVE_UPDATE' }); };
  const manager = create({ updater, packaged: true, version: '1.0.11' });
  assert.match((await manager.check()).error, /Duplicate latest.yml/);
  updater.checkForUpdates = async () => { throw new Error('private raw response'); };
  assert.doesNotMatch((await manager.check()).error, /private raw response/);
});
