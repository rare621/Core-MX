const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { create } = require('../src/lib/app-updates');
test('checks share one request; an update requires consent before download and restarts after explicit install', async () => {
  const updater = new EventEmitter(), events = []; let checks = 0, release, installs = 0, feed;
  updater.setFeedURL = (value) => { feed = value; };
  updater.checkForUpdates = () => { checks++; updater.emit('checking-for-update'); return new Promise((r) => { release = r; }); };
  updater.quitAndInstall = (silent, runAfter) => { assert.equal(silent, true); assert.equal(runAfter, true); installs++; };
  updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 50 }); updater.emit('update-downloaded', { version: '1.0.8' }); };
  const manager = create({ updater, packaged: true, version: '1.0.7', notify: (s) => events.push(s) });
  assert.deepEqual(feed, { provider: 'github', owner: 'rare621', repo: 'Core-MX' });
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
  // The startup check is quiet: a failure shows nothing; a check from Settings retries and reports.
  await manager.start(); assert.equal(manager.status().phase, 'idle'); await manager.check(); assert.equal(count, 2);
});

test('background checks every few minutes are invisible until an update exists', async () => {
  const updater = new EventEmitter(), events = []; let mode = 'none';
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update');
    if (mode === 'fail') { updater.emit('error', new Error('offline')); throw new Error('offline'); }
    if (mode === 'none') updater.emit('update-not-available'); else updater.emit('update-available', { version: '1.0.9' });
  };
  const manager = create({ updater, packaged: true, version: '1.0.8', notify: (s) => events.push(s.phase) });
  await manager.check(); events.length = 0;
  await manager.background(); mode = 'fail'; await manager.background();
  assert.deepEqual(events, [], 'no "Checking", no repeat "up to date", no error');
  assert.equal(manager.status().phase, 'current');
  mode = 'update'; await manager.background();
  assert.deepEqual(events, ['available']);
  assert.equal(manager.status().version, '1.0.9');
  mode = 'fail'; await manager.check();
  assert.equal(manager.status().phase, 'error', 'a check you start yourself still reports problems');
});

test('GitHub update errors reach Settings without exposing raw response bodies', async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { throw new Error('private raw response'); };
  const manager = create({ updater, packaged: true, version: '1.0.11' });
  const result = await manager.check();
  assert.match(result.error, /GitHub/);
  assert.doesNotMatch(result.error, /private raw response/);
});
