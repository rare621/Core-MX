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
  { id: 'riders', label: 'Rider Models', cats: [365] },
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
const ADDON_CATEGORIES = { riderkit: [35, 52, 129, 309, 534], helmets: [127, 34], boots: [126], protection: [135], goggles: [380] };
function needsCustomModel(html) {
  const text = decode(html).replace(/\s+/g, ' ').replace(/\bno (?:other |additional |extra )?(?:mods?|models?)(?: are| is)? (?:required|needed)\b/gi, '');
  return /\b(?:requires?|needs?|must (?:have|use)|only (?:works?(?: with)?|for)|made for|for use with)\b[^.!?]{0,150}\b(?:model|rider\+|hoodie|helmet|boots?|protector)\b|\b(?:custom model|rider\+|hoodie model)\b[^.!?]{0,100}\b(?:required|needed|not included|sold separately)\b/i.test(text);
}
// Website categories are often broad (a rider kit can be tagged Boots,
// Gloves and Helmets).  When creators include install instructions, those
// paths are a much better indication of where the actual files belong.
function contentKindFromInstructions(text) {
  const value = decode(text).replace(/\\/g, '/').toLowerCase();
  if (/rider\/riders(?:\/[^/]+)?\/paints\b/.test(value)) return 'riderkit';
  if (/rider\/(?:riders\/[^/]+\/)?helmets\b/.test(value)) return 'helmets';
  if (/rider\/(?:riders\/[^/]+\/)?boots\b/.test(value)) return 'boots';
  if (/rider\/(?:riders\/[^/]+\/)?protections\b/.test(value)) return 'protection';
  if (/rider\/(?:riders\/[^/]+\/)?gloves\b/.test(value)) return 'gloves';
  if (/(?:^|\s)mods\/bikes\b/.test(value)) return 'liveries';
  return null;
}
function listingRequirements(html, description = '') {
  const $ = cheerio.load(html);
  const instructions = $('#instructions, .mod-instructions, [data-mod-instructions]').first().html() || '';
  $('nav,header,footer,aside,script,style,.related,.comments-area,.stuff,.quick-links').remove();
  const content = description || $('.nd-desc, .mod-description, [data-mod-description]').first().html() || $('.entry-content').first().html() ||
    (!/<(?:html|body)\b/i.test(html) ? $('body').html() : '') || '';
  const combined = content + '\n' + instructions;
  const needsModelNotice = needsCustomModel(combined);
  const dependencies = dependenciesFromHtml(combined);
  // A lot of creators state the required base model in plain text instead of
  // linking it. Treat that as a dependency too, so an add-on can be checked
  // against the user's installed models before it is downloaded.
  for (const dependency of dependenciesFromText(combined)) {
    if (!dependencies.some((d) => d.label.toLowerCase() === dependency.label.toLowerCase() ||
      /hoodie/i.test(dependency.label) && /hoodie/i.test(d.label + d.url))) dependencies.push(dependency);
  }
  if (needsModelNotice && /ab\s*designs?[^.!?]{0,40}hoodie|ab.?hoodie/i.test(decode(combined)) && !dependencies.some((d) => /rider-hoodie-abdesigns/.test(d.url))) dependencies.push({ label: 'ABDesigns Hoodie rider model', url: 'https://mxb-mods.com/rider-hoodie-abdesigns/' });
  return { needsModelNotice: needsModelNotice || dependencies.length > 0, dependencies, instructions, contentKind: contentKindFromInstructions(combined) };
}
const requirementCache = new Map();
const requirementRequests = new Map();
async function enrichListing(post, signal) {
  if (post.categories.some((id) => [313, 343, 344, 365].includes(id))) return post;
  if (post.needsModelNotice) return { ...post, gearKind: post.gearKind || 'paint' };
  if (!post.categories.some((id) => [35, 52, 129, 309, 534].includes(id))) return post;
  const cached = requirementCache.get(post.id);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return { ...post, ...cached.result };
  if (!requirementRequests.has(post.id)) requirementRequests.set(post.id, (async () => {
    try {
      const response = await net.fetch(post.link, { headers: { 'User-Agent': UA }, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) throw new Error('Instructions unavailable');
      const details = listingRequirements(await response.text());
      const result = { needsModelNotice: details.needsModelNotice, contentKind: details.contentKind, ...(details.needsModelNotice ? { gearKind: 'paint' } : {}) };
      requirementCache.set(post.id, { result, at: Date.now() });
      while (requirementCache.size > 200) requirementCache.delete(requirementCache.keys().next().value);
      return result;
    } catch { return { dependencyCheckFailed: true }; }
    finally { requirementRequests.delete(post.id); }
  })());
  return { ...post, ...await requirementRequests.get(post.id) };
}
async function enrichListings(posts, signal) {
  const result = new Array(posts.length); let next = 0;
  // Full post pages can be image-heavy.  Keep this deliberately small and
  // yield between parses so a long Get Mods page never monopolises Electron's
  // main process (which would make scrolling and clicks feel frozen).
  await Promise.all(Array.from({ length: Math.min(2, posts.length) }, async () => {
    while (next < posts.length) {
      const index = next++;
      result[index] = await enrichListing(posts[index], signal);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }));
  return result;
}
function isAddonPost(post) {
  const ids = post.categories || [];
  if (ids.some((id) => [37, 51, 361, 32].includes(id))) return false;
  if (ids.some((id) => [313, 343, 344, 365, 45, 304, 22].includes(id))) return false;
  return ids.some((id) => [127, 34, 126, 135, 380].includes(id)) || !!post.needsModelNotice || !!post.modelDependencies?.length;
}
function scopePosts(posts, scope) { return scope === 'all' ? posts : posts.filter((p) => isAddonPost(p) === (scope === 'addons')); }
function browseCategory(tab, kind = 'all') {
  const base = BROWSE_TABS.find((x) => x.id === tab) || BROWSE_TABS[0];
  return GEAR_CATEGORIES[tab]?.[kind] ? { ...base, cats: GEAR_CATEGORIES[tab][kind] } : base;
}
function gearKind(ids) {
  const model = ids.some((id) => [313, 343, 344, 365].includes(id));
  const paint = ids.some((id) => [127, 126, 135].includes(id));
  return model && paint ? 'bundle' : model ? 'model' : paint ? 'paint' : ids.includes(34) ? 'addon' : null;
}

async function getJson(url, signal) {
  const res = await net.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
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
    needsModelNotice: needsCustomModel(p.content?.rendered || p.excerpt?.rendered || ''),
    categoryNames: catNames,
    paid: (p.categories || []).some((c) => c === 359 || (cats[c] && cats[c].parent === 359)),
    image: pickImage(media, ['medium_large', 'medium', 'large', 'full']),
    excerpt: decode(p.excerpt && p.excerpt.rendered).replace(/\s+/g, ' ').trim().slice(0, 220),
  };
}

// mxb-mods.com's "Popular" pages (ranked by views). Parsed, then resolved to full posts by slug.
const POPULAR = { today: 'popular-today', week: 'popular-last-7-days', month: 'popular-last-30-days', all: 'popular-all-time' };
const popularCache = new Map();
async function fetchPopular(range) {
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
    const params = new URLSearchParams({ slug: slugs, per_page: '50', _embed: 'wp:featuredmedia', _fields: 'id,slug,title,link,date,modified,categories,featured_media,excerpt,content,_links,_embedded' });
    const { json: posts } = await getJson(`${BASE}/wp-json/wp/v2/posts?${params}`);
    for (const p of posts) bySlug.set(p.slug, summarizePost(p, cats));
  }
  const posts = ranked.map((r, i) => bySlug.get(r.slug) && { ...bySlug.get(r.slug), views: r.views, rank: i + 1 }).filter(Boolean);
  popularCache.set(range, { at: Date.now(), posts });
  return posts;
}
const popularPending = new Map();
function popular(range) {
  if (!popularPending.has(range)) popularPending.set(range, fetchPopular(range).finally(() => popularPending.delete(range)));
  return popularPending.get(range);
}

