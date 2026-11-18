// Forward only the online service API to the existing local sync server.
'use strict';
const http = require('node:http');
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function cleanHeaders(input) {
  const blocked = new Set([...HOP, ...String(input.connection || '').toLowerCase().split(',').map(s => s.trim()), 'cookie', 'set-cookie']);
  return Object.fromEntries(Object.entries(input).filter(([name]) => !blocked.has(name.toLowerCase())));
}
function proxySync(req, res, port = 60000) {
  const headers = cleanHeaders(req.headers);
  // The sync service uses bearer tokens, not website session cookies or forwarded IPs.
  for (const name of Object.keys(headers)) if (/^(?:forwarded|x-forwarded-|cf-|x-coremx-client-ip)/i.test(name)) delete headers[name];
  // The player's public IP, set only here (from Cloudflare), so a Host World session can be joined.
  const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) headers['x-coremx-client-ip'] = ip;
  headers.host = '127.0.0.1:' + port;
  const upstream = http.request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers }, incoming => {
    res.writeHead(incoming.statusCode, { ...cleanHeaders(incoming.headers), 'cache-control': 'no-store' });
    incoming.on('error', () => res.destroy());
    incoming.pipe(res);
  });
  const fail = () => {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'Online sync is temporarily unavailable' }));
  };
  upstream.setTimeout(120000, () => upstream.destroy(new Error('Sync upstream timeout')));
  upstream.on('error', fail);
  req.on('aborted', () => upstream.destroy());
  req.on('error', () => upstream.destroy());
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
}
module.exports = { proxySync };
