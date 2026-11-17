// Persistent renders of locally installed bikes. Only files owned by this cache
// are removed; deleting or replacing a bike invalidates its old render.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const VERSION = 1;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
const fingerprint = (item) => `${VERSION}|${item.key}|${item.size}|${item.mtime}|${item.kind}`;

class BikePreviewCache {
  constructor(dir) {
    this.dir = dir;
    this.indexPath = path.join(dir, 'index.json');
    this.entries = {};
    this.initialized = false;
    this.current = new Map();
    this.queue = Promise.resolve();
    fs.mkdirSync(dir, { recursive: true });
    try {
      const saved = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      this.entries = saved.entries || {};
      this.initialized = saved.initialized === true;
    } catch {}
  }

  run(work) {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  file(key) { return path.join(this.dir, `${hash(key)}.webp`); }
  async persist() {
    const temp = this.indexPath + '.tmp';
    await fsp.writeFile(temp, JSON.stringify({ initialized: this.initialized, entries: this.entries }));
    await fsp.rename(temp, this.indexPath);
  }

  async reconcile(items) {
    return this.run(async () => {
      const bikes = items.filter((i) => i.group === 'bikes' && !i.stock);
      const current = new Map(bikes.map((i) => [i.key, fingerprint(i)]));
      this.current = current;
      let changed = false;
      for (const [key, entry] of Object.entries(this.entries)) {
        if (current.get(key) === entry.fingerprint) continue;
        delete this.entries[key]; changed = true;
        await fsp.rm(this.file(key), { force: true }).catch(() => {});
      }
      for (const item of bikes) {
        const entry = this.entries[item.key];
        if (!entry) continue;
        if (entry.status === 'ready' && !fs.existsSync(this.file(item.key))) {
          delete this.entries[item.key]; changed = true; continue;
        }
        if (entry.status === 'ready') item.bikePreview = this.url(item.key, entry.fingerprint);
        else if (entry.status === 'unavailable') item.bikePreviewFailed = true;
      }
      if (changed) await this.persist();
      return { initialized: this.initialized };
    });
  }

  url(key, stamp) { return `mxb://bike-preview/${hash(key)}?v=${hash(stamp)}`; }

  async save(item, dataUrl) {
    return this.run(async () => {
      if (this.current.get(item.key) !== fingerprint(item)) throw new Error('Bike changed while rendering');
      const match = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
      if (!match) throw new Error('Expected a WebP bike render');
      const bytes = Buffer.from(match[1], 'base64');
      if (bytes.length < 100 || bytes.length > 2 * 1024 * 1024 || !bytes.subarray(0, 4).equals(Buffer.from('RIFF')) || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Invalid bike render');
      const target = this.file(item.key);
      await fsp.writeFile(target + '.tmp', bytes);
      await fsp.rename(target + '.tmp', target);
      const stamp = fingerprint(item);
      this.entries[item.key] = { fingerprint: stamp, status: 'ready' };
      await this.persist();
      return this.url(item.key, stamp);
    });
  }

  async unavailable(item) {
    return this.run(async () => {
      if (this.current.get(item.key) !== fingerprint(item)) return;
      this.entries[item.key] = { fingerprint: fingerprint(item), status: 'unavailable' };
      await this.persist();
    });
  }

  async finishSetup() {
    return this.run(async () => { this.initialized = true; await this.persist(); });
  }

  async retryUnavailable() {
    return this.run(async () => {
      for (const [key, entry] of Object.entries(this.entries)) if (entry.status === 'unavailable') delete this.entries[key];
      await this.persist();
    });
  }

  async image(token) {
    const key = Object.keys(this.entries).find((k) => hash(k) === token && this.entries[k].status === 'ready');
    return key ? fsp.readFile(this.file(key)).catch(() => null) : null;
  }
}

module.exports = { BikePreviewCache, fingerprint };
