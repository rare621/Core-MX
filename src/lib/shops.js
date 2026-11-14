// Paid-mod shops: MXB Hub (WooCommerce) and MX Bikes Shop (Easy Digital Downloads).
// Browsing uses each site's public WordPress feeds. "My purchases" reads the signed-in
// account pages using the app's own browser session (the user signs in on the shop's page).
const cheerio = require('cheerio');
const { UA } = require('./site');

const SHOPS = {
  hub: {
    id: 'hub', name: 'MXB Hub', url: 'https://shop.mxb-hub.com', domain: 'mxb-hub.com',
    loginUrl: 'https://shop.mxb-hub.com/my-account/',
    ownedPages: ['https://shop.mxb-hub.com/my-account/downloads/'],
    platform: 'woo',
  },
  mxbs: {
    id: 'mxbs', name: 'MX Bikes Shop', url: 'https://mxbikes-shop.com', domain: 'mxbikes-shop.com',
    loginUrl: 'https://mxbikes-shop.com/wp-login.php?redirect_to=https%3A%2F%2Fmxbikes-shop.com%2Fall-my-downloads%2F',
    ownedPages: ['https://mxbikes-shop.com/all-my-downloads/', 'https://mxbikes-shop.com/checkout/purchase-history/'],
    platform: 'edd',
    // top-level browse categories (edd-categories ids)
    cats: [{ id: 0, label: 'All' }, { id: 248, label: 'Tracks' }, { id: 521, label: 'Bikes' }, { id: 255, label: 'Paints' }, { id: 257, label: 'Rider paints' }, { id: 539, label: 'Rider gear models' }, { id: 328, label: 'Season passes' }, { id: 1457, label: 'KRP mods' }],
  },
};

