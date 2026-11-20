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
  ['tyre', /(?:^|\/)install_e10_wheels\.ps1$/i],
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
  if (names.some((n) => /\.dlo$/i.test(n))) return { kind: 'plugin', reason: 'game-plugin' };
  if (names.some((n) => /(?:^|\/)engine\.scl$/i.test(n)) && names.some((n) => /(?:^|\/)(?:sfx(?:\.cfg)?|samples)(?:\/|$)/i.test(n))) return { kind: 'sound', reason: 'sound-files' };
  let kind = kindFromNames(names);
  if (kind) return { kind, reason: 'files' };
  // Files with one clear place: setups, translations, number fonts, stands and HUD pitboards.
  const content = names.filter((n) => !/\.(txt|md|url|pdf|html?|docx?|rtf|jpe?g|png|webp|gif|psd)$/i.test(n));
  if (content.length && content.every((n) => /\.st[pt]$/i.test(n))) return { kind: 'setup', reason: 'files' };
  if (content.length && content.every((n) => /\.str$/i.test(n))) return { kind: 'translation', reason: 'files' };
  if (names.some((n) => /(?:^|\/)plate\.tga$/i.test(n)) && names.some((n) => /\.ini$/i.test(n))) return { kind: 'bikeFont', reason: 'files' };
  if (names.some((n) => /(?:^|\/)number\.tga$/i.test(n)) && names.some((n) => /(?:^|\/)name\.tga$/i.test(n))) return { kind: 'riderFont', reason: 'files' };
  if (names.some((n) => /(?:^|\/)stand\.edf$/i.test(n)) && !names.some((n) => /\.(pkz|engn|geom)$/i.test(n))) return { kind: 'stand', reason: 'files' };
  if (names.some((n) => /(?:^|\/)misc\/hud\/pitboard[^/]*\.(cfg|tga)$/i.test(n))) return { kind: 'pitboard', reason: 'files' };
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
