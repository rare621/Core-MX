const { test } = require('node:test');
const assert = require('node:assert/strict');

test('card counts come from coremx.app in one request and are cached', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ stats: { 101: { siteDownloads: 22, downloads: 22, views: 0 }, 102: { siteDownloads: null, downloads: 0, views: 3 } } }) };
  };
  delete require.cache[require.resolve('../src/lib/coremx')];
  const { stats } = require('../src/lib/coremx');
  const first = await stats([101, 102, 103, 'x', -4, 101]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/stats\?mxbmods=101,102,103$/);
  assert.equal(first[101].siteDownloads, 22);
  assert.equal(first[102].siteDownloads, null);
  assert.equal(first[103], null);
  await stats([101, 102]);
  assert.equal(calls.length, 1, 'second lookup is served from the cache');
});