const text = (html) => cheerio.load(`<div>${html || ''}</div>`)('div').text().replace(/\s+/g, ' ').trim();
const purchasesCache = new WeakMap(), purchasesPending = new WeakMap();
const lookupCache = new Map();
async function fetchPage(ses, url, accept = 'text/html') {
  const response = await ses.fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Shop returned HTTP ${response.status}`);
  return response;
}
async function pool(items, count, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await fn(items[i]);
  }));
}

async function getJson(ses, url) {
  const res = await fetchPage(ses, url, 'application/json');
  return { json: await res.json(), headers: res.headers };
}

let hubCats = null;
async function categories(ses, shopId) {
  const shop = SHOPS[shopId];
  if (shop.cats) return shop.cats;
  if (!hubCats) {
    const { json } = await getJson(ses, `${shop.url}/wp-json/wc/store/v1/products/categories?per_page=100`);
    hubCats = [{ id: 0, label: 'All' }, ...json.filter((c) => c.parent === 0 && c.count > 0)
      .sort((a, b) => b.count - a.count).map((c) => ({ id: c.id, label: text(c.name) }))];
  }
  return hubCats;
}

function hubProduct(p) {
  const minor = p.prices ? p.prices.currency_minor_unit || 0 : 0;
  const price = p.prices && p.prices.price != null ? Number(p.prices.price) / 10 ** minor : null;
  const creatorCat = (p.categories || []).find((c) => /\/creators\//.test(c.link || ''));
  return {
    shop: 'hub', id: p.id, title: text(p.name), link: p.permalink,
    image: p.images && p.images[0] ? (p.images[0].thumbnail || p.images[0].src) : null,
    images: (p.images || []).map((i) => i.src),
    price, currency: p.prices ? p.prices.currency_prefix || '$' : '$',
    free: price === 0,
    creator: creatorCat ? text(creatorCat.name) : null,
    categories: (p.categories || []).map((c) => text(c.name)),
    summary: text(p.short_description || p.description).slice(0, 220),
    description: p.description || '',
  };
}

function mediaUrl(m, prefs = ['medium_large', 'large', 'medium', 'full']) {
  if (!m) return null;
  const s = (m.media_details && m.media_details.sizes) || {};
  for (const k of prefs) if (s[k]) return s[k].source_url;
  return m.source_url || null;
}

function eddProduct(p) {
  const m = p._embedded && p._embedded['wp:featuredmedia'] && p._embedded['wp:featuredmedia'][0];
  return {
    shop: 'mxbs', id: p.id, title: text(p.title && p.title.rendered), link: p.link,
    image: mediaUrl(m), images: [], price: null, currency: '$', creator: null,
    categoryIds: p['edd-categories'] || [], categories: [],
    summary: text(p.excerpt && p.excerpt.rendered).slice(0, 220),
    description: (p.content && p.content.rendered) || '',
    date: p.date,
  };
}

async function search(ses, { shop: shopId, query = '', cat = 0, page = 1, sort = 'date' }) {
  const shop = SHOPS[shopId];
  if (shop.platform === 'woo') {
    const q = new URLSearchParams({ per_page: '24', page: String(page) });
    if (query) q.set('search', query);
    if (cat) q.set('category', String(cat));
    if (sort === 'price') { q.set('orderby', 'price'); q.set('order', 'asc'); }
    else if (sort === 'popularity') q.set('orderby', 'popularity');
    else { q.set('orderby', 'date'); q.set('order', 'desc'); }
    const { json, headers } = await getJson(ses, `${shop.url}/wp-json/wc/store/v1/products?${q}`);
    return { products: json.map(hubProduct), total: Number(headers.get('x-wp-total') || 0), totalPages: Number(headers.get('x-wp-totalpages') || 1), page };
  }
  const q = new URLSearchParams({ per_page: '24', page: String(page), _embed: 'wp:featuredmedia', _fields: 'id,title,link,excerpt,content,date,edd-categories,_links,_embedded' });
  if (query) q.set('search', query);
  if (cat) q.set('edd-categories', String(cat));
  if (sort === 'title') { q.set('orderby', 'title'); q.set('order', 'asc'); }
  const { json, headers } = await getJson(ses, `${shop.url}/wp-json/wp/v2/edd-downloads?${q}`);
  return { products: json.map(eddProduct), total: Number(headers.get('x-wp-total') || 0), totalPages: Number(headers.get('x-wp-totalpages') || 1), page };
}

// Product page details that the feeds don't include (price, creator, gallery for EDD).
const detailCache = new Map();
async function details(ses, shopId, link) {
  const cached = detailCache.get(link);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value;
  const res = await fetchPage(ses, link);
  const html = await res.text();
  const $ = cheerio.load(html);
  const out = { images: [] };
  out.title = $('.product_title, h1.entry-title, h1.edd_download_title, h1').first().text().trim();
  const description = $('.woocommerce-Tabs-panel--description, .edd_download_content, .edd-download-content, .elementor-widget-theme-post-content, article .entry-content, .entry-content').first().clone();
  description.find('script,style,form,nav,.related,.related-products').remove();
  out.description = description.html() || $('meta[property="og:description"],meta[name="description"]').first().attr('content') || '';
  const hero = $('meta[property="og:image"]').attr('content');
  if (hero) { try { out.images.push(new URL(hero, link).href); } catch {} }
  if (shopId === 'mxbs') {
    const dp = $('[data-price]').first().attr('data-price');
    const pt = $('.edd_price').first().text().trim();
    out.price = dp != null ? Number(dp) : pt ? Number(pt.replace(/[^0-9.]/g, '')) : null;
    out.creator = $('a[href*="/creator/"]').filter((_, a) => $(a).text().trim()).first().text().trim() || null;
  } else {
    out.creator = null;
  }
  $('img').each((_, el) => {
    const src = $(el).attr('data-large_image') || $(el).attr('data-src') || $(el).attr('src');
    if (src && /wp-content\/uploads/.test(src) && !/avatar|logo|icon|-\d{2,3}x\d{2,3}\./i.test(src) && !out.images.includes(src)) { try { out.images.push(new URL(src, link).href); } catch {} }
  });
  out.images = out.images.slice(0, 16);
  detailCache.set(link, { at: Date.now(), value: out });
  if (detailCache.size > 400) detailCache.delete(detailCache.keys().next().value);
  return out;
}

// ---------- accounts ----------
async function account(ses, shopId) {
  const shop = SHOPS[shopId];
  const cookies = await ses.cookies.get({ domain: shop.domain });
  const c = cookies.find((x) => x.name.startsWith('wordpress_logged_in_'));
  if (!c) return { signedIn: false };
  const user = decodeURIComponent(c.value).split('|')[0];
  return { signedIn: true, user };
}

async function signOut(ses, shopId) {
  purchasesCache.delete(ses); purchasesPending.delete(ses);
  const shop = SHOPS[shopId];
  const cookies = await ses.cookies.get({ domain: shop.domain });
  for (const c of cookies) {
    const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
    await ses.cookies.remove(url, c.name).catch(() => {});
  }
}

// Collect download links from the signed-in account pages.
function parseOwned($, base) {
  const items = [];
  const seen = new Set();
  const add = (title, url, file, product) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    let productUrl = null;
    try { productUrl = product ? new URL(product, base).toString() : null; } catch {}
    let download;
    try { download = new URL(url, base); } catch { return; }
    const productId = Number((download.searchParams.get('eddfile') || '').split(':')[0]) || null;
    items.push({ title: (title || file || 'Download').replace(/\s+/g, ' ').trim(), url: download.toString(), file: (file || '').trim(), product: productUrl, productId });
  };
  const productLink = ($row) => $row.find('a[href*="/downloads/"], a[href*="/product/"]').filter((_, a) => !/eddfile=|download_file=|edd_action=/.test($(a).attr('href'))).first().attr('href') || null;
  // WooCommerce downloads table
  $('table.woocommerce-table--order-downloads tr, table.woocommerce-MyAccount-downloads tr').each((_, tr) => {
    const $tr = $(tr);
    const a = $tr.find('a.woocommerce-MyAccount-downloads-file, td.download-file a').first();
    if (a.length) add($tr.find('td.download-product').text() || $tr.find('a').first().text(), a.attr('href'), a.text(), productLink($tr));
  });
  // Anything that looks like a protected download link (EDD / Woo / direct archives)
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!/eddfile=|edd_action=download|download_file=|[?&]edd-dl=|\.(pkz|zip|rar|7z)(\?|$)/i.test(href)) return;
    const $row = $(el).closest('tr, li, .edd_download, .download-item, .product, article, .card, div');
    const title = $row.find('h1,h2,h3,h4,h5,.edd_purchase_receipt_product_name,.download-title,strong').first().text() || $row.text().slice(0, 80);
    add(title, href, $(el).text(), productLink($row));
  });
  return items;
}

async function owned(ses, shopId, force = false) {
  const shop = SHOPS[shopId];
  const acct = await account(ses, shopId);
  if (!acct.signedIn) return { signedIn: false, items: [] };
  const cacheKey = shopId + ':' + acct.user;
  if (!purchasesCache.has(ses)) purchasesCache.set(ses, new Map());
  if (!purchasesPending.has(ses)) purchasesPending.set(ses, new Map());
  const cache = purchasesCache.get(ses), pending = purchasesPending.get(ses), cached = cache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < 120000) return cached.value;
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  const request = (async () => {
  const items = [];
  const receipts = new Set();
  let succeeded = 0, expired = false;
  await pool(shop.ownedPages, 2, async (page) => {
    try {
    const res = await fetchPage(ses, page);
    const html = await res.text();
    const $ = cheerio.load(html);
    const found = parseOwned($, page);
    if (!found.length && $('form#loginform, form.woocommerce-form-login').length && !/logged-in/.test(html)) { expired = true; return; }
    succeeded++;
    items.push(...found);
    $('a[href*="payment_key="], a[href*="view-order"]').each((_, a) => receipts.add(new URL($(a).attr('href'), page).toString()));
    } catch { /* another account page may still provide the downloads */ }
  });
  if (!succeeded) {
    if (expired) return { signedIn: false, expired: true, items: [] };
    throw new Error('The shop did not respond. Try Refresh, or open your account on the shop.');
  }
  // EDD purchase history lists orders; files are on each receipt.
  // Do not fetch every receipt when the downloads page already lists the files.
  if (!items.length) await pool([...receipts].slice(0, 40), 4, async (r) => {
    try {
      const html = await (await fetchPage(ses, r)).text();
      items.push(...parseOwned(cheerio.load(html), r));
    } catch {}
  });
  const uniq = [];
  const seen = new Set();
  for (const it of items) if (!seen.has(it.url)) { seen.add(it.url); uniq.push(it); }
  const value = { signedIn: true, user: acct.user, items: uniq };
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
  })();
  pending.set(cacheKey, request);
  try { return await request; } finally { pending.delete(cacheKey); }
}

// Product info for purchase links (by slug), or a title search when there's no link.
async function lookup(ses, shopId, items) {
  const shop = SHOPS[shopId];
  const out = {};
  const slugOf = (u) => { try { return new URL(u).pathname.split('/').filter(Boolean).pop(); } catch { return null; } };
  await pool(items, 4, async (it) => {
    try {
      const cacheKey = shopId + ':' + (it.product || it.productId || it.title);
      const cached = lookupCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) { out[it.key] = cached.value; return; }
      const slug = it.product && slugOf(it.product);
      let prods = [];
      if (shop.platform === 'woo') {
        const q = slug ? `slug=${encodeURIComponent(slug)}` : `search=${encodeURIComponent(it.title)}&per_page=1`;
        prods = (await getJson(ses, `${shop.url}/wp-json/wc/store/v1/products?${q}`)).json.map(hubProduct);
      } else {
        const q = slug ? `slug=${encodeURIComponent(slug)}` : `search=${encodeURIComponent(it.title)}&per_page=1`;
        const endpoint = it.productId ? `${shop.url}/wp-json/wp/v2/edd-downloads/${it.productId}?` : `${shop.url}/wp-json/wp/v2/edd-downloads?${q}&`;
        const result = (await getJson(ses, `${endpoint}_embed=wp:featuredmedia&_fields=id,title,link,excerpt,content,date,edd-categories,_links,_embedded`)).json;
        prods = (Array.isArray(result) ? result : [result]).map(eddProduct);
      }
      if (prods[0]) { out[it.key] = prods[0]; lookupCache.set(cacheKey, { at: Date.now(), value: prods[0] }); }
      while (lookupCache.size > 400) lookupCache.delete(lookupCache.keys().next().value);
    } catch {}
  });
  return out;
}

module.exports = { SHOPS, categories, search, details, account, signOut, owned, lookup };
