const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('livery brand chips read the public archive and resolve its post IDs across pages', async () => {
  const urls = [];
  const posts = [
    { id: 1, title: { rendered: 'Factory paint' }, categories: [37], link: 'https://mxb-mods.com/factory-paint/' },
    { id: 2, title: { rendered: 'Second paint' }, categories: [37], link: 'https://mxb-mods.com/second-paint/' },
    { id: 3, title: { rendered: 'Third paint' }, categories: [37], link: 'https://mxb-mods.com/third-paint/' },
  ];
  const fetch = async (url) => {
    const u = new URL(url); urls.push(u);
    if (u.pathname.endsWith('/categories')) return new Response(JSON.stringify([{ id: 37, name: 'Liveries', slug: 'liveries', parent: 0 }]));
    if (u.pathname.endsWith('/manufacturer/yamaha/')) return new Response('<head><link rel="next" href="/manufacturer/yamaha/page/2/"></head><div id="posts"><a class="post" id="post-2"></a><a class="post" id="post-1"></a></div>');
    if (u.pathname.endsWith('/manufacturer/yamaha/page/2/')) return new Response('<div id="posts"><a class="post" id="post-3"></a></div>');
    if (u.pathname.endsWith('/posts')) return new Response(JSON.stringify(posts.filter((p) => u.searchParams.get('include').split(',').includes(String(p.id))).reverse()), { headers: { 'x-wp-total': '3' } });
    throw new Error('Unexpected URL: ' + url);
  };
  const module = { exports: {} }, context = vm.createContext({ module, exports: module.exports, URL, URLSearchParams, AbortSignal, Response, setTimeout, clearTimeout, require: (name) => name === 'electron' ? { net: { fetch } } : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/site.js'), 'utf8'), context);
  const first = await module.exports.search({ tab: 'liveries', brand: 'Yamaha', scope: 'free', orderby: 'date', perPage: 1 });
  assert.deepEqual(Array.from(first.posts, (p) => p.id), [2, 1]);
  assert.equal(first.totalPages, 2);
  const second = await module.exports.search({ tab: 'liveries', brand: 'Yamaha', scope: 'free', page: 2, cursor: first.nextCursor, perPage: 1 });
  assert.deepEqual(Array.from(second.posts, (p) => p.id), [3]);
  assert.equal(second.totalPages, 2);
  assert.ok(urls.some((u) => u.pathname === '/manufacturer/yamaha/page/2/'));
});

test('popular browsing keeps the website rank instead of silently showing newest', async () => {
  const calls = [];
  const rows = [
    { id: 1, slug: 'older-hit', title: { rendered: 'Older hit' }, categories: [22], date: '2024-01-01', link: 'https://mxb-mods.com/older-hit/' },
    { id: 2, slug: 'weekly-hit', title: { rendered: 'Weekly hit' }, categories: [22], date: '2025-01-01', link: 'https://mxb-mods.com/weekly-hit/' },
    { id: 3, slug: 'newest', title: { rendered: 'Newest' }, categories: [22], date: '2026-01-01', views: '1,234', link: 'https://mxb-mods.com/newest/' },
  ];
  const cards = (slugs) => `<ol>${slugs.map((slug, index) => `<li class="dmpop-card"><a class="dmpop-title" href="https://mxb-mods.com/${slug}/">${slug}</a><span class="dmpop-views">${100 - index} views</span></li>`).join('')}</ol>`;
  const fetch = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (u.pathname.includes('/categories')) return new Response(JSON.stringify([{ id: 22, name: 'Tracks' }]));
    if (u.pathname.startsWith('/popular-')) return new Response(cards(u.pathname === '/popular-last-7-days/' ? ['weekly-hit', 'older-hit'] : ['older-hit', 'weekly-hit']));
    if (u.pathname.includes('/pages')) return new Response(JSON.stringify([{ content: { rendered: cards(u.searchParams.get('slug') === 'popular-last-7-days' ? ['weekly-hit', 'older-hit'] : ['older-hit', 'weekly-hit']) } }]));
    if (u.searchParams.has('slug')) return new Response(JSON.stringify(rows.filter(p => u.searchParams.get('slug').split(',').includes(p.slug)).reverse()));
    return new Response(JSON.stringify(rows.slice().reverse().filter(p => !u.searchParams.get('exclude')?.split(',').includes(String(p.id)))), { headers: { 'x-wp-total': '3' } });
  };
  const module = { exports: {} }, context = vm.createContext({ module, exports: module.exports, URL, URLSearchParams, AbortSignal, Response, setTimeout, clearTimeout, require: (name) => name === 'electron' ? { net: { fetch } } : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/site.js'), 'utf8'), context);
  const site = module.exports;
  const week = await site.search({ tab: 'tracks', scope: 'free', perPage: 3, orderby: 'popular-week' });
  const month = await site.search({ tab: 'tracks', scope: 'free', perPage: 3, orderby: 'popular-month' });
  assert.deepEqual(Array.from(week.posts, p => p.id), [2, 1]);
  assert.deepEqual(Array.from(month.posts, p => p.id), [1, 2]);
  assert.deepEqual(Array.from(week.posts, p => p.rank), [1, 2]);
  assert.deepEqual(Array.from(week.posts, p => p.views), [100, 99]);
  assert.equal(calls.some(pathname => pathname.includes('/pages')), false);
  const best = await site.search({ tab: 'tracks', scope: 'free', perPage: 3, orderby: 'relevance' });
  assert.deepEqual(Array.from(best.posts, p => p.id), [1, 2, 3]);
  const newest = await site.search({ tab: 'tracks', scope: 'all', perPage: 3, orderby: 'date' });
  assert.equal(newest.posts[0].views, 1234);
});

test('Best match finds add-ons even when the global popular list has none in that category', async () => {
  const boot = { id: 7, slug: 'boot-paint', title: { rendered: 'Boot paint' }, categories: [126], link: 'https://mxb-mods.com/boot-paint/' };
  const fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/categories')) return new Response(JSON.stringify([{ id: 22, name: 'Tracks' }, { id: 126, name: 'Boot Paints' }]));
    if (u.pathname.startsWith('/popular-')) return new Response('Ranking unavailable', { status: 503 });
    if (u.pathname.includes('/pages')) return new Response(JSON.stringify([]));
    if (u.searchParams.has('slug')) return new Response(JSON.stringify([{ id: 1, slug: 'track', title: { rendered: 'Track' }, categories: [22] }]));
    return new Response(JSON.stringify([boot]), { headers: { 'x-wp-total': '1' } });
  };
  const module = { exports: {} }, context = vm.createContext({ module, exports: module.exports, URL, URLSearchParams, AbortSignal, Response, setTimeout, clearTimeout, require: (name) => name === 'electron' ? { net: { fetch } } : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/site.js'), 'utf8'), context);
  const result = await module.exports.search({ tab: 'boots', scope: 'addons', perPage: 30, orderby: 'relevance' });
  assert.deepEqual(Array.from(result.posts, p => p.id), [7]);
});
test('helmet subfilters use the website model, paint and add-on categories', async () => {
  const rows = [
    { id: 1, title: { rendered: 'Model' }, categories: [313], link: 'https://mxb-mods.com/model/' },
    { id: 2, title: { rendered: 'Paint' }, categories: [127], link: 'https://mxb-mods.com/paint/' },
    { id: 3, title: { rendered: 'Add-on' }, categories: [34], link: 'https://mxb-mods.com/addon/' },
  ];
  const fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/categories')) return new Response(JSON.stringify([
      { id: 33, name: 'Helmets', parent: 0 },
      { id: 313, name: 'Helmet Models', parent: 33 },
      { id: 127, name: 'Helmet Paints', parent: 33 },
      { id: 34, name: 'Helmet Addons', parent: 33 },
    ]));
    if (u.pathname.includes('/posts')) {
      const ids = (u.searchParams.get('categories') || '').split(',').map(Number);
      const selected = rows.filter((p) => ids.includes(p.categories[0]) || ids.includes(33));
      return new Response(JSON.stringify(selected), { headers: { 'x-wp-total': String(selected.length) } });
    }
    throw new Error('Unexpected URL: ' + url);
  };
  const module = { exports: {} }, context = vm.createContext({ module, exports: module.exports, URL, URLSearchParams, AbortSignal, Response, setTimeout, clearTimeout, require: (name) => name === 'electron' ? { net: { fetch } } : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/site.js'), 'utf8'), context);
  for (const [kind, expected] of [['all', [1, 2, 3]], ['models', [1]], ['paints', [2]], ['addons', [3]]]) {
    const result = await module.exports.search({ tab: 'helmets', kind, scope: 'free', perPage: 30, orderby: 'date' });
    assert.deepEqual(Array.from(result.posts, (p) => p.id), expected);
  }
});
test('filtered browsing mixes stock kits and add-ons while advancing raw cursors without skipping matches', async () => {
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
  assert.deepEqual(Array.from(main.posts, (p) => p.id), [1,2]); assert.equal(main.nextCursor.offset, 2);
  const next = await site.search({ tab: 'riderkit', scope: 'free', perPage: 2, orderby: 'date', page: 2, cursor: main.nextCursor }); assert.deepEqual(Array.from(next.posts, (p) => p.id), [3,4]);
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
  const explicit = module.exports.listingRequirements('<html><body><nav><a href="https://mxb-mods.com/category/boots/">Boot Models</a></nav><section class="nd-desc"><p>Requires a different guessed model.</p></section><div class="stuff"><div id="dependencies"><h3>Mod dependencies</h3><p>This mod by insane is needed:</p><a href="https://mxb-mods.com/2021-6d-atr-2/"><div><p><b>2021 6D ATR-2</b></p></div></a></div></div></body></html>');
  assert.deepEqual(JSON.parse(JSON.stringify(explicit.dependencies)), [{ label: '2021 6D ATR-2', url: 'https://mxb-mods.com/2021-6d-atr-2/', declared: true }]);
  const shopDependency = module.exports.listingRequirements('<p>Replica FXR 4 Paint Pack for the LC Creations <a href="https://mxbikes-shop.com/downloads/6-helmet/">6D Helmet</a>, available on the shop.</p>');
  assert.equal(shopDependency.dependencies[0].url, 'https://mxbikes-shop.com/downloads/6-helmet/');
  assert.equal(module.exports.shopProduct(shopDependency.dependencies[0].url).shop, 'mxbs');
  assert.equal(module.exports.shopProduct('https://mxbikes-shop.com.attacker.test/downloads/6-helmet/'), null);
  assert.equal(module.exports.shopProduct('https://mxbikes-shop.com/checkout/'), null);
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
  const generic = '<div id="instructions">Put PNT files in mods/rider/riders/*rider model*/paints.</div>';
  const unknown = module.exports.listingRequirements(generic, '', { title: 'Hoodie crt', categories: [35] });
  assert.equal(unknown.needsModelNotice, true);
  assert.equal(unknown.dependencies[0].unidentified, true);
  assert.equal(unknown.dependencies[0].url, '');
  const stock = module.exports.listingRequirements(generic, '', { title: 'Royal Polar', categories: [35] });
  assert.equal(stock.needsModelNotice, false);
});
