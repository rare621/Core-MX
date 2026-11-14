// Rank search images by the installed mod's identity, independently of source order.
const STOP = new Set('the and for by mx bikes mxbikes mod mods track tracks pack download edition oem factory paint livery pnt pkz zip'.split(' '));
function identity(value) {
  const text = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\.(pkz|zip|rar|7z|pnt)$/g, '').replace(/\(\d+\)/g, '')
    .replace(/\b(?:rd|round)\s*[._-]*\s*0*(\d+)\b/g, ' round$1 ')
    .replace(/\b(?:ams?|amateur|amateurs)\b/g, ' amateur ')
    .replace(/\b(?:pros?|professional)\b/g, ' pro ')
    .replace(/([a-z])(\d)|(?<=\d)([a-z])/g, '$1 $2$3');
  // Join round numbers again after separating bike/model numbers from words.
  const tokens = [...new Set(text.replace(/round\s+(\d+)/g, 'round$1').split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t) && !/^v\d+$/.test(t)))];
  const year = tokens.find((t) => /^(19|20)\d{2}$/.test(t));
  const round = tokens.find((t) => /^round\d+$/.test(t));
  const variant = tokens.find((t) => t === 'amateur' || t === 'pro');
  const core = tokens.filter((t) => t !== year && t !== round && t !== variant && !/^\d+$/.test(t));
  const numbers = tokens.filter((t) => /^\d+$/.test(t) && t !== year);
  return { tokens, core, year, round, variant, numbers };
}
function rankImages(query, posts) {
  const q = identity(query);
  return posts.filter((p) => p.image).map((p, order) => {
    const c = identity(p.title), set = new Set(c.tokens);
    const hits = q.core.filter((t) => set.has(t)).length;
    const coverage = q.core.length ? hits / q.core.length : 0;
    const agreement = q.tokens.filter((t) => set.has(t)).length / Math.max(1, q.tokens.length);
    const conflicts = ['year', 'round', 'variant'].filter((key) => q[key] && c[key] && q[key] !== c[key]);
    if (q.numbers.length && c.numbers.length && !q.numbers.some((n) => c.numbers.includes(n))) conflicts.push('number');
    const exact = q.tokens.length === c.tokens.length && agreement === 1;
    const score = coverage * 65 + agreement * 25 + (exact ? 20 : 0)
      + (q.year && q.year === c.year ? 8 : 0) + (q.round && q.round === c.round ? 12 : 0)
      + (q.variant && q.variant === c.variant ? 6 : 0) - conflicts.length * 35;
    return { ...p, matchScore: Math.round(score * 10) / 10,
      matchReliable: coverage >= 0.65 && hits >= Math.min(2, q.core.length) && hits > 0 && !conflicts.length,
      _order: order };
  }).sort((a, b) => b.matchScore - a.matchScore || a._order - b._order)
    .map(({ _order, ...p }) => p);
}
function broadQuery(query) {
  const i = identity(query);
  return i.core.filter((t) => !/^round\d+$/.test(t)).join(' ');
}
module.exports = { rankImages, broadQuery };
