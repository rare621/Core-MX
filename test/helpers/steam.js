// A stand-in for Steam's OpenID sign-in, for service tests. Start it, pass `--steamopenid <url>` to
// the service, then signIn() does what the app and the browser do: start, "sign in at Steam", follow
// the page's mxbm://signin link, and poll for the token.
const http = require('node:http');

async function fakeSteam({ valid = true } = {}) {
  const checks = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      checks.push(Object.fromEntries(new URLSearchParams(body)));
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid ? 'true' : 'false'}\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/openid/login`, checks, close: () => new Promise((resolve) => server.close(resolve)) };
}

// What Steam's sign-in page sends the browser back with, for this Steam ID.
function steamAnswer(loginUrl, steamId) {
  const asked = new URL(loginUrl).searchParams;
  const claimed = `https://steamcommunity.com/openid/id/${steamId}`;
  const back = new URL(asked.get('openid.return_to'));
  for (const [k, v] of Object.entries({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': claimed, 'openid.identity': claimed, 'openid.return_to': asked.get('openid.return_to'), 'openid.response_nonce': `${new Date().toISOString()}abc`,
    'openid.assoc_handle': '1234567890', 'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'c2lnbmF0dXJl' })) back.searchParams.set(k, v);
  return back.toString();
}

// Full sign-in for steamId. Returns { token, id, name, page, link }.
async function signIn(base, steamId, { name = steamId, expect = steamId, as = steamId } = {}) {
  const post = async (route, body) => { const r = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  const start = (await post('/v1/auth/steam/start', { steamId: expect, name })).data;
  const before = (await post('/v1/auth/steam/poll', { state: start.state, secret: start.secret })).data;
  const back = await fetch(steamAnswer(start.url, as));
  const page = await back.text();
  const link = page.match(/mxbm:\/\/signin\/([a-f0-9]{32})\/([a-f0-9]{32})/);
  const withoutCode = (await post('/v1/auth/steam/poll', { state: start.state, secret: start.secret })).data;
  const done = link ? (await post('/v1/auth/steam/poll', { state: start.state, secret: start.secret, code: link[2] })) : null;
  return { ...(done?.data || {}), status: back.status, page, link: link?.[0] || null, before, withoutCode, start, final: done };
}

module.exports = { fakeSteam, steamAnswer, signIn };
