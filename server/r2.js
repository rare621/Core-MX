'use strict';
// Cloudflare R2 storage for synced paint and model files, so they don't travel through the
// server PC's own internet connection. R2 speaks the S3 API; this signs short-lived links with
// AWS Signature V4 (query-string form) so the app can upload and download straight to R2.
// No dependencies. Turned on by an r2.json file next to mxbm-data.json:
//   { "accountId": "<account id>", "accessKeyId": "...", "secretAccessKey": "...", "bucket": "coremx-sync" }
// ("endpoint": "https://<account id>.r2.cloudflarestorage.com" works in place of accountId.)
const crypto = require('crypto');
const fs = require('fs');

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha256hex = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// A presigned URL: anyone holding it may do `method` on that one object until it expires.
function presign({ method, host, path, region, accessKeyId, secretAccessKey, expires = 300, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonicalPath = path.split('/').map(enc).join('/');
  const canonical = [method, canonicalPath, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), 's3'), 'aws4_request');
  return `https://${host}${canonicalPath}?${qs}&X-Amz-Signature=${hmac(key, toSign).toString('hex')}`;
}

// Reads r2.json. Missing file = R2 off (files stay on this PC, as before). A broken file is an error,
// so a typo doesn't silently fall back to the PC's connection.
function loadConfig(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const c = JSON.parse(raw);
  const fromEndpoint = String(c.endpoint || '').match(/^https:\/\/([a-f0-9]{32})\.r2\.cloudflarestorage\.com\/?$/i);
  const accountId = String(c.accountId || (fromEndpoint && fromEndpoint[1]) || '').toLowerCase();
  const cfg = { accountId, accessKeyId: String(c.accessKeyId || ''), secretAccessKey: String(c.secretAccessKey || ''), bucket: String(c.bucket || '') };
  // testOrigin: point at a local stand-in for R2 (tests only).
  if (c.testOrigin) { if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(c.testOrigin)) throw new Error('r2.json: testOrigin must be http://127.0.0.1:<port>'); cfg.testOrigin = c.testOrigin; }
  if (!/^[a-f0-9]{32}$/.test(cfg.accountId)) throw new Error('r2.json: accountId (or endpoint) is missing or wrong');
  if (!cfg.accessKeyId || !cfg.secretAccessKey) throw new Error('r2.json: accessKeyId and secretAccessKey are required');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(cfg.bucket)) throw new Error('r2.json: bucket name is missing or invalid');
  return cfg;
}

function createR2(cfg, { fetchImpl = fetch } = {}) {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const keyFor = (sha) => `files/${sha}`;
  const signed = (method, sha, expires) => presign({ method, host, path: `/${cfg.bucket}/${keyFor(sha)}`, region: 'auto', accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expires });
  const url = (method, sha, expires) => cfg.testOrigin ? signed(method, sha, expires).replace(`https://${host}`, cfg.testOrigin) : signed(method, sha, expires);
  return {
    bucket: cfg.bucket,
    getUrl: (sha, expires = 300) => url('GET', sha, expires),
    putUrl: (sha, expires = 900) => url('PUT', sha, expires),
    // Reads an object back (to check an upload), refusing anything over `max` bytes.
    async read(sha, max) {
      const res = await fetchImpl(url('GET', sha, 120), { signal: AbortSignal.timeout(120000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 read failed (${res.status})`);
      const chunks = []; let n = 0;
      for await (const c of res.body) { n += c.length; if (n > max) throw new Error('R2 object is larger than allowed'); chunks.push(c); }
      return Buffer.concat(chunks);
    },
    async put(sha, buf) {
      const res = await fetchImpl(url('PUT', sha, 900), { method: 'PUT', body: buf, signal: AbortSignal.timeout(300000) });
      if (!res.ok) throw new Error(`R2 upload failed (${res.status})`);
    },
    // Every object under files/ (key, size, last modified), across pages.
    async list() {
      const all = [];
      let token = null;
      for (let page = 0; page < 1000; page++) {
        const query = { 'list-type': '2', prefix: 'files/', ...(token ? { 'continuation-token': token } : {}) };
        const req = signRequest({ method: 'GET', host, path: `/${cfg.bucket}`, query, region: 'auto', accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey });
        const res = await fetchImpl(cfg.testOrigin ? req.url.replace(`https://${host}`, cfg.testOrigin) : req.url, { headers: req.headers, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`R2 list failed (${res.status})`);
        const { items, next } = parseList(await res.text());
        all.push(...items);
        if (!next) break;
        token = next;
      }
      return all;
    },
    async remove(sha) {
      const res = await fetchImpl(url('DELETE', sha, 120), { method: 'DELETE', signal: AbortSignal.timeout(30000) });
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status})`);
    },
  };
}

// A request signed in its Authorization header (AWS Signature V4), for bucket operations a presigned
// link can't do (listing).
function signRequest({ method, host, path, query = {}, region, accessKeyId, secretAccessKey, now = new Date(), payload = 'UNSIGNED-PAYLOAD' }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const headers = { host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [method, path.split('/').map(enc).join('/'), qs, Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join(''), signedHeaders, payload].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), 's3'), 'aws4_request');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(key, toSign).toString('hex')}`;
  return { url: `https://${host}${path}${qs ? '?' + qs : ''}`, headers: { 'x-amz-content-sha256': headers['x-amz-content-sha256'], 'x-amz-date': amzDate, authorization } };
}
// ListObjectsV2 answer: keys, sizes and dates, plus the token for the next page.
function parseList(xml) {
  const items = [...String(xml).matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    key: (m[1].match(/<Key>([^<]*)<\/Key>/) || [])[1] || '',
    size: Number((m[1].match(/<Size>(\d+)<\/Size>/) || [])[1]) || 0,
    modified: Date.parse((m[1].match(/<LastModified>([^<]*)<\/LastModified>/) || [])[1] || '') || 0,
  }));
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = (String(xml).match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/) || [])[1] || null;
  return { items, next: truncated ? next : null };
}

module.exports = { presign, loadConfig, createR2, signRequest, parseList };
