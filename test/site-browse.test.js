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

test('creator install paths override broad website tags when filtering gear tabs', async () => {
  const raw = { id: 9, title: { rendered: 'Royal Polar' }, categories: [31, 32, 35], content: { rendered: '' }, excerpt: { rendered: '' }, link: 'https://mxb-mods.com/royal-polar/' };
  const fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/categories')) return new Response(JSON.stringify([{ id: 31, name: 'Boots' }, { id: 32, name: 'Gloves' }, { id: 35, name: 'Rider Kit' }]));
    if (u.pathname.includes('/posts')) return new Response(JSON.stringify([raw]), { headers: { 'x-wp-total': '1' } });
    return new Response('<div id="instructions">Put the PNT file(s) in mods/rider/riders/*rider model*/paints folder.</div>');
  };
  const module = { exports: {} }, context = vm.createContext({ module, exports: module.exports, URL, URLSearchParams, AbortSignal, Response, setTimeout, clearTimeout, require: (name) => name === 'electron' ? { net: { fetch } } : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/site.js'), 'utf8'), context);
  const site = module.exports;
  const boots = await site.search({ tab: 'boots', scope: 'free', perPage: 20, orderby: 'date' });
  const kits = await site.search({ tab: 'riderkit', scope: 'free', perPage: 20, orderby: 'date' });
  assert.equal(boots.posts.length, 0);
  assert.equal(kits.posts.length, 1);
  assert.equal(kits.posts[0].contentKind, 'riderkit');
});

test('plain-text base model requirements are retained for add-on checks', () => {
  const sitePath = path.join(__dirname, '../src/lib/site.js');
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, URL, URLSearchParams, AbortSignal, Response, setTimeout, clearTimeout, require: (name) => name === 'electron' ? { net: { fetch: async () => new Response('') } } : require(name) });
  vm.runInContext(fs.readFileSync(sitePath, 'utf8'), context);
  const result = module.exports.listingRequirements('<p>2026 Fox MXoN Boot Pack made to work on the Aeffertz Fox Instinct 2.0 FREE on MXBMods.</p>');
  assert.equal(result.needsModelNotice, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.dependencies)), [{ label: 'Aeffertz Fox Instinct 2.0 FREE', url: '', inferred: true }]);
  const hoodie = module.exports.listingRequirements('<html><body><nav><a href="https://mxb-mods.com/category/boots/">Boot Models</a></nav><p>Unrelated sidebar requires a model</p></body></html>', '<p>You need this hoodie model: <a href="https://mxbikes-shop.com/downloads/rider-hoodie-abdesigns/">ABDesigns Hoodie</a></p>');
  assert.equal(hoodie.dependencies.length, 1);
  assert.equal(hoodie.dependencies[0].label, 'ABDesigns Hoodie');
  const fullPage = '<html><body><nav><a href="https://mxb-mods.com/category/rider-models/">Rider models</a></nav><div class="entry-content"><section class="nd-desc"><p>Hoodie model: https://mxbikes-shop.com/downloads/rider-hoodie-abdesigns/ You need it for the paint!</p></section><div class="stuff"><p>Needs 10 more recommendations!</p><a href="https://mxb-mods.com/login/">Log in to get this model</a></div></div></body></html>';
  const listing = module.exports.listingRequirements(fullPage);
  assert.equal(listing.needsModelNotice, true);
  assert.equal(listing.dependencies.length, 1);
  assert.match(listing.dependencies[0].url, /rider-hoodie-abdesigns/);
});
