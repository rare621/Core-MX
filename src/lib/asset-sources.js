// Shared loose/package lookup for catalogs, previews and equipped paint sync.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { openArchive, localPreviewEnabled } = require('./assetread');

// ---------- file sources: a folder on disk or a folder inside a .pkz ----------
const zips = new Map(); // pkz path -> Promise<{ zip, entries: Map(lowerPath -> entry) }>
function openZip(file) {
  const cacheKey = `${localPreviewEnabled() ? 'preview' : 'standard'}:${file}`;
  let stamp;
  try { const st = fs.statSync(file); stamp = `${st.mtimeMs}|${st.size}`; } catch (e) { zips.delete(cacheKey); return Promise.reject(e); }
  if (zips.get(cacheKey)?.stamp !== stamp) zips.delete(cacheKey);
  if (!zips.has(cacheKey)) {
    const promise = openArchive(file).then((archive) => {
      const entries = new Map(archive.entries.map((e) => [e.fileName.replace(/\\/g, '/').toLowerCase(), e]));
      return { archive, entries };
    }).catch((e) => { zips.delete(cacheKey); throw e; });
    promise.stamp = stamp;
    zips.set(cacheKey, promise);
    while (zips.size > 24) zips.delete(zips.keys().next().value);
  }
  return zips.get(cacheKey);
}
async function zipRead(file, entry) {
  const { archive } = await openZip(file);
  return archive.read(entry);
}

// A folder: { dir } or { pkz, prefix }. Returns null when it doesn't exist.
async function folder(spec) {
  if (!spec) return null;
  if (spec.dir) {
    if (fs.existsSync(spec.dir) && fs.statSync(spec.dir).isDirectory()) return { kind: 'dir', dir: spec.dir, key: spec.dir };
    return null;
  }
  try {
    const { entries } = await openZip(spec.pkz);
    let prefix = spec.prefix;
    if (prefix == null) { // a mod .pkz: the folder holding its gfx.cfg / .edf, shallowest first
      const rank = (k) => /(^|\/)gfx\.cfg$/.test(k) ? 0 : /\.hrc$/.test(k) ? 1 : /\.edf$/.test(k) ? 2 : 3;
      const hits = [...entries.keys()].filter((k) => /(^|\/)(gfx\.cfg|[^/]+\.(?:hrc|edf|pnt))$/.test(k)).sort((a, b) => rank(a) - rank(b) || a.split('/').length - b.split('/').length);
      if (!hits.length) return null;
      prefix = hits[0].includes('/') ? hits[0].slice(0, hits[0].lastIndexOf('/') + 1) : '';
    } else {
      prefix = prefix.toLowerCase().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (prefix) prefix += '/';
      if (![...entries.keys()].some((k) => k.startsWith(prefix))) return null;
    }
    return { kind: 'pkz', pkz: spec.pkz, prefix, entries, key: spec.pkz + '|' + prefix };
  } catch { return null; }
}
async function readIn(f, rel) {
  if (!f) return null;
  rel = String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
  if (rel.split('/').some((part) => part === '..') || /^[\/]|:|\0/.test(rel)) return null;
  if (f.kind === 'dir') {
    const p = path.join(f.dir, ...rel.split('/'));
    try { const st = await fsp.stat(p); if (st.isFile()) return { buf: await fsp.readFile(p), key: p + '@' + st.mtimeMs, path: p }; } catch {}
    // Archives and Windows folders are case-insensitive in the game; tests and
    // imported archives may retain different casing on other filesystems.
    let actual = f.dir;
    try {
      for (const part of rel.split('/')) {
        const name = (await fsp.readdir(actual)).find((n) => n.toLowerCase() === part.toLowerCase());
        if (!name) return null;
        actual = path.join(actual, name);
      }
      const st = await fsp.stat(actual);
      if (st.isFile()) return { buf: await fsp.readFile(actual), key: actual + '@' + st.mtimeMs, path: actual };
    } catch {}
    return null;
  }
  const e = f.entries.get(f.prefix + rel.toLowerCase());
  return e ? { buf: await zipRead(f.pkz, e), key: f.key + rel + '@' + e.crc32, archivePath: f.pkz, entry: e.fileName } : null;
}
// First folder in a chain that has the file.
async function readChain(chain, rel) {
  for (const f of chain) { const r = await readIn(f, rel); if (r) return r; }
  return null;
}
async function chainOf(specs) {
  // Loose paints/config overrides and the packaged model coexist. A paint-only
  // directory must not hide its sibling .pkz (the usual helmet/boots layout).
  const sources = specs.flatMap((s) => s && s.dir
    ? [s, fs.existsSync(s.dir + '.pkz') ? { pkz: s.dir + '.pkz', prefix: null } : null]
    : [s]);
  return (await Promise.all(sources.map(folder))).filter(Boolean);
}


async function listFiles(sources) {
  const out = new Map();
  for (const s of sources) {
    const add = (relative) => { if (!out.has(relative.toLowerCase())) out.set(relative.toLowerCase(), relative); };
    if (s.kind === 'dir') {
      const walk = async (relative = '', depth = 0) => {
        if (depth > 8 || out.size > 2000) return;
        for (const e of await fsp.readdir(path.join(s.dir, relative), { withFileTypes: true }).catch(() => [])) {
          const next = relative ? `${relative}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(next, depth + 1);
          else if (e.isFile()) add(next);
        }
      };
      await walk();
    } else for (const [key, entry] of s.entries) {
      if (key.startsWith(s.prefix) && !key.endsWith('/')) add(entry.fileName.replace(/\\/g, '/').slice(s.prefix.length));
    }
  }
  return [...out.values()].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
}

module.exports = { chainOf, readChain, listFiles };
