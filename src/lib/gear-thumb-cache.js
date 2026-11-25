// Local, disposable images of gear previews. No source geometry or game files
// are written here; entries are removed when their installed source disappears.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const fileName = (key) => `${crypto.createHash('sha256').update(key).digest('hex')}.webp`;

class GearThumbCache {
  constructor(dir) {
    this.dir = dir;
    this.indexPath = path.join(dir, 'index.json');
    this.queue = Promise.resolve();
    fs.mkdirSync(dir, { recursive: true });
    try { this.entries = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')).entries || {}; }
    catch { this.entries = {}; }
  }

  run(work) {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  file(key) { return path.join(this.dir, fileName(key)); }

  async persist() {
    const temp = this.indexPath + '.tmp';
    await fsp.writeFile(temp, JSON.stringify({ entries: this.entries }));
    await fsp.rename(temp, this.indexPath);
  }

  async get(key) {
    if (typeof key !== 'string' || key.length > 4000 || !this.entries[key]) return null;
    const bytes = await fsp.readFile(this.file(key)).catch(() => null);
    return bytes ? `data:image/webp;base64,${bytes.toString('base64')}` : null;
  }

  async save(key, dataUrl, sourceId) {
    if (typeof key !== 'string' || !key || key.length > 4000) throw new Error('Invalid preview key');
    const match = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!match) throw new Error('Expected a WebP preview');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length < 100 || bytes.length > 2 * 1024 * 1024 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Invalid preview image');
    return this.run(async () => {
      await fsp.writeFile(this.file(key) + '.tmp', bytes);
      await fsp.rename(this.file(key) + '.tmp', this.file(key));
      this.entries[key] = { sourceId: typeof sourceId === 'string' ? sourceId : null };
      await this.persist();
    });
  }

  async prune(installedIds) {
    const installed = new Set(installedIds);
    return this.run(async () => {
      let changed = false;
      for (const [key, entry] of Object.entries(this.entries)) {
        if (!entry.sourceId || installed.has(entry.sourceId)) continue;
        delete this.entries[key]; changed = true;
        await fsp.rm(this.file(key), { force: true }).catch(() => {});
      }
      if (changed) await this.persist();
    });
  }
}

module.exports = { GearThumbCache };
