const cheerio = require('cheerio');
const swapPattern = /model[\s_-]*swap/i;
function labelFromUrl(url) { try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop()).replace(/[-_]+/g, ' '); } catch { return 'Required model'; } }
function tokens(value) {
  return new Set(String(value).toLowerCase().replace(/\biii\b/g, '3').replace(/\bii\b/g, '2').replace(/astars|alpinestars/g, 'astars').replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').split(/[^a-z0-9]+/).filter((v) => v && !['model', 'swap', 'modelswap', 'link', 'here', 'helmet', 'paint', 'paints', 'for', 'the', 'jpd', 'download'].includes(v)));
}
function enrich(dependencies, downloads, html = '') {
  const $ = cheerio.load(html.replace(/<br\s*\/?\s*>/gi, ' ')), found = dependencies.map((d) => ({ ...d }));
  const add = (url, label, kind) => {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || !/^(?:www\.)?(?:mxb-mods\.com|mxbikes-shop\.com|shop\.mxb-hub\.com)$/.test(u.hostname) || !/^\/(?:downloads\/|product\/)?[^/]+\/?$/.test(u.pathname)) return;
      u.hash = ''; u.search = ''; u.pathname = u.pathname.replace(/\/?$/, '/');
      const existing = found.find((d) => d.url?.replace(/\/$/, '') === u.href.replace(/\/$/, ''));
      const meaningful = !label || /^(here|link|click here|download)$/i.test(label) ? labelFromUrl(u.href) : label;
      if (existing) { if (kind) existing.kind = kind; if (/^(here|link|click here)$/i.test(existing.label)) existing.label = meaningful; }
      else found.push({ url: u.href, label: meaningful, ...(kind ? { kind } : {}) });
    } catch {}
  };
  // Explicit per-download model links supplement a partial Dependencies box.
  for (const d of downloads) if (swapPattern.test(d.label || '')) add(d.url, `${labelFromUrl(d.url)} — model swap`, 'bikeSwap');
  $('p,li').each((_, el) => {
    const text = $(el).text();
    if (!/correct.*models?|requires?|needs?|model[\s_-]*swap|helmet models?/i.test(text)) return;
    $(el).find('a[href]').each((_, a) => add($(a).attr('href'), $(a).text().trim(), swapPattern.test(text) ? 'bikeSwap' : undefined));
    for (const url of text.match(/https?:\/\/[^\s<>"']+/g) || []) add(url.replace(/[).,;]+$/, ''), '', swapPattern.test(text) ? 'bikeSwap' : undefined);
  });
  for (const d of found) if (/^(here|link|click here)$/i.test(d.label)) d.label = labelFromUrl(d.url);
  return found;
}
function forDownload(download, dependencies, downloads) {
  if (download.shop) return [];
  const label = tokens(download.label), scored = dependencies.map((d) => {
    const wanted = tokens(`${d.label} ${labelFromUrl(d.url)}`);
    const hits = [...label].filter((t) => wanted.has(t));
    return { d, score: hits.reduce((sum, t) => sum + (/^\d+$/.test(t) ? 3 : 2), 0), hits };
  }).filter((r) => r.hits.length >= 2 && [...label].filter((t) => /^\d+$/.test(t) && Number(t) < 1900).every((t) => tokens(`${r.d.label} ${labelFromUrl(r.d.url)}`).has(t)));
  if (scored.length) {
    const best = Math.max(...scored.map((r) => r.score));
    return scored.filter((r) => r.score === best).map((r) => r.d);
  }
  const variants = downloads.filter((d) => !d.shop);
  // Ambiguous collections must not assert that every alternate model is needed.
  return variants.length === 1 || dependencies.length === 1 ? dependencies : [];
}
module.exports = { enrich, forDownload, tokens };
