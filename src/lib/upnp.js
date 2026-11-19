// UPnP port mapping for Host World. A home router often keeps the game's outside port but drops
// connections from players it has not seen yet (MX Bikes' own World list gets around that through
// the master server; a direct join cannot). While the player hosts, CoreMX asks the router (UPnP
// Internet Gateway Device) to forward UDP 54210 to this PC, with a lease it renews, and removes
// the mapping when hosting stops. Nothing is changed if another PC already has that port.
const dgram = require('dgram');
const http = require('http');

const SSDP_ADDR = '239.255.255.250', SSDP_PORT = 1900;
// Some routers answer only the general searches (seen: one that ignored the IGD search but answered ssdp:all).
const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'upnp:rootdevice', 'ssdp:all'];
const IGD_ST = /InternetGatewayDevice|WAN(IP|PPP)Connection/i;
const SERVICE_TYPES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];
const DESCRIPTION = 'CoreMX hosting';

// The LOCATION header of an SSDP answer.
function parseSsdp(text) {
  const m = String(text || '').match(/^location:\s*(\S+)\s*$/im);
  return m && /^http:\/\//i.test(m[1]) ? m[1] : null;
}

// The WAN connection service (type and absolute control URL) in a device description.
function parseDescription(xml, location) {
  const services = String(xml || '').match(/<service>[\s\S]*?<\/service>/gi) || [];
  for (const type of SERVICE_TYPES) {
    for (const s of services) {
      const t = (s.match(/<serviceType>\s*([^<]+?)\s*<\/serviceType>/i) || [])[1];
      const c = (s.match(/<controlURL>\s*([^<]+?)\s*<\/controlURL>/i) || [])[1];
      if (t === type && c) return { serviceType: type, controlURL: new URL(c, location).href };
    }
  }
  return null;
}

const xmlEscape = (v) => String(v).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
function soapEnvelope(action, serviceType, args) {
  const body = Object.entries(args).map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`).join('');
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body></s:Envelope>`;
}

function request(url, { method = 'GET', headers = {}, body = null, timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 256 * 1024) req.destroy(new Error('Router answer too large')); else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Router did not answer')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function soap(gw, action, args) {
  const body = soapEnvelope(action, gw.serviceType, args);
  const res = await request(gw.controlURL, { method: 'POST', body, headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gw.serviceType}#${action}"`, 'Content-Length': Buffer.byteLength(body) } });
  if (res.status !== 200) {
    const code = (res.text.match(/<errorCode>\s*(\d+)\s*<\/errorCode>/i) || [])[1];
    const desc = (res.text.match(/<errorDescription>\s*([^<]+?)\s*<\/errorDescription>/i) || [])[1];
    const e = new Error(desc ? `Router refused: ${desc}` : `Router answered HTTP ${res.status}`); e.upnpCode = Number(code) || 0; throw e;
  }
  return res.text;
}

// Some routers answer only a search sent straight to them (seen: no answer to the multicast search,
// 14 answers when sent to 192.168.0.1), so the usual router addresses of each home network are asked too.
function likelyRouters(interfaces = require('os').networkInterfaces()) {
  const out = new Set();
  for (const list of Object.values(interfaces)) for (const a of list || []) {
    if (a.family !== 'IPv4' && a.family !== 4 || a.internal || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
    const p = a.address.split('.').slice(0, 3).join('.');
    out.add(p + '.1'); out.add(p + '.254');
  }
  return [...out].slice(0, 8);
}
// Finds devices on the local network (SSDP). Returns their description URLs, router-like first;
// stops early once one says it is an Internet gateway.
function discover(timeout = 2500) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const igd = [], other = [];
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); try { socket.close(); } catch {} resolve([...new Set([...igd, ...other])]); };
    const timer = setTimeout(finish, timeout);
    socket.on('error', finish);
    socket.on('message', (msg) => {
      const text = msg.toString(), location = parseSsdp(text);
      if (!location) return;
      if (IGD_ST.test((text.match(/^(?:st|nt):\s*(.*)$/im) || [])[1] || '')) { igd.push(location); setTimeout(finish, 150); }
      else other.push(location);
    });
    socket.bind(0, () => {
      for (const st of SEARCH_TARGETS) {
        const m = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        for (const dest of [SSDP_ADDR, ...likelyRouters()]) socket.send(m, SSDP_PORT, dest, () => {});
      }
    });
  });
}

// This PC's address on the network the router is on.
function localAddressFor(host) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', (e) => { try { socket.close(); } catch {} reject(e); });
    socket.connect(SSDP_PORT, host, () => { const { address } = socket.address(); socket.close(); resolve(address); });
  });
}

async function gateway(location) {
  const found = location ? [location] : await discover();
  if (!found.length) throw new Error('No UPnP router found (UPnP may be turned off on the router)');
  for (const loc of found.slice(0, 8)) {
    const desc = await request(loc).catch(() => null);
    const gw = desc && parseDescription(desc.text, loc);
    if (gw) return { ...gw, location: loc, localAddress: await localAddressFor(new URL(loc).hostname) };
  }
  throw new Error('The router does not offer port mapping (UPnP may be turned off on the router)');
}

// Creates a mapper. open(port) maps UDP port -> this PC (renewed by calling open again);
// close() removes it. options.location skips discovery (tests).
function create({ location = null, lease = 3600 } = {}) {
  let gw = null, mapped = null;
  async function open(port) {
    gw = gw || await gateway(location);
    // Another PC already has this port: leave its mapping alone.
    try {
      const text = await soap(gw, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'UDP' });
      const client = (text.match(/<NewInternalClient>\s*([^<]+?)\s*<\/NewInternalClient>/i) || [])[1];
      if (client && client !== gw.localAddress) throw Object.assign(new Error(`Port ${port} is already forwarded to another device (${client})`), { taken: true });
    } catch (e) { if (e.taken) throw e; }
    const args = { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'UDP', NewInternalPort: port, NewInternalClient: gw.localAddress, NewEnabled: 1, NewPortMappingDescription: DESCRIPTION, NewLeaseDuration: lease };
    try { await soap(gw, 'AddPortMapping', args); }
    catch (e) {
      // 725: the router only takes permanent mappings; CoreMX removes it when hosting stops.
      if (e.upnpCode === 725) await soap(gw, 'AddPortMapping', { ...args, NewLeaseDuration: 0 });
      else throw e;
    }
    mapped = { port, localAddress: gw.localAddress, at: Date.now() };
    return mapped;
  }
  async function close() {
    if (!mapped || !gw) return false;
    const port = mapped.port; mapped = null;
    await soap(gw, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'UDP' }).catch(() => {});
    return true;
  }
  return { open, close, mapped: () => mapped };
}

module.exports = { create, discover, likelyRouters, parseSsdp, parseDescription, soapEnvelope, DESCRIPTION };
