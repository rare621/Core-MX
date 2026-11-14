const { test } = require('node:test');
const assert = require('node:assert/strict');
const shops = require('../src/lib/shops');
function session(fetch) { return { fetch, cookies: { get: async () => [{ name: 'wordpress_logged_in_test', value: 'test-user%7Csession' }] } }; }
test('purchases use the downloads page without fetching every receipt, and cache repeat visits', async () => {
  let requests = 0;
  const ses = session(async () => {
    requests++;
    return new Response('<body class="logged-in"><h3>Test track</h3><div><strong>Test track</strong><a href="/?eddfile=123:sample:0">track.zip</a></div><a href="/?payment_key=receipt">Receipt</a></body>');
  });
  const first = await shops.owned(ses, 'mxbs');
  assert.equal(first.items.length, 1); assert.equal(first.items[0].productId, 123);
  assert.equal(requests, 2);
  await shops.owned(ses, 'mxbs'); assert.equal(requests, 2);
  await shops.owned(ses, 'mxbs', true); assert.equal(requests, 4);
});
test('product details include page descriptions when catalog metadata is empty', async () => {
  const ses = session(async () => new Response('<meta property="og:image" content="https://mxbikes-shop.com/preview.jpg"><h1>Test product</h1><article><div class="entry-content"><p>Actual store description.</p><script>bad()</script></div></article><span class="edd_price">$12.00</span>'));
  const result = await shops.details(ses, 'mxbs', 'https://mxbikes-shop.com/downloads/unit-test-product/');
  assert.match(result.description, /Actual store description/);
  assert.doesNotMatch(result.description, /<script\b/);
  assert.equal(result.price, 12); assert.equal(result.images[0], 'https://mxbikes-shop.com/preview.jpg');
});
test('HTTP errors are not cached as empty product details', async () => {
  let calls = 0;
  const ses = session(async () => ++calls === 1 ? new Response('Unavailable', { status: 503 }) : new Response('<h1>Recovered</h1><div class="entry-content"><p>Recovered description</p></div>'));
  const link = 'https://mxbikes-shop.com/downloads/unit-test-retry/';
  await assert.rejects(shops.details(ses, 'mxbs', link), /503/);
  assert.match((await shops.details(ses, 'mxbs', link)).description, /Recovered/);
});
test('purchase metadata enrichment has bounded concurrency', async () => {
  let active = 0, maximum = 0;
  const ses = session(async (url) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    const id = Number(url.match(/edd-downloads\/(\d+)/)[1]);
    return new Response(JSON.stringify({ id, title: { rendered: 'Product ' + id }, link: 'https://mxbikes-shop.com/downloads/product-' + id, content: { rendered: '<p>Details</p>' } }), { headers: { 'content-type': 'application/json' } });
  });
  const result = await shops.lookup(ses, 'mxbs', Array.from({ length: 10 }, (_, i) => ({ key: String(i), productId: 900000 + i })));
  assert.equal(Object.keys(result).length, 10); assert.ok(maximum <= 4);
});
