// mxb-mods.com client: WordPress REST API for listing/searching + page HTML for download links.
const cheerio = require('cheerio');
const { net } = require('electron');

const BASE = 'https://mxb-mods.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 MXBikesManager/1.0';

// Browse tabs -> WordPress category ids (posts are tagged with parent + child categories)
const BROWSE_TABS = [
  { id: 'all', label: 'All', exclude: [359, 120, 44, 172] },
  { id: 'tracks', label: 'Tracks', cats: [22] },
  { id: 'bikes', label: 'New Bikes', cats: [45, 304] },
  { id: 'liveries', label: 'Bike Liveries', cats: [37] },
  { id: 'riderkit', label: 'Rider Kits', cats: [35] },
  { id: 'helmets', label: 'Helmets', cats: [33] },
  { id: 'boots', label: 'Boots', cats: [31] },
  { id: 'gloves', label: 'Gloves', cats: [32] },
  { id: 'protection', label: 'Protection', cats: [36] },
  { id: 'goggles', label: 'Goggles', cats: [380] },
  { id: 'sounds', label: 'Sounds', cats: [46] },
  { id: 'wheels', label: 'Wheels', cats: [95, 382] },
  { id: 'graphics', label: 'Graphics', cats: [174, 609, 130] },
  { id: 'modpacks', label: 'Modpacks', cats: [93] },
  { id: 'other', label: 'Other / Tools', cats: [40] },
  { id: 'paid', label: 'Paid', cats: [359] },
];

let categoryMap = null; // id -> {name, parent}
const GEAR_CATEGORIES = { helmets: { models: [313], paints: [127], addons: [34] }, boots: { models: [343], paints: [126] }, protection: { models: [344], paints: [135] } };
function browseCategory(tab, kind = 'all') {
  const base = BROWSE_TABS.find((x) => x.id === tab) || BROWSE_TABS[0];
  return GEAR_CATEGORIES[tab]?.[kind] ? { ...base, cats: GEAR_CATEGORIES[tab][kind] } : base;
}
function gearKind(ids) {
  const model = ids.some((id) => [313, 343, 344].includes(id));
  const paint = ids.some((id) => [127, 126, 135].includes(id));
  return model && paint ? 'bundle' : model ? 'model' : paint ? 'paint' : ids.includes(34) ? 'addon' : null;
}

async function getJson(url) {
  const res = await net.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`mxb-mods.com returned HTTP ${res.status}`);
  return { json: await res.json(), headers: res.headers };
}

async function categories() {
  if (categoryMap) return categoryMap;
  const { json } = await getJson(`${BASE}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,parent,count,slug`);
  categoryMap = {};
  for (const c of json) categoryMap[c.id] = { name: decode(c.name), parent: c.parent, slug: c.slug, count: c.count };
  return categoryMap;
}

function decode(s) {
  return cheerio.load(`<i>${s || ''}</i>`)('i').text();
}

function pickImage(media, pref = ['medium_large', 'large', 'medium', 'full']) {
  if (!media) return null;
  const sizes = (media.media_details && media.media_details.sizes) || {};
  for (const p of pref) if (sizes[p] && sizes[p].source_url) return sizes[p].source_url;
  return media.source_url || null;
}

function summarizePost(p, cats) {
  const media = p._embedded && p._embedded['wp:featuredmedia'] && p._embedded['wp:featuredmedia'][0];
  const catNames = (p.categories || []).map((id) => cats[id] && cats[id].name).filter(Boolean);
  return {
    id: p.id,
    title: decode(p.title && p.title.rendered),
    link: p.link,
    date: p.date,
    modified: p.modified,
    categories: p.categories || [],
    gearKind: gearKind(p.categories || []),
    categoryNames: catNames,
    paid: (p.categories || []).some((c) => c === 359 || (cats[c] && cats[c].parent === 359)),
    image: pickImage(media, ['medium_large', 'medium', 'large', 'full']),
    excerpt: decode(p.excerpt && p.excerpt.rendered).replace(/\s+/g, ' ').trim().slice(0, 220),
  };
}

