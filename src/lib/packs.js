// Official OEM bike packs (Project OEM, hosted on mxb-mods.com).
// Reads the pack's zip file list straight from the download host using HTTP range requests,
// compares it with the mods folder, and downloads ONLY the files that are missing or changed.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const site = require('./site');
const hosts = require('./hosts');
const { UA } = require('./site');

const PACKS = [
  { id: 'mx', slug: 'oem-bike-pack', name: 'MX OEM', blurb: 'The standard motocross bikes most servers use.' },
  { id: 'enduro', slug: 'enduro-bike-pack', name: 'Enduro OEM', blurb: 'Enduro bikes with lights and plates.' },
  { id: 'sm', slug: 'sm-oem-bike-pack', name: 'Supermoto OEM', blurb: 'Supermoto bikes for road + dirt tracks.' },
  { id: 'freeride', slug: 'freeride-oem-bike-pack', name: 'Freeride OEM', blurb: 'Freeride / FMX bikes.' },
];

// ---------- remote zip ----------
async function rangeBytes(ses, url, start, end) {
  const res = await ses.fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`Host doesn't support partial downloads (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function remoteSize(ses, url) {
  const res = await ses.fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-0' } });
  const cr = res.headers.get('content-range') || '';
  try { await res.body.cancel(); } catch {}
  const m = cr.match(/\/(\d+)$/);
  if (res.status !== 206 || !m) throw new Error("Host doesn't support partial downloads");
  return Number(m[1]);
}

async function listZip(ses, url) {
  const size = await remoteSize(ses, url);
  const tailLen = Math.min(size, 70000);
  const tail = await rangeBytes(ses, url, size - tailLen, size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not a zip file');
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOff = tail.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff || count === 0xffff) {
    const z = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
    if (z >= 0) { count = Number(tail.readBigUInt64LE(z + 32)); cdSize = Number(tail.readBigUInt64LE(z + 40)); cdOff = Number(tail.readBigUInt64LE(z + 48)); }
  }
  const cd = await rangeBytes(ses, url, cdOff, cdOff + cdSize - 1);
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const fnl = cd.readUInt16LE(p + 28), exl = cd.readUInt16LE(p + 30), cml = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.slice(p + 46, p + 46 + fnl).toString('utf8');
    // zip64 extra field
    let q = p + 46 + fnl;
    const qe = q + exl;
    while (q + 4 <= qe) {
      const id = cd.readUInt16LE(q), len = cd.readUInt16LE(q + 2);
      if (id === 1) {
        let r = q + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(r)); r += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(r)); r += 8; }
        if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(r)); r += 8; }
      }
      q += 4 + len;
    }
    if (!name.endsWith('/')) entries.push({ name, method, csize, usize, offset });
    p += 46 + fnl + exl + cml;
  }
  return { size, entries };
}

// ---------- pack info ----------
const cache = new Map();

function pickDownload(downloads) {
  const full = downloads.filter((d) => !/server|info|patch|template/i.test(d.label + ' ' + d.flag) && !/oem\.mxb-mods\.com/.test(d.url));
  const order = [/mediafire\.com/, /mxb-mods\.com\/wp-content/, /drive\.google\.com/, /dropbox\.com/];
  for (const re of order) { const d = full.find((x) => re.test(x.url)); if (d) return d; }
  return full[0] || null;
}

async function info(ses, packId, force) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error('Unknown pack');
  const hit = cache.get(packId);
  if (hit && !force && Date.now() - hit.at < 30 * 60 * 1000) return hit.data;
  const post = await site.postBySlug(pack.slug);
  if (!post) throw new Error('Pack page not found on mxb-mods.com');
  const version = (post.title.match(/v?(\d+\.\d+(?:\.\d+)?)/) || [])[1] || null;
  const dl = pickDownload(post.downloads);
  let listing = null, listError = null;
  if (dl) {
    try {
      const target = await hosts.resolve(dl.url, ses);
      if (target.type !== 'direct') throw new Error('This download host needs the browser');
      listing = await listZip(ses, target.url);
    } catch (e) { listError = e.message; }
  }
  const data = { ...pack, post: { id: post.id, title: post.title, link: post.link, image: post.images[0] || post.image, modified: post.modified, categories: post.categories }, version, download: dl, listing, listError };
  cache.set(packId, { at: Date.now(), data });
  return data;
}

// Compare pack files with the mods folder.
async function compare(modsDir, data) {
  if (!data.listing) return null;
  const files = data.listing.entries.filter((e) => /^mods\//i.test(e.name)).map((e) => ({ ...e, rel: e.name.replace(/^mods\//i, '') }));
  const rows = [];
  for (const f of files) {
    let status = 'missing';
    try {
      const st = await fsp.stat(path.join(modsDir, f.rel));
      status = st.size === f.usize ? 'ok' : 'changed';
    } catch {}
    rows.push({ rel: f.rel, size: f.usize, status, name: path.posix.basename(f.rel).replace(/\.pkz$/i, '') });
  }
  // Older OEM bikes you have that aren't in the current pack (e.g. renamed models)
  const prefixes = new Set(rows.filter((r) => /^bikes\//i.test(r.rel)).map((r) => r.name.split('_')[0].toUpperCase()));
  const inPack = new Set(rows.map((r) => r.rel.toLowerCase()));
  const old = [];
  try {
    for (const n of await fsp.readdir(path.join(modsDir, 'bikes'))) {
      if (!/\.pkz$/i.test(n)) continue;
      const pre = n.split('_')[0].toUpperCase();
      if (prefixes.has(pre) && !inPack.has(`bikes/${n}`.toLowerCase())) old.push(n.replace(/\.pkz$/i, ''));
    }
  } catch {}
  const need = rows.filter((r) => r.status !== 'ok');
  return {
    rows, old,
    total: rows.length, have: rows.length - need.length,
    needCount: need.length, needBytes: need.reduce((a, r) => a + r.size, 0),
    packBytes: data.listing.size,
  };
}

// Download only the given files out of the remote zip.
async function downloadFiles(ses, data, rels, modsDir, onProgress, signal) {
  const target = await hosts.resolve(data.download.url, ses);
  if (target.type !== 'direct') throw new Error('This download host needs the browser');
  const url = target.url;
  const want = new Set(rels.map((r) => r.toLowerCase()));
  const entries = data.listing.entries.filter((e) => want.has(e.name.replace(/^mods\//i, '').toLowerCase()));
  const total = entries.reduce((a, e) => a + e.csize, 0);
  let done = 0;
  const written = [];
  for (const e of entries) {
    if (signal && signal.aborted) throw new Error('Cancelled');
    const lh = await rangeBytes(ses, url, e.offset, e.offset + 29);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('Bad zip entry header');
    const start = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const rel = e.name.replace(/^mods\//i, '');
    const dest = path.join(modsDir, rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = dest + '.mxbm-part';
    const res = await ses.fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${start}-${start + e.csize - 1}` }, signal });
    if (res.status !== 206) throw new Error(`Download failed (HTTP ${res.status})`);
    const out = fs.createWriteStream(tmp);
    const inflate = e.method === 8 ? zlib.createInflateRaw() : null;
    if (inflate) inflate.pipe(out);
    const sink = inflate || out;
    const reader = res.body.getReader();
    let last = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      done += value.length;
      if (!sink.write(Buffer.from(value))) await new Promise((r) => sink.once('drain', r));
      if (Date.now() - last > 200) { last = Date.now(); onProgress(done, total, rel); }
    }
    await new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); sink.end(); });
    const st = await fsp.stat(tmp);
    if (st.size !== e.usize) { await fsp.rm(tmp, { force: true }); throw new Error(`${rel}: size mismatch after download`); }
    await fsp.rename(tmp, dest);
    written.push(rel);
    onProgress(done, total, rel);
  }
  return written;
}

module.exports = { PACKS, info, compare, downloadFiles, listZip };
