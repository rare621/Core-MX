// Gear another rider wears that their CoreMX couldn't send (bigger than the sync limit, locked by its
// creator), fetched from MXB Mods instead, automatically, in this order:
//  1. The MXB Mods page their CoreMX installed it from, if known.
//  2. The shared gear catalog (service v27): pages and downloads other riders' CoreMX installed this
//     very file from (reported from the files an install really wrote, see main.js reportCatalog).
//  3. A search of MXB Mods by the model's name. Only a strong match installs (a download whose name or
//     file name contains the model's name, or a title that does with a single download).
//  4. Nothing worked: "nomatch" / "failed", and the player picks (the Missing gear window).
// A page's download link is always read from the page itself, never taken from another app or the
// catalog as is: the same download if the page still lists it, else the page's only free download.
// An install that finished without the item counts against that catalog entry and the next option
// is tried. One run per item per app start. Paid and account-bound items are never fetched.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MODEL_TAB = { helmet: 'helmets', boots: 'boots', protection: 'protection', rider: 'riders' };
const MIN_NAME = 5;   // shorter names ("Full", "Pro") match too much to install on a name alone

// Search terms for a model's folder name: "Bellmoto10-FCR" → "Bellmoto10 FCR", "Bellmoto 10 FCR".
function queries(name) {
  const spaced = String(name || '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const split = spaced.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z])(\d)/gi, '$1 $2').replace(/(\d)([a-z])/gi, '$1 $2');
  return [...new Set([spaced, split].filter(Boolean))];
}

const fileOf = (url) => { try { return decodeURIComponent(new URL(url).pathname).split('/').filter((p) => p && p !== 'file').pop() || ''; } catch { return ''; } };
function isServerDownload(d) {
  const flag = String(d.flag || ''), label = String(d.label || '');
  if (flag.trim()) return /\bserver\b/i.test(flag) && !/\bplayer\b/i.test(flag);
  return /\bserver\b/i.test(label) && !/\bplayer\b/i.test(label);
}
const freeDownloads = (post) => (post.downloads || []).filter((d) => d && /^https?:\/\//i.test(String(d.url || '')) && !d.shop && !isServerDownload(d));

// The download of `post` that is surely `name`, or null.
function matchDownload(post, name) {
  const want = norm(name);
  if (want.length < MIN_NAME) return null;
  const free = freeDownloads(post);
  const hit = free.find((d) => norm(d.label).includes(want) || norm(fileOf(d.url)).includes(want));
  if (hit) return hit;
  const slug = (() => { try { return new URL(post.link).pathname; } catch { return ''; } })();
  if ((norm(post.title).includes(want) || norm(slug).includes(want)) && free.length === 1) return free[0];
  return null;
}

function create({ site, startJob, jobStatus, isInstalled, lookup = async () => ({}), reportBad = () => {}, enabled = () => true, onChange = () => {}, maxPosts = 8, retryAfter = 10 * 60 * 1000 }) {
  const items = new Map();   // "slot|name" -> item
  const keyOf = (slot, name) => `${slot}|${String(name || '').toLowerCase()}`;

  // What to show for an item: searching, installing, installed, nomatch, failed (null: not tried).
  function status(slot, name) {
    const s = items.get(keyOf(slot, name));
    if (!s) return null;
    const out = { state: s.state, via: s.via, title: s.title, link: s.link, postId: s.postId, error: s.error };
    if (s.jobId) {
      const j = jobStatus(s.jobId);
      if (j && j.status === 'done') out.state = 'installed';
      else if (j && j.status === 'error') { out.state = 'failed'; out.error = j.error; }
      else if (j) out.state = 'installing';
    }
    return out;
  }

  // Install `source` ({ postId, link, download }) if its page still offers that download.
  async function fromPage(source, item, via) {
    const postId = Number(source && source.postId);
    if (!Number.isSafeInteger(postId) || postId <= 0 || item.tried.has(postId) || !/^https:\/\/mxb-mods\.com\//i.test(String(source.link || ''))) return false;
    item.tried.add(postId);
    if (isInstalled(postId)) return false;   // installed, yet the item is still missing: not this download
    const post = await site.post(postId).catch(() => null);
    if (!post) return false;
    const free = freeDownloads(post);
    // exact: this very download was installed in the background with the same file (catalog v28): only it.
    const dl = free.find((d) => d.url === source.download) || (!item.exact && free.length === 1 ? free[0] : null);
    if (!dl) return false;
    Object.assign(item, { state: 'installing', via, postId, title: post.title, link: post.link, error: null, jobId: startJob(post, dl, item.who) });
    return true;
  }

  async function fromCatalog(item) {
    if (!item.catalogKey) return false;
    if (!item.catalogList) item.catalogList = (await Promise.resolve(lookup([item.catalogKey])).catch(() => ({})))[item.catalogKey] || [];
    const list = item.catalogList;
    for (const e of list) if (await fromPage(e, item, 'catalog')) return true;
    return false;
  }

  async function bySearch(item) {
    const tab = MODEL_TAB[item.slot];
    if (!tab || norm(item.name).length < MIN_NAME) return false;
    const posts = [], seen = new Set(item.tried);
    for (const query of queries(item.name)) {
      const r = await site.search({ query, tab, perPage: 12, orderby: 'relevance' }).catch(() => ({ posts: [] }));
      for (const p of r.posts || []) if (!seen.has(p.id) && posts.length < maxPosts) { seen.add(p.id); posts.push(p); }
    }
    for (const summary of posts) {
      if (isInstalled(summary.id)) continue;
      const post = await site.post(summary.id).catch(() => null);
      const dl = post && matchDownload(post, item.name);
      if (!dl) continue;
      const postId = post.id || summary.id;
      item.tried.add(postId);
      Object.assign(item, { state: 'installing', via: 'search', postId, title: post.title, link: post.link, error: null, jobId: startJob(post, dl, item.who) });
      return true;
    }
    return false;
  }

  // The next option not tried yet; the last one sets nomatch / failed.
  async function next(item) {
    try {
      if (!item.steps.page) { item.steps.page = true; if (item.source && await fromPage(item.source, item, 'page')) return onChange(); }
      // Every catalog entry in turn (one that didn't contain the item moves on to the next).
      if (!item.steps.catalog) { if (await fromCatalog(item)) return onChange(); item.steps.catalog = true; }
      // Pages only (a file that can also come through the service): no name search; the service next.
      if (item.pageOnly) { Object.assign(item, { state: 'nopage', jobId: null }); return onChange(item); }
      if (!item.steps.search) { item.steps.search = true; if (await bySearch(item)) return onChange(); }
      Object.assign(item, { state: 'nomatch', jobId: null, doneAt: Date.now() });
    } catch (e) { Object.assign(item, { state: 'failed', jobId: null, error: e.message, doneAt: Date.now() }); }
    onChange();
  }

  // Fetch one item the other rider couldn't send. Returns at once; the state follows in status().
  // catalogKey: from src/lib/gear-keys.js keyForItem.
  // pageOnly: the owner's page and the catalog only, then 'nopage' (the file can come through the
  // service instead). Asked again without pageOnly (that failed too), it goes on to the name search.
  // exact: source is a catalog entry with this exact file (same SHA-256), installed in the background
  // by other riders: only that download is used, and no other catalog page.
  function find({ slot, name, source = null, who = '', catalogKey = null, pageOnly = false, exact = false }) {
    if (!enabled() || !name) return;
    const key = keyOf(slot, name);
    const old = items.get(key);
    if (old) {
      if (!pageOnly && old.pageOnly && old.state === 'nopage') { Object.assign(old, { pageOnly: false, state: 'searching' }); next(old); }
      // Nothing found earlier: look again after a while (someone may have added the page since).
      else if (['nomatch', 'failed'].includes(old.state) && Date.now() - (old.doneAt || 0) >= retryAfter) {
        Object.assign(old, { state: 'searching', error: null, steps: {}, tried: new Set(), catalogList: null, pageOnly: pageOnly && old.pageOnly });
        next(old);
      }
      return;
    }
    const item = { state: 'searching', slot, name, source, who, catalogKey, pageOnly, exact, tried: new Set(), steps: exact ? { catalog: true } : {} };
    items.set(key, item);
    next(item);
  }

  // A download this started failed: go on with the next option.
  function jobFailed(jobId) {
    for (const item of items.values()) {
      if (item.jobId !== jobId) continue;
      const error = (jobStatus(jobId) || {}).error;
      Object.assign(item, { state: 'searching', jobId: null, error: error || null });
      next(item);
    }
  }

  // The install finished but the item is still not there: it wasn't in that download. Counts against
  // the catalog entry it came from, and the next option is tried. Once per install.
  function stillMissing(slot, name) {
    const item = items.get(keyOf(slot, name));
    if (!item || !item.jobId || item.checkedJob === item.jobId) return;
    const j = jobStatus(item.jobId);
    if (!j || j.status !== 'done') return;
    item.checkedJob = item.jobId;
    if (item.via === 'catalog' && item.catalogKey) reportBad(item.catalogKey, item.postId);
    Object.assign(item, { state: 'searching', jobId: null, error: `${item.title || 'That download'} didn't include it` });
    next(item);
  }

  return { find, status, jobFailed, stillMissing };
}

module.exports = { create, queries, matchDownload, norm };