// mxb-mods.com's "Popular" pages (ranked by views). Parsed, then resolved to full posts by slug.
const POPULAR = { today: 'popular-today', week: 'popular-last-7-days', month: 'popular-last-30-days', all: 'popular-all-time' };
const popularCache = new Map();
async function popular(range) {
  const hit = popularCache.get(range);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.posts;
  const cats = await categories();
  const { json } = await getJson(`${BASE}/wp-json/wp/v2/pages?slug=${POPULAR[range] || POPULAR.month}&_fields=content`);
  const $ = cheerio.load((json[0] && json[0].content.rendered) || '');
  const ranked = [];
  $('li.dmpop-card').each((_, li) => {
    const href = $(li).find('a.dmpop-title').attr('href') || '';
    const slug = (href.match(/mxb-mods\.com\/([^/?#]+)\/?/) || [])[1];
    const views = Number(($(li).find('.dmpop-views').text().match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
    if (slug) ranked.push({ slug, views });
  });
  const bySlug = new Map();
  for (let i = 0; i < ranked.length; i += 50) {
    const slugs = ranked.slice(i, i + 50).map((r) => r.slug).join(',');
    const params = new URLSearchParams({ slug: slugs, per_page: '50', _embed: 'wp:featuredmedia', _fields: 'id,slug,title,link,date,modified,categories,featured_media,excerpt,_links,_embedded' });
    const { json: posts } = await getJson(`${BASE}/wp-json/wp/v2/posts?${params}`);
    for (const p of posts) bySlug.set(p.slug, summarizePost(p, cats));
  }
  const posts = ranked.map((r, i) => bySlug.get(r.slug) && { ...bySlug.get(r.slug), views: r.views, rank: i + 1 }).filter(Boolean);
  popularCache.set(range, { at: Date.now(), posts });
  return posts;
}

async function search({ query = '', tab = 'all', kind = 'all', page = 1, perPage = 24, orderby = 'date' } = {}) {
  const cats = await categories();
  const t = browseCategory(tab, kind);
  // "Best match" without a search reads as popular-first, like the popular sorts.
  if (orderby === 'relevance' && !query) orderby = 'popular-month';
  if (orderby.startsWith('popular')) {
    // The site's popular pages only rank a few dozen posts, so most categories have few or none
    // there. Show the category's popular posts first, then the rest of the category, newest first.
    let xs = await popular(orderby.split('-')[1] || 'month');
    if (t.cats) xs = xs.filter((p) => p.categories.some((c) => t.cats.includes(c) || (cats[c] && t.cats.includes(cats[c].parent))));
    if (t.exclude) xs = xs.filter((p) => !p.categories.some((c) => t.exclude.includes(c)));
    if (query) { const q = query.toLowerCase(); xs = xs.filter((p) => p.title.toLowerCase().includes(q)); }
    const start = (page - 1) * perPage;
    const top = xs.slice(start, start + perPage);
    const need = perPage - top.length;
    const rest = new URLSearchParams({
      per_page: String(Math.max(1, need)), offset: String(Math.max(0, start - xs.length)), orderby: 'date', _embed: 'wp:featuredmedia',
      _fields: 'id,title,link,date,modified,categories,featured_media,excerpt,_links,_embedded',
    });
    if (query) rest.set('search', query);
    if (t.cats) rest.set('categories', t.cats.join(','));
    if (t.exclude) rest.set('categories_exclude', t.exclude.join(','));
    if (xs.length) rest.set('exclude', xs.map((p) => p.id).slice(0, 100).join(','));
    const { json, headers } = await getJson(`${BASE}/wp-json/wp/v2/posts?${rest}`);
    const restTotal = Number(headers.get('x-wp-total') || 0);
    const total = xs.length + restTotal;
    return { total, totalPages: Math.max(1, Math.ceil(total / perPage)), page, posts: [...top, ...(need > 0 ? json.map((p) => summarizePost(p, cats)) : [])] };
  }
  const params = new URLSearchParams({
    per_page: String(perPage), page: String(page), _embed: 'wp:featuredmedia',
    _fields: 'id,title,link,date,modified,categories,featured_media,excerpt,_links,_embedded',
  });
  if (query) params.set('search', query);
  if (t.cats) params.set('categories', t.cats.join(','));
  if (t.exclude) params.set('categories_exclude', t.exclude.join(','));
  if (orderby === 'relevance' && query) params.set('orderby', 'relevance');
  else if (orderby === 'modified') params.set('orderby', 'modified');
  else if (orderby === 'title') { params.set('orderby', 'title'); params.set('order', 'asc'); }
  else params.set('orderby', 'date');
  const { json, headers } = await getJson(`${BASE}/wp-json/wp/v2/posts?${params}`);
  return {
    total: Number(headers.get('x-wp-total') || 0),
    totalPages: Number(headers.get('x-wp-totalpages') || 0),
    page,
    posts: json.map((p) => summarizePost(p, cats)),
  };
}

async function postsByIds(ids) {
  if (!ids.length) return [];
  const cats = await categories();
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      include: chunk.join(','), per_page: '50', _embed: 'wp:featuredmedia',
      _fields: 'id,title,link,date,modified,categories,featured_media,excerpt,_links,_embedded',
    });
    const { json } = await getJson(`${BASE}/wp-json/wp/v2/posts?${params}`);
    out.push(...json.map((p) => summarizePost(p, cats)));
  }
  return out;
}

// Rebuild description HTML from an allow-list of tags (never pass site HTML through raw).
function sanitize($, root) {
  const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'h5', 'blockquote', 'code', 'hr', 'span', 'div']);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const walk = (node) => {
    if (node.type === 'text') return esc(node.data || '');
    if (node.type !== 'tag') return '';
    const tag = node.name.toLowerCase();
    const inner = (node.children || []).map(walk).join('');
    if (tag === 'a') {
      const href = $(node).attr('href') || '';
      if (/^https?:\/\//i.test(href) && !/\.(webp|jpe?g|png|gif)$/i.test(href)) {
        return `<a href="${esc(href).replace(/"/g, '&quot;')}" data-external>${inner || esc(href)}</a>`;
      }
      return inner;
    }
    if (tag === 'iframe') {
      const src = $(node).attr('src') || '';
      const yt = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/);
      if (yt) return `<p><a href="https://www.youtube.com/watch?v=${yt[1]}" data-external>▶ Watch video on YouTube</a></p>`;
      return '';
    }
    if (tag === 'span' || tag === 'div') return inner;
    if (!ALLOWED.has(tag)) return inner;
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    return `<${tag}>${inner}</${tag}>`;
  };
  return root.toArray().map(walk).join('').replace(/(<p>\s*<\/p>)+/g, '');
}