async function scopedSearch({ query, tab, kind, scope, page, perPage, orderby, cursor }, cats) {
  const deadline = AbortSignal.timeout(20000);
  const t = browseCategory(tab, kind), scoped = scope === 'addons' ? { ...t, cats: ADDON_CATEGORIES[tab] || Object.values(ADDON_CATEGORIES).flat() } : t;
  const matches = (p) => (!scoped.cats || p.categories.some((id) => scoped.cats.includes(id) || scoped.cats.includes(cats[id]?.parent)))
    && (!scoped.exclude || !p.categories.some((id) => scoped.exclude.includes(id)))
    && (!p.contentKind || tab === 'all' || p.contentKind === tab)
    && (!query || p.title.toLowerCase().includes(query.toLowerCase()));
  const sort = orderby === 'relevance' && !query ? 'popular-month' : orderby;
  const featured = sort.startsWith('popular') ? scopePosts(await enrichListings((await popular(sort.split('-')[1] || 'month')).filter(matches), deadline), scope) : [];
  let offset = Math.max(0, Number(cursor?.offset) || 0), featuredOffset = Math.max(0, Number(cursor?.featuredOffset) || 0), total = Infinity;
  const posts = featured.slice(featuredOffset, featuredOffset + perPage); featuredOffset += posts.length;
  // Inspect listing descriptions in the same request, never download archives or
  // fetch each card separately. Carry the raw cursor so filtering cannot skip/repeat pages.
  for (let batch = 0; posts.length < perPage && offset < total && batch < 3; batch++) {
    const params = new URLSearchParams({ per_page: String(Math.min(100, Math.max(30, perPage))), offset: String(offset), _embed: 'wp:featuredmedia', _fields: 'id,title,link,date,modified,categories,featured_media,excerpt,content,_links,_embedded', orderby: sort === 'title' ? 'title' : sort === 'modified' ? 'modified' : sort === 'relevance' && query ? 'relevance' : 'date' });
    if (sort === 'title') params.set('order', 'asc');
    if (query) params.set('search', query);
    if (scoped.cats) params.set('categories', scoped.cats.join(','));
    if (scoped.exclude) params.set('categories_exclude', scoped.exclude.join(','));
    if (featured.length) params.set('exclude', featured.slice(0, 100).map((p) => p.id).join(','));
    const response = await getJson(`${BASE}/wp-json/wp/v2/posts?${params}`, deadline);
    total = Number(response.headers.get('x-wp-total') || 0);
    if (!response.json.length) { offset = total; break; }
    const enriched = await enrichListings(response.json.map((raw) => summarizePost(raw, cats)), deadline);
    for (const p of enriched) {
      offset++;
      if (matches(p) && isAddonPost(p) === (scope === 'addons')) posts.push(p);
      if (posts.length >= perPage) break;
    }
  }
  const more = featuredOffset < featured.length || offset < total;
  return { posts, total: 0, page, totalPages: more ? page + 1 : page, nextCursor: { offset, featuredOffset } };
}

