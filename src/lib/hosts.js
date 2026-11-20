// Resolves file-host links to direct downloads and downloads them (with Mega decryption).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UA } = require('./site');

const FOLDER_PATTERNS = [/mega\.nz\/folder\//, /mega\.nz\/#F!/, /drive\.google\.com\/drive\/folders\//, /mediafire\.com\/folder\//, /dropbox\.com\/scl\/fo\//, /dropbox\.com\/sh\//];

function safeName(name) {
  return String(name || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+$/, '').slice(0, 180) || 'download';
}

// Headers arrive as Latin-1: a UTF-8 file name ("español.str") shows as "espaÃ±ol.str". Decode it
// back when the bytes are valid UTF-8.
function utf8Name(name) {
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return name;
  const text = Buffer.from(name, 'latin1').toString('utf8');
  return text.includes('\ufffd') ? name : text;
}
function filenameFromHeaders(headers, url) {
  const cd = headers.get('content-disposition') || '';
  let m = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (m) return safeName(decodeURIComponent(m[1].replace(/"/g, '')));
  m = cd.match(/filename\s*=\s*"([^"]+)"/) || cd.match(/filename\s*=\s*([^;]+)/);
  if (m) return safeName(utf8Name(m[1].trim()));
  try { return safeName(decodeURIComponent(path.basename(new URL(url).pathname))); } catch { return 'download'; }
}

function b64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/,/g, '');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// Decide how to fetch a link.
async function resolve(url, ses) {
  if (FOLDER_PATTERNS.some((re) => re.test(url))) return { type: 'browser', url, reason: /mediafire\.com\/folder\//i.test(url) ? 'MediaFire requires Premium to download a whole folder. Pick an individual file in the browser window; CoreMX will install that file.' : 'This link is a folder; pick an individual file in the browser window.' };
  let u;
  try { u = new URL(url); } catch { return { type: 'browser', url, reason: 'Unrecognised link' }; }
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'mxb-mods.com' && u.pathname.startsWith('/wp-content/')) return { type: 'direct', url };

  if (host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com') {
    const id = (url.match(/\/d\/([\w-]{10,})/) || url.match(/[?&]id=([\w-]{10,})/) || [])[1];
    if (id) return { type: 'direct', url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, fallback: url, gdrive: true };
  }

  if (host.endsWith('mediafire.com') && /\/file\//.test(u.pathname)) {
    const res = await ses.fetch(url, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    const m = html.match(/href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/);
    if (m) return { type: 'direct', url: m[1], fallback: url };
    const scr = html.match(/data-scrambled-url="([^"]+)"/);
    if (scr) { try { return { type: 'direct', url: Buffer.from(scr[1], 'base64').toString('utf8'), fallback: url }; } catch {} }
    return { type: 'browser', url, reason: 'MediaFire did not give a direct link' };
  }

  if (host === 'mega.nz' || host === 'mega.co.nz') {
    let m = url.match(/mega\.(?:nz|co\.nz)\/file\/([^#?]+)#([\w-]+)/) || url.match(/mega\.(?:nz|co\.nz)\/#!([^!]+)!([\w-]+)/);
    if (m) return { type: 'mega', handle: m[1], key: m[2], fallback: url };
  }

  if (host.endsWith('dropbox.com') && /\/(s|scl\/fi)\//.test(u.pathname)) {
    u.searchParams.set('dl', '1');
    return { type: 'direct', url: u.toString(), fallback: url };
  }

  if (/\.(pkz|zip|rar|7z|pnt)$/i.test(u.pathname)) return { type: 'direct', url };
  // Unknown host: try it; if it turns out to be a web page, fall back to the browser window.
  return { type: 'direct', url, fallback: url, probe: true };
}

async function streamToFile(body, file, total, onProgress, signal, transform) {
  const out = fs.createWriteStream(file);
  let received = 0, last = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      if (signal && signal.aborted) throw new Error('Cancelled');
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      const chunk = transform ? transform.update(Buffer.from(value)) : Buffer.from(value);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const now = Date.now();
      if (now - last > 150) { last = now; onProgress && onProgress(received, total); }
    }
    if (transform) out.write(transform.final());
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    onProgress && onProgress(received, total);
    return received;
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(file); } catch {}
    throw e;
  }
}

class NeedsBrowser extends Error {
  constructor(url, reason) { super(reason); this.url = url; this.needsBrowser = true; }
}

async function downloadDirect(target, destDir, ses, onProgress, signal) {
  const res = await ses.fetch(target.url, { headers: { 'User-Agent': UA }, signal });
  if (!res.ok) {
    if (target.fallback) throw new NeedsBrowser(target.fallback, `Host returned HTTP ${res.status}`);
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  const finalUrl = res.url || target.url;
  if (type.includes('text/html') || /accounts\.google\.com/.test(finalUrl)) {
    try { await res.body.cancel(); } catch {}
    const reason = /accounts\.google\.com/.test(finalUrl)
      ? 'This Google Drive file needs you to sign in to Google (the author restricted it).'
      : 'The host showed a web page instead of a file.';
    throw new NeedsBrowser(target.fallback || target.url, reason);
  }
  const name = filenameFromHeaders(res.headers, finalUrl);
  const total = Number(res.headers.get('content-length') || 0);
  const file = path.join(destDir, name);
  await streamToFile(res.body, file, total, onProgress, signal);
  return file;
}

async function downloadMega(target, destDir, ses, onProgress, signal) {
  const raw = b64url(target.key);
  if (raw.length < 32) throw new Error('Invalid Mega key');
  const a = [];
  for (let i = 0; i < 8; i++) a.push(raw.readUInt32BE(i * 4));
  const k = Buffer.alloc(16), iv = Buffer.alloc(16);
  for (let i = 0; i < 4; i++) k.writeUInt32BE((a[i] ^ a[i + 4]) >>> 0, i * 4);
  iv.writeUInt32BE(a[4], 0); iv.writeUInt32BE(a[5], 4);

  const api = await ses.fetch(`https://g.api.mega.co.nz/cs?id=${Date.now() % 1e9}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify([{ a: 'g', g: 1, ssl: 2, p: target.handle }]), signal,
  });
  const json = await api.json();
  const info = Array.isArray(json) ? json[0] : json;
  if (typeof info === 'number' || !info || !info.g) {
    throw new NeedsBrowser(target.fallback, `Mega refused the download (code ${typeof info === 'number' ? info : '?'}). It may be over quota or removed.`);
  }
  let name = 'mega-download';
  try {
    const dec = crypto.createDecipheriv('aes-128-cbc', k, Buffer.alloc(16));
    dec.setAutoPadding(false);
    const attr = Buffer.concat([dec.update(b64url(info.at)), dec.final()]).toString('utf8').replace(/\0+$/, '');
    if (attr.startsWith('MEGA')) name = JSON.parse(attr.slice(4)).n || name;
  } catch {}
  const res = await ses.fetch(info.g, { signal });
  if (!res.ok) throw new NeedsBrowser(target.fallback, `Mega download failed (HTTP ${res.status})`);
  const file = path.join(destDir, safeName(name));
  const decipher = crypto.createDecipheriv('aes-128-ctr', k, iv);
  await streamToFile(res.body, file, info.s || 0, onProgress, signal, decipher);
  return file;
}

async function download(url, destDir, ses, onProgress, signal) {
  fs.mkdirSync(destDir, { recursive: true });
  const target = await resolve(url, ses);
  if (target.type === 'browser') throw new NeedsBrowser(target.url, target.reason);
  if (target.type === 'mega') return downloadMega(target, destDir, ses, onProgress, signal);
  return downloadDirect(target, destDir, ses, onProgress, signal);
}

module.exports = { download, resolve, NeedsBrowser, safeName };