function bestSrc($img) {
  const srcset = $img.attr('srcset');
  if (srcset) {
    const best = srcset.split(',').map((s) => s.trim().split(/\s+/)).map(([u, w]) => ({ u, w: parseInt(w) || 0 }))
      .sort((a, b) => b.w - a.w)[0];
    if (best) return best.u;
  }
  return $img.attr('data-src') || $img.attr('src');
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

async function post(id) {
  const cats = await categories();
  const { json: p } = await getJson(`${BASE}/wp-json/wp/v2/posts/${id}?_embed=author,wp:featuredmedia`);
  const summary = summarizePost(p, cats);
  const $c = cheerio.load(p.content && p.content.rendered || '');
  const images = [];
  if (summary.image) {
    const media = p._embedded && p._embedded['wp:featuredmedia'] && p._embedded['wp:featuredmedia'][0];
    images.push(pickImage(media, ['large', 'full', 'medium_large']) || summary.image);
  }
  $c('img').each((_, el) => {
    const $img = $c(el);
    const parentHref = $img.parent('a').attr('href');
    const src = parentHref && /\.(webp|jpe?g|png|gif)$/i.test(parentHref) ? parentHref : bestSrc($img);
    if (src && !images.includes(src) && !/emoji|gravatar/.test(src)) images.push(src);
  });
  const description = sanitize($c, $c('body').contents());
  const a0 = p._embedded && p._embedded.author && p._embedded.author[0];
  const author = a0 && a0.name ? a0.name : null;

  // Download links live in the rendered page, not in the API content
  const res = await net.fetch(p.link, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  const $ = cheerio.load(html);
  const downloads = [];
  $('.download-container').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a[href]').filter((_, a) => !/^#/.test($(a).attr('href'))).first();
    const url = $a.attr('href');
    if (!url) return;
    const flag = $el.find('.container-flag').text().replace(/\s+/g, ' ').trim();
    const fname = $el.find('.filename').text().replace(/\s+/g, ' ').trim();
    downloads.push({ url, flag, label: fname && fname !== url ? fname : '', host: hostOf(url) });
  });
  const betas = $('p.betas').first().text().replace(/\s+/g, ' ').trim();
  const pageAuthor = $('a.nd-meta-author').first().text().replace(/^\s*by\s+/i, '').trim()
    || ((html.match(/"author":\{"@type":"Person"[^}]*?"name":"([^"]+)"/) || [])[1] || '');
  const dlCount = $('[class*="total-downloads"], .dmkrtz-lt-total').first().text().replace(/\s+/g, ' ').trim();
  return { ...summary, author: pageAuthor || author, images: images.slice(0, 24), description, downloads, dependencies: dependenciesFromHtml(p.content && p.content.rendered || ''), madeFor: betas, downloadCount: dlCount };
}

function dependenciesFromHtml(html) {
  const $ = cheerio.load(html), found = [];
  $('a[href]').each((_, a) => {
    const url = $(a).attr('href'), label = $(a).text().trim();
    const context = $(a).closest('p,li,div').text();
    if (!label || !/require|need|model|link to|based on|made.*for/i.test(context)) return;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || !/^(?:www\.)?(?:mxb-mods\.com|mxbikes-shop\.com|shop\.mxb-hub\.com)$/.test(u.hostname)) return;
      if (!found.some((x) => x.url === u.href)) found.push({ label: label.slice(0, 100), url: u.href });
    } catch {}
  });
  return found.slice(0, 8);
}

async function postBySlug(slug) {
  const { json } = await getJson(`${BASE}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id`);
  return json[0] ? post(json[0].id) : null;
}

module.exports = { BROWSE_TABS, search, post, postBySlug, postsByIds, categories, UA, hostOf, dependenciesFromHtml, browseCategory, gearKind };
