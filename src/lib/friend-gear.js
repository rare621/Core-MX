// Gear another rider wears that their CoreMX couldn't send (bigger than the sync limit, locked by its
// creator), fetched from MXB Mods instead, automatically:
//  1. The MXB Mods page their CoreMX installed it from, if known: the same download if the page still
//     lists it, else the page's only free download. The link is read from the page itself, never
//     taken from the other app.
//  2. No page known, or that download failed or wasn't there: a search of MXB Mods by the model's name.
//     Only a strong match installs (a download whose name or file name contains the model's name, or a
//     title that does with a single download); anything less is "no match", never a guess.
// One attempt per item per run. Paid and account-bound items are never fetched.

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

function create({ site, startJob, jobStatus, isInstalled, enabled = () => true, onChange = () => {}, maxPosts = 8 }) {
  const items = new Map();   // "slot|name" -> { state, jobId, postId, title, link, error, via }
  const keyOf = (slot, name) => `${slot}|${String(name || '').toLowerCase()}`;

  // The state shown for an item: searching, installing, installed, nomatch, failed (or null: not tried).
  function status(slot, name) {
    const s = items.get(keyOf(slot, name));
    if (!s) return null;
    const out = { state: s.state, title: s.title, link: s.link, postId: s.postId, error: s.error };
    if (s.jobId) {
      const j = jobStatus(s.jobId);
      if (j && j.status === 'done') out.state = 'installed';
      else if (j && j.status === 'error') { out.state = 'failed'; out.error = j.error; }
      else if (j) out.state = 'installing';
    }
    return out;
  }

  async function fromPage(source, item, who) {
    const postId = Number(source && source.postId);
    if (!Number.isSafeInteger(postId) || postId <= 0 || !/^https:\/\/mxb-mods\.com\//i.test(String(source.link || ''))) return false;
    if (isInstalled(postId)) return false;   // installed, yet the item is still missing: not this download
    const post = await site.post(postId);
    const free = freeDownloads(post);
    const dl = free.find((d) => d.url === source.download) || (free.length === 1 ? free[0] : null);
    if (!dl) return false;
    Object.assign(item, { state: 'installing', via: 'page', postId, title: post.title, link: post.link, jobId: startJob(post, dl, who) });
    return true;
  }

  async function bySearch(slot, name, item, who, skip) {
    const tab = MODEL_TAB[slot];
    if (!tab || norm(name).length < MIN_NAME) return false;
    const seen = new Set(skip ? [skip] : []), posts = [];
    for (const query of queries(name)) {
      const r = await site.search({ query, tab, perPage: 12, orderby: 'relevance' }).catch(() => ({ posts: [] }));
      for (const p of r.posts || []) if (!seen.has(p.id) && posts.length < maxPosts) { seen.add(p.id); posts.push(p); }
    }
    for (const summary of posts) {
      if (isInstalled(summary.id)) continue;
      const post = await site.post(summary.id).catch(() => null);
      const dl = post && matchDownload(post, name);
      if (!dl) continue;
      Object.assign(item, { state: 'installing', via: 'search', postId: post.id || summary.id, title: post.title, link: post.link, jobId: startJob(post, dl, who) });
      return true;
    }
    return false;
  }

  async function run(slot, name, source, who, item, skipPost) {
    try {
      if (!skipPost && source && await fromPage(source, item, who)) return;
      if (await bySearch(slot, name, item, who, skipPost)) return;
      Object.assign(item, { state: MODEL_TAB[slot] ? 'nomatch' : 'failed', jobId: null, error: MODEL_TAB[slot] ? null : 'Not on MXB Mods' });
    } catch (e) { Object.assign(item, { state: 'failed', jobId: null, error: e.message }); }
    onChange();
  }

  // Fetch one item the other rider couldn't send. Returns at once; the state follows in status().
  function find({ slot, name, source = null, who = '' }) {
    if (!enabled() || !name) return;
    const key = keyOf(slot, name);
    if (items.has(key)) return;
    const item = { state: 'searching', slot, name, source, who };
    items.set(key, item);
    run(slot, name, source, who, item, null);
  }

  // A download this started failed: try the name search next (once), skipping that page.
  function jobFailed(jobId) {
    for (const item of items.values()) {
      if (item.jobId !== jobId || item.via !== 'page') continue;
      Object.assign(item, { state: 'searching', via: 'search-after-page', jobId: null });
      run(item.slot, item.name, null, item.who, item, item.postId);
    }
  }

  return { find, status, jobFailed };
}

module.exports = { create, queries, matchDownload, norm };
