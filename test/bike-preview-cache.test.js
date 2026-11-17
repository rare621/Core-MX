const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { BikePreviewCache } = require('../src/lib/bike-preview-cache');

const bike = (mtime = 1) => ({ group: 'bikes', key: 'bikes/MX1OEM_2023_Kawasaki_KX250.pkz', size: 700, mtime, kind: 'pkz' });
const image = () => {
  const bytes = Buffer.alloc(120);
  bytes.write('RIFF', 0); bytes.write('WEBP', 8);
  return 'data:image/webp;base64,' + bytes.toString('base64');
};

test('bike previews survive restart, refresh after a bike update, and disappear with a deleted mod', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-bike-preview-'));
  try {
    const cache = new BikePreviewCache(dir), first = bike();
    assert.equal((await cache.reconcile([first])).initialized, false);
    const url = await cache.save(first, image());
    assert.match(url, /^mxb:\/\/bike-preview\/[a-f0-9]{24}/);
    assert.ok(await cache.image(new URL(url).pathname.slice(1)));
    await cache.finishSetup();

    const reopened = new BikePreviewCache(dir), unchanged = bike();
    assert.equal((await reopened.reconcile([unchanged])).initialized, true);
    assert.equal(unchanged.bikePreview, url);

    const updated = bike(2);
    await reopened.reconcile([updated]);
    assert.equal(updated.bikePreview, undefined);
    assert.equal(await reopened.image(new URL(url).pathname.slice(1)), null);

    const newUrl = await reopened.save(updated, image());
    await reopened.reconcile([]);
    assert.equal(await reopened.image(new URL(newUrl).pathname.slice(1)), null);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['index.json']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('unreadable models retain a fallback picture and can be retried', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coremx-bike-preview-'));
  try {
    const cache = new BikePreviewCache(dir), item = bike();
    await cache.reconcile([item]);
    await assert.rejects(cache.save(item, 'data:image/png;base64,AAAA'), /WebP/);
    await cache.unavailable(item);
    const scanned = bike();
    await cache.reconcile([scanned]);
    assert.equal(scanned.bikePreviewFailed, true);
    await cache.retryUnavailable();
    const retried = bike();
    await cache.reconcile([retried]);
    assert.equal(retried.bikePreviewFailed, undefined);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
