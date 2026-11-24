'use strict';

function dateValue(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function relevance(post, query) {
  const title = String(post.title || '').toLowerCase();
  const excerpt = String(post.excerpt || '').toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let score = title.includes(query.toLowerCase()) ? 10 : 0;
  for (const word of words) score += (title.includes(word) ? 3 : 0) + (excerpt.includes(word) ? 1 : 0);
  return score;
}

function mergeBrowsePosts(legacy, community, orderby, query = '') {
  const posts = [...legacy, ...community];
  if (orderby?.startsWith('popular') || orderby === 'relevance' && !query) {
    // MXB Mods supplies exact ranks for its popular lists. CoreMX supplies a
    // separately sorted trending/most-viewed list, so never place it above a
    // known MXB Mods rank or pretend its rank is directly comparable.
    const ranked = legacy.filter(p => Number.isFinite(p.rank));
    // A gear page can contain the sitewide chart and a separate category
    // chart. Their rank numbers are not comparable; site.search has already
    // placed them in the right order.
    if (!ranked.some(p => p.rankScope)) ranked.sort((a, b) => a.rank - b.rank);
    return [...ranked, ...community, ...legacy.filter(p => !Number.isFinite(p.rank))];
  }
  if (orderby === 'title') return posts.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));
  if (orderby === 'modified' || orderby === 'date') {
    const field = orderby;
    return posts.sort((a, b) => dateValue(b[field]) - dateValue(a[field]));
  }
  if (orderby === 'relevance' && query) return posts.sort((a, b) => relevance(b, query) - relevance(a, query));
  return posts;
}

module.exports = { mergeBrowsePosts };
