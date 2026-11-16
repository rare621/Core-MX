// Decides whether a model that a listing depends on is already installed.
// Kept free of Electron so it can be unit tested.

const ALIASES = [[/\balpinestars\b|\ba-?stars\b/g, 'astars'], [/\bshift\s*mx\b/g, 'shift'], [/\b100\s*%|\b100percent\b/g, 'hundredpct'], [/\biii\b/g, '3'], [/\bii\b/g, '2']];
const IGNORED = new Set(['free', 'model', 'models', 'mod', 'mods', 'paint', 'paints', 'boot', 'boots', 'helmet', 'helmets', 'rider', 'riders', 'required', 'base', 'the', 'and', 'for', 'with', 'pack', 'new', 'version', 'mxb', 'mxbmods', 'download', 'link', 'here', 'swap', 'modelswap', 'edition', 'update', 'updated', 'fixed', 'fix', 'final', 'release']);

function dependencyKey(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '').toLowerCase(); } catch { return ''; }
}

function normalise(value) {
  let text = String(value || '').toLowerCase().replace(/https?:\/\/[^/\s]+/g, ' ');
  for (const [re, to] of ALIASES) text = text.replace(re, to);
  return text.replace(/\bv(\d)/g, '$1').replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2');
}

function modelTerms(value) {
  return [...new Set(normalise(value).split(/[^a-z0-9]+/).filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !IGNORED.has(t)))];
}

// Which installed-model list a dependency should be looked up in.
function dependencyModelKind(dependency) {
  if (dependency.kind === 'bikeSwap') return 'bikeSwap';
  if (['helmets', 'boots', 'protections', 'riders'].includes(dependency.kind)) return dependency.kind;
  const text = `${dependency.label || ''} ${dependency.url || ''}`.toLowerCase();
  if (/\b(?:boot|boots|instinct|tech[\s-]?(?:7|10)|sg[\s-]?(?:10|12)|atv[\s-]?(?:7|10))\b/.test(text)) return 'boots';
  if (/\b(?:helmet|helmets|lid|atr[\s-]?\d|v[123]|sm[\s-]?\d+|aviator|mips)\b/.test(text)) return 'helmets';
  if (/\b(?:protect(?:ion|or)?s?|chest|roost|neck[\s-]*brace|leatt)\b/.test(text)) return 'protections';
  if (/\b(?:hoodie|rider[\s-]?(?:model|plus|\+)|rider\+|body model|custom rider)\b/.test(text)) return 'riders';
  return null;
}

const isNumber = (t) => /^\d+$/.test(t);

// Score how well an installed folder name matches a dependency, or -1 when it
// must not count (for example a different generation: "Tech 10" vs "tech7").
function scoreModel(name, dependency) {
  const wanted = modelTerms(`${dependency.label || ''} ${dependencyKey(dependency.url || '')}`);
  const have = new Set(modelTerms(name));
  if (!wanted.length || !have.size) return -1;
  const wantedNums = wanted.filter(isNumber), haveNums = [...have].filter(isNumber);
  // Different numbers on both sides mean a different year or generation.
  if (wantedNums.some((n) => !have.has(n)) && haveNums.some((n) => !wantedNums.includes(n))) return -1;
  const hits = wanted.filter((t) => have.has(t)), words = hits.filter((t) => !isNumber(t));
  const declared = dependency.declared ? modelTerms(dependency.label) : [];
  const exactDeclared = declared.length >= 3 && declared.some((t) => !isNumber(t)) && declared.every((t) => have.has(t));
  const shortExact = wanted.length === 2 && hits.length === 2;
  if (!exactDeclared && !shortExact && words.length < 2) return -1;
  const extra = [...have].filter((t) => !wanted.includes(t)).length;
  return (exactDeclared ? 100 : 0) + words.length * 4 + (hits.length - words.length) * 3 - extra;
}

// Best installed match rather than the first plausible one.
function matchingModel(names, dependency) {
  let best = null, bestScore = -1;
  for (const name of names || []) {
    const score = scoreModel(name, dependency);
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return bestScore >= 0 ? best : null;
}

function dependencySearchScore(candidate, dependency) {
  const wanted = modelTerms(dependency.label);
  const available = new Set(modelTerms(candidate.title));
  const hits = wanted.filter((term) => available.has(term)).length;
  const wantedNums = wanted.filter(isNumber), haveNums = [...available].filter(isNumber);
  if (wantedNums.length && haveNums.length && wantedNums.some((n) => !available.has(n)) && haveNums.some((n) => !wantedNums.includes(n))) return 0;
  return hits * 10 - Math.max(0, available.size - hits);
}

// Requirements that are written in the post but would never be a model.
function isModelRequirement(d) {
  const text = `${d.label || ''} ${d.url || ''}`;
  if (/\b(?:psd|template|discord|youtube|tutorial|patreon|paypal|font)\b/i.test(text)) return false;
  return d.kind === 'bikeSwap' || !!d.declared || !!dependencyModelKind(d) || /model|rider|instinct|aviator|sm10|atr.?2/i.test(text);
}

module.exports = { dependencyKey, dependencyModelKind, modelTerms, matchingModel, scoreModel, dependencySearchScore, isModelRequirement };
