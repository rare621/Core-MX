const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { proxySync } = require('../server/coremx-website-proxy');
test('sync proxy streams authenticated JSON and bytes without website cookies', async t => {
  const upstream = http.createServer(async (req, res) => {
    const bytes = []; for await (const b of req) bytes.push(b);
    assert.equal(req.headers.authorization, 'Bearer fixture-token');
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.url, '/v1/files/test?download=1');
    res.writeHead(201, { 'content-type': 'application/octet-stream', 'retry-after': '7' }); res.end(Buffer.concat(bytes));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const proxy = http.createServer((req, res) => proxySync(req, res, upstream.address().port));
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); upstream.closeAllConnections(); upstream.close(); });
  const payload = Buffer.from([0, 255, 7, 40]);
  const result = await fetch(`http://127.0.0.1:${proxy.address().port}/v1/files/test?download=1`, { method: 'PUT', headers: { authorization: 'Bearer fixture-token', cookie: 'website=private' }, body: payload });
  assert.equal(result.status, 201); assert.equal(result.headers.get('retry-after'), '7');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), payload);
});