async function search({ query = '', tab = 'all', kind = 'all', scope = 'all', page = 1, perPage = 24, orderby = 'date', cursor = null } = {}) {
  const cats = await categories();
  if (scope === 'free' || scope === 'addons') return scopedSearch({ query, tab, kind, scope, page, perPage, orderby, cursor }, cats);
  let t = browseCategory(tab, kind);
  if (scope === 'addons') t = { ...t, cats: ADDON_CATEGORIES[tab] || Object.values(ADDON_CATEGORIES).flat() };
  // "Best match" without a search reads as popular-first, like the popular sorts.
  if (orderby === 'relevance' && !query) orderby = 'popular-month';
  if (orderby.startsWith('popular')) {
    // The site's popular pages only rank a few dozen posts, so most categories have few or none
    // there. Show the category's popular posts first, then the rest of the category, newest first.
    let xs = await popular(orderby.split('-')[1] || 'month');
    xs = scopePosts(xs, scope);
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
    return { total: scope === 'all' ? total : 0, totalPages: Math.max(1, Math.ceil(total / perPage)), page, posts: [...top, ...(need > 0 ? scopePosts(json.map((p) => summarizePost(p, cats)), scope) : [])] };
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
    total: scope === 'all' ? Number(headers.get('x-wp-total') || 0) : 0,
    totalPages: Number(headers.get('x-wp-totalpages') || 0),
    page,
    posts: scopePosts(json.map((p) => summarizePost(p, cats)), scope),
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
  const details = listingRequirements(html, p.content && p.content.rendered || '');
  const needsModelNotice = !summary.categories.includes(365) && details.needsModelNotice;
  return { ...summary, author: pageAuthor || author, images: images.slice(0, 24), description: description + (details.instructions ? '<h3>Mod instructions</h3>' + sanitize($, $('#instructions, .mod-instructions, [data-mod-instructions]').first().contents()) : ''), downloads, needsModelNotice, gearKind: needsModelNotice ? summary.gearKind || 'paint' : summary.gearKind, dependencies: details.dependencies, madeFor: betas, downloadCount: dlCount };
}

function dependenciesFromHtml(html) {
  const $ = cheerio.load(html), found = [];
  const add = (url, label) => {
    try {
      const u = new URL(url.replace(/[).,;]+$/, ''));
      if (!/^https?:$/.test(u.protocol) || !/^(?:www\.)?(?:mxb-mods\.com|mxbikes-shop\.com|shop\.mxb-hub\.com)$/.test(u.hostname) || /\.(webp|png|jpe?g|gif|psd)$/i.test(u.pathname)) return;
      if (/\/(?:category|categories|tag|tags|product-category|author|creators?|page|my-account|login|register|wp-login\.php)(?:\/|$)/i.test(u.pathname) || u.pathname === '/') return;
      if (!found.some((x) => x.url === u.href)) found.push({ label: (label || decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'Required model').replace(/-/g, ' ')).slice(0, 100), url: u.href });
    } catch {}
  };
  $('a[href]').each((_, a) => {
    const url = $(a).attr('href'), label = $(a).text().trim();
    const context = $(a).closest('p,li,div').text();
    if (!label || !/require|need|model|link to|based on|made.*for/i.test(context)) return;
    add(url, label);
  });
  $('p,li').each((_, el) => {
    const context = $(el).text();
    if (!/require|need|model|link to|based on|made.*for/i.test(context)) return;
    for (const url of context.match(/https?:\/\/[^\s<>"']+/g) || []) add(url);
  });
  return found.slice(0, 8);
}

function dependenciesFromText(html) {
  const text = decode(cheerio.load(html).text()).replace(/\s+/g, ' ');
  const found = [];
  // Examples seen in real posts: "made to work on the Aeffertz Fox Instinct
  // 2.0 FREE on MXBMods" and "requires the ABDesigns hoodie model".
  const pattern = /(?:made\s+(?:to\s+)?work\s+on|requires?|needs?|only\s+(?:for|with)|based\s+on)\s+(?:the\s+)?(.{3,110}?)(?=\s+(?:on|from)\s+(?:mxb[- ]?mods|mxbikes[- ]?shop|mxb[- ]?hub)|[!?]|\.(?!\d)|$)/gi;
  for (const match of text.matchAll(pattern)) {
    let label = match[1].replace(/\b(?:model|mod)\s*(?:to\s+work)?\b\s*$/i, '').trim();
    label = label.replace(/\s+(?:for|with)\s+(?:this|the)\s+(?:mod|paint|pack)\s*$/i, '').trim();
    if (label.length < 4 || /^(?:this|it|a|an|to|help|no|nothing)\b/i.test(label) || /https?:|\b(?:psd|template|discord|recommendations?|ratings?|votes?)\b/i.test(label)) continue;
    label = label.slice(0, 100);
    if (!found.some((d) => d.label.toLowerCase() === label.toLowerCase())) found.push({ label, url: '', inferred: true });
  }
  return found;
}

async function postBySlug(slug) {
  const { json } = await getJson(`${BASE}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id`);
  return json[0] ? post(json[0].id) : null;
}

module.exports = { BROWSE_TABS, search, post, postBySlug, postsByIds, categories, UA, hostOf, dependenciesFromHtml, dependenciesFromText, browseCategory, gearKind, isAddonPost, ADDON_CATEGORIES, needsCustomModel, listingRequirements };
