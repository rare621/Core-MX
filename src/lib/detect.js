// Guesses what kind of mod a set of files is by looking at signature files inside them
// (used for uploads from the computer, which have no mxb-mods.com category).
const { withZip } = require('./zipread');

const SIGNATURES = [
  ['track', /\.(trh|tsc|rdf|amb|tl)$|(^|\/)track_image\.tga$|(^|\/)track_map\.tga$/i],
  ['helmet', /(^|\/)helmet\.hrc$|(^|\/)c_helmet\.edf$/i],
  ['boots', /(^|\/)(left|right)_boot\.hrc$|(^|\/)boots\.edf$/i],
  ['protection', /(^|\/)protection\.hrc$|(^|\/)protection\.edf$/i],
  ['helmetcam', /(^|\/)gopro\.hrc$/i],
  ['riderModel', /(^|\/)rider\.hrc$|(^|\/)rider\.(anm|edf)$/i],
  ['tyre', /\.tyre$/i],
  ['bike', /\.(engn|geom|scl|susp|chas)$|(^|\/)bike\.hrc$/i],
];

function kindFromNames(names) {
  for (const [kind, re] of SIGNATURES) if (names.some((n) => re.test(n))) return kind;
  return null;
}

// Store packages are often sealed PKZ files, so their internal rider.hrc
// cannot be read until the game loads them.  Recognise the unambiguous model
// names used by the official stores instead of sending a rider model through
// the generic "Other" prompt.
function kindFromPackageName(names) {
  const text = names.map((name) => String(name).replace(/\\/g, '/').split('/').pop()).join(' ').toLowerCase();
  if (/\b(?:rider[-_ ]?(?:hoodie|model|plus)|hoodie[-_ ]?(?:rider|abdesigns)|rider\+)\b/.test(text)) return 'riderModel';
  return null;
}

// files: [{rel, abs}] -> { kind, reason } or { kind: null }
async function detectKind(files) {
  const names = files.map((f) => f.rel);
  let kind = kindFromNames(names);
  if (kind) return { kind, reason: 'files' };
  kind = kindFromPackageName(names);
  if (kind) return { kind, reason: 'package-name' };

  const pkzs = files.filter((f) => /\.pkz$/i.test(f.rel));
  let encrypted = 0;
  for (const f of pkzs) {
    try {
      const inner = await withZip(f.abs, async (entries) => entries.map((e) => e.fileName));
      kind = kindFromNames(inner);
      if (kind) return { kind, reason: 'pkz' };
    } catch { encrypted++; }
  }
  const pnts = files.filter((f) => /\.pnt$/i.test(f.rel)).length;
  if (pkzs.length && encrypted === pkzs.length) return { kind: null, reason: 'encrypted' };
  if (pnts && !pkzs.length) return { kind: null, reason: 'paint' };
  return { kind: null, reason: 'unknown' };
}

module.exports = { detectKind, kindFromPackageName };
