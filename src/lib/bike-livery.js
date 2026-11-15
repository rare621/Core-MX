// Conservative name/path matching. This identifies the intended bike, not UV
// compatibility: absent years or author/version details still need review.
const { detectBrand } = require('./scanner');
const PATTERNS = [
  /\b(kx|yz|wr)\s*(\d{2,3})\s*(fx|f|x)?\b/g,
  /\b(crf|cr)\s*(\d{2,3})\s*(rx|r|x)?\b/g,
  /\b(rm\s*z|rm)\s*(\d{2,3})\b/g,
  /\b(fc|tc|fe|te|mc|ec|ex|xxf|xx)\s*(\d{2,3})\b/g,
  /\b(\d{2,3})\s*(sx|xc|exc)\s*(f|w)?\b/g,
  /\b(sx|xc|exc)\s*(f|w)?\s*(\d{2,3})\b/g,
];
function identify(text) {
  const clean = String(text || '').toLowerCase().replace(/[_–—-]/g, ' ');
  const hits = PATTERNS.flatMap((pattern, i) => [...clean.matchAll(pattern)].map((m) => ({
    at: m.index, end: m.index + m[0].length,
    model: (i === 4 ? m[2] + (m[3] || '') + m[1] : i === 5 ? m[1] + (m[2] || '') + m[3] : m.slice(1).filter(Boolean).join('')).replace(/\s/g, '').toUpperCase(),
  })));
  const models = [...new Set(hits.map((h) => h.model))];
  const brand = detectBrand(clean);
  if (models.length !== 1) return { brand, model: null, years: [], ambiguous: models.length > 1 };
  const years = new Set();
  for (const hit of hits) {
    // A race/paint collection's year elsewhere in the title is not a bike year.
    const before = clean.slice(0, hit.at).match(/((?:(?:19|20)\d{2})(?:\s*(?:to|through|\/|,)\s*(?:19|20)\d{2}|\s+(?:19|20)\d{2})*)\s*(?:kawasaki|yamaha|honda|suzuki|ktm|husqvarna|husky|gas\s*gas|fantic)?\s*$/);
    const after = clean.slice(hit.end).match(/^\s*\(?((?:19|20)\d{2}(?:\s*(?:to|through|\/|,)\s*(?:19|20)\d{2}|\s+(?:19|20)\d{2})*)/);
    const yearText = before?.[1] || after?.[1];
    if (yearText) {
      const values = yearText.match(/(?:19|20)\d{2}/g).map(Number);
      // Hyphenated ranges were normalized to spaces above.
      if (values.length === 2 && values[1] > values[0] && values[1] - values[0] <= 15 && !/[,/]/.test(yearText)) for (let y = values[0]; y <= values[1]; y++) years.add(y);
      else values.forEach((y) => years.add(y));
    }
  }
  const version = clean.match(/\boem\s*v(?:ersion)?\s*(\d+(?:\.\d+)+)/)?.[1] || null;
  return { brand, model: models[0], years: [...years], version, ambiguous: false };
}
function requirement(rel, title) {
  const normalized = rel.replace(/\\/g, '/');
  const exact = normalized.match(/(?:^|\/)bikes\/([^/]+)\/paints\/[^/]+\.pnt$/i)?.[1];
  const fromTitle = identify(title);
  const fromFile = normalized.split('/').reverse().map(identify).find((r) => r.model);
  const req = exact ? identify(exact) : fromFile || fromTitle;
  if (!exact && fromFile?.model === fromTitle.model && !req.years.length) req.years = fromTitle.years;
  if (!req.version && req.model === fromTitle.model) req.version = fromTitle.version;
  return { ...req, exact, label: exact || [req.years.join('/'), req.brand, req.model].filter(Boolean).join(' ') || 'Bike not identified' };
}
function compare(req, name) {
  if (req.exact) return req.exact.toLowerCase() === name.toLowerCase() ? 'match' : 'incompatible';
  const bike = identify(name);
  if (req.ambiguous) return 'unknown';
  if (req.brand && bike.brand && req.brand !== bike.brand || req.model && bike.model && req.model !== bike.model) return 'incompatible';
  if (req.years.length && bike.years.length && !req.years.some((year) => bike.years.includes(year))) return 'incompatible';
  if (req.version && bike.version && req.version !== bike.version) return 'incompatible';
  return req.model && bike.model === req.model && req.years.length && bike.years.length && (!req.version || req.version === bike.version) ? 'match' : 'unknown';
}
function resolve(req, models, selected) {
  const candidates = models.map((name) => ({ name, status: compare(req, name) }));
  const matches = candidates.filter((c) => c.status === 'match');
  if (selected) {
    const entry = candidates.find((c) => c.name.toLowerCase() === selected.toLowerCase());
    if (!entry) return { status: 'missing', target: null, message: `Bike mod not installed: ${selected}.` };
    if (entry.status === 'incompatible') return { status: 'incompatible', target: null, message: `Incompatible bike: ${selected}. This livery names ${req.label}. Install the matching bike/year/version.` };
    return { status: entry.status, target: entry.name, message: entry.status === 'match' ? `Bike found: ${req.label}.` : 'Bike year or model version is not fully specified. Check the creator’s instructions before installing.' };
  }
  if (matches.length === 1) return { status: 'match', target: matches[0].name, message: `Bike found: ${req.label}.` };
  if (!models.length || !matches.length && !candidates.some((c) => c.status === 'unknown')) return { status: 'missing', target: null, message: `Bike mod not installed: ${req.label}. This may require an older bike or mod version.` };
  return { status: 'unknown', target: null, message: matches.length > 1 ? `Several bikes match ${req.label}. Choose the creator’s intended bike.` : 'Bike year or model version is not fully specified. Choose the matching bike using the creator’s instructions.' };
}
module.exports = { identify, requirement, compare, resolve };
