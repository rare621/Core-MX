const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const upnp = require('../src/lib/upnp');

const WAN = 'urn:schemas-upnp-org:service:WANIPConnection:1';
const DESC = `<?xml version="1.0"?><root><device><serviceList>
  <service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3f</controlURL></service>
  <service><serviceType>${WAN}</serviceType><controlURL>/ctl/IPConn</controlURL></service>
</serviceList></device></root>`;

// A fake Internet Gateway Device: description plus SOAP control, recording each call.
function fakeRouter({ existingClient = null, onlyPermanent = false } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/desc.xml') { res.writeHead(200, { 'content-type': 'text/xml' }); return res.end(DESC); }
      const action = (req.headers.soapaction || '').replace(/"/g, '').split('#')[1];
      const arg = (k) => (body.match(new RegExp(`<${k}>([^<]*)</${k}>`)) || [])[1];
      calls.push({ action, url: req.url, port: arg('NewExternalPort'), client: arg('NewInternalClient'), lease: arg('NewLeaseDuration'), protocol: arg('NewProtocol'), description: arg('NewPortMappingDescription') });
      const fault = (code, text) => { res.writeHead(500); res.end(`<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode><errorDescription>${text}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`); };
      if (action === 'GetSpecificPortMappingEntry') {
        if (!existingClient) return fault(714, 'NoSuchEntryInArray');
        res.writeHead(200); return res.end(`<s:Envelope><s:Body><u:R><NewInternalClient>${existingClient}</NewInternalClient></u:R></s:Body></s:Envelope>`);
      }
      if (action === 'AddPortMapping' && onlyPermanent && arg('NewLeaseDuration') !== '0') return fault(725, 'OnlyPermanentLeasesSupported');
      res.writeHead(200); res.end('<s:Envelope><s:Body/></s:Envelope>');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, location: `http://127.0.0.1:${server.address().port}/desc.xml` })));
}

test('SSDP answers and router descriptions are read', () => {
  assert.equal(upnp.parseSsdp('HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLOCATION: http://192.168.1.1:5000/rootDesc.xml\r\nST: x\r\n\r\n'), 'http://192.168.1.1:5000/rootDesc.xml');
  assert.equal(upnp.parseSsdp('HTTP/1.1 200 OK\r\n\r\n'), null);
  assert.deepEqual(upnp.parseDescription(DESC, 'http://192.168.1.1:5000/rootDesc.xml'), { serviceType: WAN, controlURL: 'http://192.168.1.1:5000/ctl/IPConn' });
  assert.equal(upnp.parseDescription('<root/>', 'http://x/'), null);
  assert.match(upnp.soapEnvelope('AddPortMapping', WAN, { NewPortMappingDescription: 'a<b' }), /<NewPortMappingDescription>a&lt;b<\/NewPortMappingDescription>/);
});

test('hosting opens UDP 54210 to this PC and closing removes it', async () => {
  const r = await fakeRouter();
  try {
    const m = upnp.create({ location: r.location });
    const mapped = await m.open(54210);
    assert.equal(mapped.localAddress, '127.0.0.1');
    const add = r.calls.find((c) => c.action === 'AddPortMapping');
    assert.deepEqual({ url: add.url, port: add.port, protocol: add.protocol, client: add.client, lease: add.lease, description: add.description },
      { url: '/ctl/IPConn', port: '54210', protocol: 'UDP', client: '127.0.0.1', lease: '3600', description: upnp.DESCRIPTION });
    assert.equal(await m.close(), true);
    assert.equal(r.calls.at(-1).action, 'DeletePortMapping');
    assert.equal(await m.close(), false, 'nothing left to remove');
  } finally { r.server.close(); }
});

test('a port another PC already uses is left alone', async () => {
  const r = await fakeRouter({ existingClient: '192.168.1.77' });
  try {
    await assert.rejects(upnp.create({ location: r.location }).open(54210), /another device \(192\.168\.1\.77\)/);
    assert.ok(!r.calls.some((c) => c.action === 'AddPortMapping'));
  } finally { r.server.close(); }
});

test('routers that only take permanent mappings still get one', async () => {
  const r = await fakeRouter({ onlyPermanent: true });
  try {
    await upnp.create({ location: r.location }).open(54210);
    assert.deepEqual(r.calls.filter((c) => c.action === 'AddPortMapping').map((c) => c.lease), ['3600', '0']);
  } finally { r.server.close(); }
});

test('the usual router addresses of home networks are asked directly', () => {
  const nets = { Ethernet: [{ family: 'IPv4', address: '192.168.0.37', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], Public: [{ family: 'IPv4', address: '8.8.4.4', internal: false }],
    WSL: [{ family: 'IPv4', address: '172.30.176.1', internal: false }] };
  assert.deepEqual(upnp.likelyRouters(nets), ['192.168.0.1', '192.168.0.254', '172.30.176.1', '172.30.176.254']);
  assert.deepEqual(upnp.likelyRouters({ x: [{ family: 'IPv4', address: '1921.168.0.5', internal: false }, { family: 'IPv4', address: '172.32.0.5', internal: false }] }), []);
});

test('a router behind another router or modem is reported (double NAT)', async () => {
  const http2 = require('http');
  const server = http2.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method === 'GET') { res.writeHead(200); return res.end(DESC); }
      const action = (req.headers.soapaction || '').replace(/"/g, '').split('#')[1];
      if (action === 'GetSpecificPortMappingEntry') { res.writeHead(500); return res.end('<errorCode>714</errorCode>'); }
      if (action === 'GetExternalIPAddress') { res.writeHead(200); return res.end('<s:Envelope><s:Body><u:R><NewExternalIPAddress>192.168.1.1</NewExternalIPAddress></u:R></s:Body></s:Envelope>'); }
      res.writeHead(200); res.end('<s:Envelope><s:Body/></s:Envelope>');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const m = await upnp.create({ location: `http://127.0.0.1:${server.address().port}/desc.xml` }).open(54210);
    assert.deepEqual([m.externalIp, m.doubleNat], ['192.168.1.1', true]);
  } finally { server.close(); }
});
