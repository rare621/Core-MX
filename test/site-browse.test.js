const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('filtered browsing reads separate instructions, keeps stock kits in MXB Mods and advances raw cursors without skipping matches', async () => {
  const calls = [];
  const rows = [1,2,3,4].map((id) => ({ id, title: { rendered: 'Kit ' + id }, categories: [35], content: { rendered: '' }, excerpt: { rendered: '' }, link: `https://mxb-mods.com/kit-${id}/` }));
  const fetch = async (url) => {
    calls.push(String(url)); const u = new URL(url);
    if (u.pathname.includes('/categories')) return new Response(JSON.stringify([{ id: 35, name: 'Rider Kit' }]));
    if (u.pathname.includes('/posts')) return new Response(JSON.stringify(rows.slice(Number(u.searchParams.get('offset') || 0))), { headers: { 'x-wp-total': '4' } });
    const id = Number(u.pathname.match(/kit-(\d+)/)?.[1]);
    return new Response(`<div id="instructions">${id % 2 ? 'Put the paint in rider/riders/default_mx/paints. No additional models are required.' : 'YOU MUST HAVE ABDESIGNS HOODIE FOR THIS MOD TO WORK'}</div>`);
  };
  const module = { exports: {} }, context = vm.createContext({ module, exports: module.exports, URL, URLSearchParams, AbortSignal, Response, setTimeout, clearTimeout, require: (name) => name === 'electron' ? { net: { fetch } } : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/site.js'), 'utf8'), context);
  const site = module.exports;
  const main = await site.search({ tab: 'riderkit', scope: 'free', perPage: 2, orderby: 'date' });
  assert.deepEqual(Array.from(main.posts, (p) => p.id), [1,3]); assert.equal(main.nextCursor.offset, 3);
  const next = await site.search({ tab: 'riderkit', scope: 'free', perPage: 2, orderby: 'date', page: 2, cursor: main.nextCursor }); assert.equal(next.posts.length, 0);
  const addons = await site.search({ tab: 'riderkit', scope: 'addons', perPage: 2, orderby: 'date' });
  assert.deepEqual(Array.from(addons.posts, (p) => p.id), [2,4]); assert.ok(addons.posts.every((p) => p.gearKind === 'paint' && p.needsModelNotice));
  assert.equal(calls.filter((u) => /\/kit-\d+\/$/.test(u)).length, 4); assert.ok(calls.every((u) => !/\.(pnt|zip|pkz)/i.test(u)));
});
