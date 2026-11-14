const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { create } = require('../src/lib/app-updates');
test('startup and manual update checks share one request and a verified download waits for a normal quit or explicit restart', async () => {
  const updater = new EventEmitter(), events = []; let checks = 0, release, installs = 0;
  updater.checkForUpdates = () => { checks++; updater.emit('checking-for-update'); return new Promise((r) => { release = r; }); };
  updater.quitAndInstall = (silent, runAfter) => { assert.equal(silent, false); assert.equal(runAfter, true); installs++; };
  const manager = create({ updater, packaged: true, version: '1.0.7', notify: (s) => events.push(s) });
  const start = manager.start(), again = manager.start(), manual = manager.check();
  await Promise.resolve();
  assert.equal(checks, 1); assert.equal(updater.autoDownload, true); assert.equal(updater.autoInstallOnAppQuit, true);
  assert.throws(() => manager.install(), /not finished/);
  updater.emit('update-available', { version: '1.0.8' }); updater.emit('download-progress', { percent: 50 });
  assert.equal(manager.status().phase, 'downloading'); assert.equal(installs, 0);
  updater.emit('update-downloaded', { version: '1.0.8' }); release(); await Promise.all([start, again, manual]);
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
