// Thumbnail generation + caching. Runs in the Electron main process (uses nativeImage).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { nativeImage, net } = require('electron');
const { decodeTGA } = require('./tga');
const { withZip } = require('./zipread');
const { pruneThumbs } = require('./cache-cleanup');

class Thumbs {
  constructor(cacheDir, protectedPaths = () => []) {
    this.dir = cacheDir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.inflight = new Map();
    this.protectedPaths = protectedPaths;
    this.lastPruned = 0;
  }

  async prune() {
    if (this.pruning) return this.pruning;
    this.lastPruned = Date.now();
    this.pruning = pruneThumbs(this.dir, [...this.protectedPaths(), ...this.inflight.keys()]).finally(() => { this.pruning = null; });
    return this.pruning;
  }
  schedulePrune() {
    if (Date.now() - this.lastPruned < 600000 || this.pruneTimer) return;
    this.pruneTimer = setTimeout(() => { this.pruneTimer = null; this.prune().catch(() => {}); }, 1500);
    this.pruneTimer.unref();
  }

  hash(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 20); }

  toImage(buf, name) {
    const lower = (name || '').toLowerCase();
    if (lower.endsWith('.tga')) {
      const { width, height, data } = decodeTGA(buf);
      return nativeImage.createFromBitmap(data, { width, height });
    }
    return nativeImage.createFromBuffer(buf);
  }

  async writeThumb(img, out, width = 640) {
    if (img.isEmpty()) throw new Error('empty image');
    const size = img.getSize();
    const scaled = size.width > width ? img.resize({ width, quality: 'good' }) : img;
    await fsp.writeFile(out, scaled.toJPEG(86));
    this.schedulePrune();
    return out;
  }

  // Extract the preview image from a mod (pkz or folder). picRel is the path inside the mod (from scanner info).
  async fromMod(abs, picRel) {
    const st = await fsp.stat(abs);
    const out = path.join(this.dir, this.hash(`${abs}|${st.mtimeMs}|${picRel}`) + '.jpg');
    if (fs.existsSync(out)) return out;
    if (this.inflight.has(out)) return this.inflight.get(out);
    const p = (async () => {
      let buf;
      if (st.isDirectory()) {
        buf = await fsp.readFile(path.join(abs, picRel));
      } else {
        buf = await withZip(abs, async (entries, read) => {
          const e = entries.find((x) => x.fileName === picRel);
          if (!e) throw new Error('pic not in archive');
          return read(e, 48 * 1024 * 1024);
        });
      }
      return this.writeThumb(this.toImage(buf, picRel), out);
    })().finally(() => this.inflight.delete(out));
    this.inflight.set(out, p);
    return p;
  }

  // Download + cache a remote image (e.g. mxb-mods featured image).
  async fromUrl(url, width = 640) {
    const out = path.join(this.dir, 'r_' + this.hash(url) + '.jpg');
    if (fs.existsSync(out)) return out;
    if (this.inflight.has(out)) return this.inflight.get(out);
    const p = (async () => {
      const res = await net.fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      let img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) {
        // webp etc. that nativeImage can't decode: store original bytes, browser can display it
        await fsp.writeFile(out, buf);
        this.schedulePrune();
        return out;
      }
      return this.writeThumb(img, out, width);
    })().finally(() => this.inflight.delete(out));
    this.inflight.set(out, p);
    return p;
  }

  // Save a user-chosen image file as a custom image.
  async fromFile(file, key) {
    const buf = await fsp.readFile(file);
    const img = this.toImage(buf, file);
    const out = path.join(this.dir, 'c_' + this.hash(key + Date.now()) + '.jpg');
    return this.writeThumb(img, out, 960);
  }
}

module.exports = { Thumbs };
