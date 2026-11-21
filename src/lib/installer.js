// Decides where each staged file goes inside mods/, and applies the plan.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { isBodyPaint } = require('./paint-compat');
const layout = require('./rider-layout');
const bikeLivery = require('./bike-livery');

const TRACK_TYPES = ['motocross', 'supercross', 'enduro', 'supermoto'];
const TOP = new Set(['bikes', 'tracks', 'rider', 'tyres', 'misc']);
const RIDER_SUBS = new Set(['helmets', 'boots', 'gloves', 'paints', 'protections', 'goggles', 'riders', 'animations', 'helmetcams', 'fonts']);
const DOC_EXT = /\.(txt|md|pdf|url|html?|jpe?g|png|webp|gif|bmp|mp4|mov|docx?|rtf|psd|lnk|exe)$/i;

// Only kit/glove paints use o.gear (the body). Accessories are shared under rider/.
const KINDS = {
  track:           { label: 'Track', base: (o) => `tracks/${o.trackType || 'motocross'}` },
  bike:            { label: 'Bike', base: () => 'bikes' },
  bikeSwap:        { label: 'Bike model swap (appearance)', base: () => 'bikes', paintModels: () => 'bikes' },
  bikePaint:       { label: 'Bike livery (paint)', base: () => 'bikes', paintModels: () => 'bikes' },
  riderKit:        { label: 'Rider kit (jersey & pants)', base: (o) => `${o.gear}/paints`, loosePnt: (o) => `${o.gear}/paints` },
  gloves:          { label: 'Gloves', base: (o) => `${o.gear}/gloves`, loosePnt: (o) => `${o.gear}/gloves` },
  boots:           { label: 'Boots', base: () => 'rider/boots' },
  bootPaint:       { label: 'Boot paint', base: () => 'rider/boots', paintModels: () => 'rider/boots' },
  helmet:          { label: 'Helmet', base: () => 'rider/helmets' },
  helmetPaint:     { label: 'Helmet paint', base: () => 'rider/helmets', paintModels: () => 'rider/helmets' },
  goggles:         { label: 'Goggles', base: () => 'rider/goggles', loosePnt: () => 'rider/goggles' },
  protection:      { label: 'Chest protector / neck brace', base: () => 'rider/protections' },
  protectionPaint: { label: 'Chest protector paint', base: () => 'rider/protections', paintModels: () => 'rider/protections' },
  helmetcam:       { label: 'Helmet camera', base: () => 'rider/helmetcams' },
  riderModel:      { label: 'Rider model', base: () => 'rider/riders' },
  animation:       { label: 'Rider animation (mods folder)', base: () => 'rider/animations' },
  animationGame:   { label: 'Rider animation (game folder)', base: () => 'rider/animations/mx', root: 'game' },
  tyre:            { label: 'Tyres / wheels', base: () => 'tyres' },
  bikeFont:        { label: 'Bike number font', base: () => 'misc/fonts' },
  riderFont:       { label: 'Rider name & number font', base: () => 'rider/fonts' },
  sound:           { label: 'Bike sound', base: () => 'bikes' },
  setup:           { label: 'Bike setup (profile)', base: () => 'profiles', root: 'user' },
  translation:     { label: 'Game translation (language)', base: () => 'ui', root: 'game' },
  stand:           { label: 'Bike stand (game folder)', base: () => 'misc/stand', root: 'game' },
  pitboard:        { label: 'Pitboard (game folder)', base: () => 'misc/hud', root: 'game' },
  hudTexture:      { label: 'MXBMRP3 HUD textures', base: () => 'mxbmrp3/textures', root: 'user' },
  plugin:          { label: 'Game plugin', base: () => 'plugins', root: 'game' },
  graphics:        { label: 'Graphics mod (game folder)', base: () => '', root: 'game' },
  menuUi:          { label: 'Menu, loading screen or menu background (game folder)', base: () => '', root: 'game' },
  custom:          { label: 'Other (choose folder)', base: (o) => o.customDir || '' },
};
const PAINT_OF = { boots: 'bootPaint', helmet: 'helmetPaint', protection: 'protectionPaint', bike: 'bikePaint' };
const MODEL_OF = Object.fromEntries(Object.entries(PAINT_OF).map(([m, p]) => [p, m]));

// Most specific category first.
const CATEGORY_KIND = [
  [[126], 'bootPaint'], [[343], 'boots'], [[127], 'helmetPaint'], [[313, 34], 'helmet'], [[380], 'goggles'],
  [[135], 'protectionPaint'], [[344], 'protection'], [[365], 'riderModel'], [[519], 'animation'],
  [[31], 'boots'], [[33], 'helmet'], [[36], 'protection'], [[32], 'gloves'],
  [[35, 52, 129, 309, 534], 'riderKit'],
  [[37, 51, 361], 'bikePaint'], [[46], 'sound'], [[45, 179, 304, 463], 'bike'],
  [[22, 360, 122, 173], 'track'],
  [[168, 57], 'menuUi'],
  [[174, 609, 130], 'graphics'],
  [[95], 'tyre'], [[42], 'bikeFont'], [[41], 'riderFont'], [[610], 'setup'], [[351], 'translation'],
  [[366], 'stand'], [[605], 'pitboard'],
  [[30], 'riderKit'], [[29], 'bike'],
];
// Categories whose downloads are files for making mods (paint templates, wheel/tyre textures to pack
// with paintED, 3D models and objects for track builders), not files the game loads.
const RESOURCE_CATEGORIES = [382, 136, 119];
const RESOURCE_EXT = /\.(ttf|otf|woff2?|psd|psb|ai|xcf|kra|sai|blend\d*|fbx|obj|3ds|max|c4d|dae|svg|eps|spp|sbsar|xlsx?|csv)$/i;
const GAME_FILE = /\.(pkz|pnt|dlo|anm|edf|hrc|engn|geom|scl|tyre|str|stp|stt|mnu|amb|map|trk|fnt|arr)$/i;
const STRONG_GAME_FILE = /\.(pkz|pnt|dlo|anm|str|stp|stt|mnu|engn|geom|tyre)$/i;
const NOT_CONTENT = /\.(txt|md|url|pdf|html?|docx?|rtf|lnk|jpe?g|png|webp|gif|bmp|mp4|mov)$|(?:^|\/)(?:license|licence|readme|changelog|notice|authors|credits|copying)$/i;

// What a download is before it is placed in a game folder:
//   'app'   - a program in an archive (an .exe and no game files): saved to Downloads, run from Apps
//   'files' - files for making mods (fonts, PSD templates, 3D models): saved to Downloads
//   null    - a mod: planned and installed into the game.
function packageKind(files, categories = []) {
  const content = files.filter((f) => !NOT_CONTENT.test(f.rel));
  if (!content.length) return null;
  if (content.some((f) => /\.exe$/i.test(f.rel)) && !content.some((f) => GAME_FILE.test(f.rel) || /(?:^|\/)(?:mods|misc|ui|plugins|bikes|tracks|rider|tyres)\//i.test(f.rel))) return 'app';
  if (content.every((f) => RESOURCE_EXT.test(f.rel))) return 'files';
  if (categories.some((c) => RESOURCE_CATEGORIES.includes(c)) && !content.some((f) => STRONG_GAME_FILE.test(f.rel) || /(?:^|\/)mods\//i.test(f.rel))) return 'files';
  return null;
}

// Several alternatives for the same place (a pack of stands or pitboards, one folder per brand):
// only one can be used, so the player chooses. dests: rel -> destination (null = not copied,
// undefined = no known place). Returns the variant folders, and edits dests so that files of the
// other variants are not copied (or wait for the choice when none is chosen yet).
function pickVariant(dests, chosen) {
  const byDest = new Map();
  for (const [rel, d] of dests) if (d) { const k = d.toLowerCase(); if (!byDest.has(k)) byDest.set(k, []); byDest.get(k).push(rel); }
  const clashes = [...byDest.values()].filter((rels) => rels.length > 1);
  if (!clashes.length) return { variants: [], variant: null, waiting: false, other: new Set() };
  const prefixes = new Set();
  for (const rels of clashes) {
    const parts = rels.map((r) => r.split('/'));
    let i = 0;
    while (parts.every((p) => i < p.length - 1 && p[i] === parts[0][i])) i++;
    for (const p of parts) if (i < p.length - 1) prefixes.add(p.slice(0, i + 1).join('/'));
  }
  const list = [...prefixes].filter((p) => ![...prefixes].some((q) => q !== p && p.startsWith(q + '/'))).sort((a, b) => a.localeCompare(b));
  const owner = (rel) => list.find((p) => rel.startsWith(p + '/'));
  const variant = list.includes(chosen) ? chosen : null, other = new Set();
  if (list.length > 1) {
    for (const [rel, d] of dests) {
      const own = owner(rel);
      if (!own || d === null) continue;
      if (!variant) dests.set(rel, undefined);
      else if (own !== variant) { dests.set(rel, null); other.add(rel); }
    }
  }
  // Anything still clashing (inside one variant, or files at the same place without folders) is left to the player.
  const seen = new Map();
  for (const [rel, d] of dests) if (d) seen.set(d.toLowerCase(), (seen.get(d.toLowerCase()) || 0) + 1);
  for (const [rel, d] of dests) if (d && seen.get(d.toLowerCase()) > 1) dests.set(rel, undefined);
  const label = (p) => { const last = p.split('/').pop(); return list.filter((q) => q.split('/').pop() === last).length > 1 ? p : last; };
  return { variants: list.length > 1 ? list.map((id) => ({ id, label: label(id) })) : [], variant, waiting: list.length > 1 && !variant, other };
}

const DESIGN_SKIP = /\.(txt|md|url|pdf|html?|docx?|rtf|lnk|jpe?g|png|webp|gif|bmp|bat|cmd|ps1|vbs|exe|dll|msi|json|pdb|psd|psb|xcf|ai|xlsx?|blend\d*|fbx|ttf|otf)$|(?:^|\/)(?:license|licence|readme|changelog|notice|authors|credits)$/i;
// Bike stands: the game's stand lives in misc/stand (stand.edf, stand_s.edf, stand.ini, gfx.cfg).
// Creators: copy the "stand" folder into MX Bikes/misc. Its look comes from a bike paint (Stand_Tex
// packed into the .pnt), so loose textures for paint packing are not copied.
function standDestinations(files) {
  const out = new Map();
  for (const f of files) {
    const segs = f.rel.split('/'), l = segs.map((s) => s.toLowerCase()), fname = segs[segs.length - 1];
    let dest = null;
    const misc = l.lastIndexOf('misc'), stand = l.slice(0, -1).lastIndexOf('stand');
    if (DESIGN_SKIP.test(f.rel) || /\.pnt$/i.test(fname)) dest = null;
    else if (misc >= 0 && misc < segs.length - 1) dest = ['misc', ...segs.slice(misc + 1)].join('/');
    else if (stand >= 0) dest = ['misc/stand', ...segs.slice(stand + 1)].join('/');
    else if (/^(stand(_s)?\.edf|stand\.ini|gfx\.cfg)$/i.test(fname)) dest = `misc/stand/${fname}`;
    out.set(f.rel, dest);
  }
  return out;
}
// HUD pitboards (MX Bikes/misc/hud: pitboard.cfg, pitboard.tga, PitboardFontsNumbers.*). Creators:
// "move the misc folder into your MX Bikes directory (where mxbikes.exe is)". A trackside board's
// .pnt belongs in mods/misc/pitboard instead, so it is not part of this (game folder) install.
function pitboardDestinations(files) {
  const out = new Map();
  // A board without the game's folders is the HUD board (misc/hud), unless it is the trackside one:
  // it has a 3D pitboard.edf or a trackside pitboard.cfg (texture = w_pitboard, handgrip...), and those
  // files belong in misc/pitboard (a trackside .cfg in misc/hud would break the HUD board).
  const trackside = files.some((f) => /\.edf$/i.test(f.rel)) || files.some((f) => {
    if (!/(?:^|\/)pitboard[^/]*\.cfg$/i.test(f.rel) || !f.abs) return false;
    try { return /handgrip|texture\s*=\s*w_pitboard/i.test(fs.readFileSync(f.abs, 'latin1').slice(0, 4000)); } catch { return false; }
  });
  for (const f of files) {
    const segs = f.rel.split('/'), l = segs.map((s) => s.toLowerCase()), fname = segs[segs.length - 1];
    const misc = l.slice(0, -1).lastIndexOf('misc');
    let dest;
    if (DESIGN_SKIP.test(f.rel) || /\.pnt$/i.test(fname)) dest = null;
    else if (misc >= 0) dest = ['misc', ...segs.slice(misc + 1)].join('/');
    else if (/\.edf$/i.test(fname)) dest = `misc/pitboard/${fname}`;
    else if (/\.(cfg|tga|arr)$/i.test(fname)) dest = `misc/${trackside ? 'pitboard' : 'hud'}/${fname}`;
    out.set(f.rel, dest);
  }
  return out;
}
// The E10 Factory Bike Pack wheel fix ships only a PowerShell script that copies the game's own
// stock wheel files (tyres.pkz, tyres/p_mx) into mods/tyres/Factory_tyre. CoreMX never runs scripts,
// so it copies the same files itself.
const SCRIPT_RECIPES = [
  { match: /(?:^|\/)install_e10_wheels\.ps1$/i, kind: 'tyre', copies: ['gfx.cfg', 'fwheel.hrc', 'rwheel.hrc', 'p_mx.edf', 'p_mx_s.edf', 'p_mx_as.edf', 'c_p_mx.edf'].map((n) => ({ pkz: 'tyres.pkz', inner: `tyres/p_mx/${n}`, dest: `tyres/Factory_tyre/${n}` })) },
];
const STOCK_TYRES = ['p_mx', 'm_sm'];

// Menus, loading screens and menu backgrounds (MXB Mods "UI" and "Menu Backgrounds"). They only
// work in the game install folder (creators: "not in mods"): menu files (.mnu, their tiles/ images,
// bkgrnd.tga, splash.tga) go in MX Bikes/ui, a menu background scene in MX Bikes/misc/bg (bg.map,
// bg.amb) or MX Bikes/misc/bg.pkz. Returns rel -> destination, null (readme, preview, launcher: not
// copied) or undefined (no known place, or two files for one place: the player chooses).
const MENU_SKIP = /\.(txt|md|url|pdf|html?|docx?|rtf|lnk|jpe?g|png|webp|gif|bat|cmd|exe|ps1|vbs|msi)$/i;
function menuDestinations(files) {
  const out = new Map();
  const split = (rel) => rel.split('/');
  // A folder holding a .mnu file is a copy of MX Bikes/ui (any wrapper folders above it are dropped).
  const mnuDirs = files.filter((f) => /\.mnu$/i.test(f.rel)).map((f) => split(f.rel).slice(0, -1).map((s) => s.toLowerCase()));
  for (const f of files) {
    const segs = split(f.rel), l = segs.map((s) => s.toLowerCase()), fname = segs[segs.length - 1], lname = fname.toLowerCase();
    if (MENU_SKIP.test(fname)) { out.set(f.rel, null); continue; }
    const at = (name) => { const i = l.indexOf(name); return i >= 0 && i < segs.length - 1 ? i : -1; };
    let dest;
    if (at('misc') >= 0) dest = ['misc', ...segs.slice(at('misc') + 1)].join('/');
    else if (at('ui') >= 0) dest = ['ui', ...segs.slice(at('ui') + 1)].join('/');
    else if (/^bg\.(map|amb)$/.test(lname)) dest = `misc/bg/${lname}`;
    else if (lname === 'bg.pkz') dest = 'misc/bg.pkz';
    else if (at('bg') >= 0) dest = ['misc', ...segs.slice(at('bg'))].join('/');
    else {
      const root = mnuDirs.filter((d) => d.every((s, i) => l[i] === s) && d.length < segs.length).sort((a, b) => a.length - b.length)[0];
      if (root) dest = ['ui', ...segs.slice(root.length)].join('/');
      else if (/^(bkgrnd|splash)\.tga$/.test(lname)) dest = `ui/${lname}`;
    }
    out.set(f.rel, dest);
  }
  const uses = new Map();
  for (const d of out.values()) if (d) uses.set(d.toLowerCase(), (uses.get(d.toLowerCase()) || 0) + 1);
  for (const [rel, d] of out) if (d && uses.get(d.toLowerCase()) > 1) out.set(rel, undefined);
  return out;
}

function kindFromCategories(cats = []) {
  for (const [ids, kind] of CATEGORY_KIND) if (ids.some((id) => cats.includes(id))) return kind;
  return 'custom';
}

function guessTrackType(text) {
  if (/\b(supercross|sx|arenacross|ax)\b/i.test(text)) return 'supercross';
  if (/\benduro\b/i.test(text)) return 'enduro';
  if (/\b(supermoto|sm)\b/i.test(text)) return 'supermoto';
  return 'motocross';
}

function tokens(s) {
  return String(s).toLowerCase().replace(/oem/g, ' ').split(/[^a-z0-9]+/).filter((t) => t && !['mx1', 'mx2', 'the', 'by', 'for', 'and', 'kit', 'paint', 'livery', 'pnt'].includes(t));
}

// Picks the installed model (bike/helmet/...) a paint most likely belongs to.
function guessModel(models, text) {
  const tt = new Set(tokens(text));
  let best = null, bestScore = 0;
  for (const m of models) {
    const mt = tokens(m);
    if (!mt.length) continue;
    let score = 0;
    for (const t of mt) {
      if (!tt.has(t)) continue;
      score += /^\d{4}$/.test(t) ? 1 : /\d/.test(t) ? 3 : 2;
    }
    score = score / Math.sqrt(mt.length);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return bestScore >= 2 ? best : null;
}

// Setup posts name the bike loosely ("YZ450 SETUP" for MX1OEM_2023_Yamaha_YZ450F): match model
// codes by prefix. Several matching bikes (years): the newest is suggested; the player confirms.
function guessSetupBike(bikes, title) {
  const codes = tokens(title).filter((t) => /[a-z]/.test(t) && /\d/.test(t) && t.length >= 4);
  if (!codes.length) return null;
  const hits = bikes.filter((b) => tokens(b).some((bt) => /\d/.test(bt) && /[a-z]/.test(bt) && codes.some((c) => bt.startsWith(c) || c.startsWith(bt) && bt.length >= 4)));
  const year = (b) => Number((b.match(/(?:^|_)((?:19|20)\d\d)(?:_|$)/) || [])[1] || 0);
  return hits.sort((a, b) => year(b) - year(a))[0] || null;
}

function listModels(modsDir, rel) {
  try {
    const names = new Set();
    for (const e of fs.readdirSync(path.join(modsDir, rel), { withFileTypes: true })) {
      if (e.isDirectory() && modelExists(path.join(modsDir, rel, e.name))) names.add(e.name);
      else if (/\.pkz$/i.test(e.name)) names.add(e.name.slice(0, -4));
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

function modelExists(dir) {
  if (fs.existsSync(dir + '.pkz')) return true;
  try { return fs.readdirSync(dir).some((name) => /\.(edf|hrc|engn|geom|trh)$/i.test(name)); } catch { return false; }
}

const COLLECTION_DIRS = new Set(['gear', 'gears', 'paint', 'paints', 'files', 'file', 'mod', 'mods', 'download', 'downloads']);
// A few older releases bundle a coordinated kit in one archive but do not
// include a mods/ folder.  Their folder names are still meaningful: Gear is
// a body paint, Gloves is a loose glove paint, and a model-named folder is a
// paint for that exact accessory.  Keep those pieces independent instead of
// forcing the entire archive into whichever website category was clicked.
function mixedGearDestination(segs, lsegs, fname, o, kind) {
  const at = (name) => lsegs.lastIndexOf(name);
  const gearAt = Math.max(at('gear'), at('gears'));
  if (gearAt >= 0 && gearAt < segs.length - 1) return `${o.gear}/paints/${fname}`;
  const glovesAt = at('gloves');
  if (glovesAt >= 0 && glovesAt < segs.length - 1) return `${o.gear}/gloves/${fname}`;
  for (const [folder, target] of [['helmets', 'rider/helmets'], ['boots', 'rider/boots'], ['protections', 'rider/protections']]) {
    const index = at(folder);
    if (index >= 0 && index + 1 < segs.length - 1) return `${target}/${segs[index + 1]}/paints/${fname}`;
  }
  // For a mixed archive opened from the Boot Paint category, a direct parent
  // such as 2018_alpinestars_sm_10 is the boot model name.  Do not replace it
  // with a selected, unrelated boot model.
  if (kind === 'bootPaint' && segs.length >= 2) {
    const model = segs[segs.length - 2];
    if (model && !COLLECTION_DIRS.has(String(model).toLowerCase())) return `rider/boots/${model}/paints/${fname}`;
  }
  return null;
}

// files: [{rel, abs, size}], ctx: {categories, title, modsDir}, opts: overrides {kind, trackType, paintTarget, customDir}
function plan(files, ctx, opts = {}) {
  const modsDir = ctx.modsDir;
  const text = [ctx.title || '', ...files.map((f) => f.rel)].join(' ');
  const hasPkz = files.some((f) => /\.pkz$/i.test(f.rel));
  const hasPnt = files.some((f) => /\.pnt$/i.test(f.rel));

  // A .dlo is an MX Bikes game plugin regardless of the website's category
  // or an older review's saved "Graphics" choice.
  // A category CoreMX has no type for ("Other", "Bikelife", "Modpacks", ...) uses what was found
  // inside the files (ctx.kindHint), like an upload from the computer.
  const catKind = kindFromCategories(ctx.categories);
  const recipe = SCRIPT_RECIPES.find((r) => files.some((f) => r.match.test(f.rel)));
  let kind = files.some((f) => /\.dlo$/i.test(f.rel)) ? 'plugin' : opts.kind || recipe?.kind || ((!ctx.categories || !ctx.categories.length || catKind === 'custom') && ctx.kindHint) || catKind;
  let autoKind = !opts.kind;
  const visualBikeFiles = files.some((f) => /\.edf$/i.test(f.rel)) && !files.some((f) => /\.(engn|geom)$/i.test(f.rel));
  if (autoKind && visualBikeFiles && (kind === 'bike' || files.some((f) => /(?:^|\/)bikes\//i.test(f.rel)) || /model[\s_-]*swap/i.test(text + ' ' + (ctx.categoryNames || []).join(' ')))) kind = 'bikeSwap';
  if (autoKind && !recipe) {
    const content = files.filter((f) => !NOT_CONTENT.test(f.rel));
    // Paints posted under Fonts or Stands are a bike livery / rider kit (a stand's look is a bike paint).
    if ((kind === 'bikeFont' || kind === 'riderFont') && hasPnt && !files.some((f) => /(?:^|\/)(?:plate|number|name)\.tga$/i.test(f.rel))) kind = kind === 'bikeFont' ? 'bike' : 'riderKit';
    else if (kind === 'stand' && hasPnt && !files.some((f) => /\.edf$/i.test(f.rel))) kind = 'bike';
    // Pitboards for the MXBMRP3 plugin are numbered HUD textures (pitboard_hud_100.tga).
    else if (kind === 'pitboard' && content.length && content.every((f) => /(?:^|\/)[a-z0-9]+(?:_[a-z0-9]+)*_\d+\.tga$/i.test(f.rel))) kind = 'hudTexture';
    // Paints in a category without a type ("Bikelife", "Other") that name a bike are a livery.
    else if (kind === 'custom' && content.length && content.every((f) => /\.pnt$/i.test(f.rel)) && content.every((f) => { const r = bikeLivery.requirement(f.rel, ctx.title); return r && r.brand && r.model && !r.ambiguous; })) kind = 'bikePaint';
    // Wheels posted as a bike: a .pkz named like a tyre set (p_mx, m_sm or an installed one).
    else if (kind === 'bike' && hasPkz && !hasPnt) {
      const tyreNames = new Set([...STOCK_TYRES, ...listModels(modsDir, 'tyres').map((n) => n.toLowerCase())]);
      if (files.filter((f) => /\.pkz$/i.test(f.rel)).every((f) => tyreNames.has(path.posix.basename(f.rel).slice(0, -4).toLowerCase()))) kind = 'tyre';
    }
  }
  if (autoKind) {
    if (PAINT_OF[kind] && !hasPkz && hasPnt) kind = PAINT_OF[kind];
    else if (MODEL_OF[kind] && hasPkz && !hasPnt) kind = MODEL_OF[kind];
  }
  const K = KINDS[kind] || KINDS.custom;
  const mixedGear = hasPnt && files.some((f) => /(?:^|\/)(?:gear|gears|gloves)(?:\/|$)/i.test(f.rel));
  // Do not infer layout from existing folders: earlier versions could create them incorrectly.
  const modern = true;
  const bodyPaintFiles = ctx.paintTextures ? Object.keys(ctx.paintTextures).filter((rel) => isBodyPaint(rel, ctx.paintTextures[rel], kind)) : kind === 'riderKit' ? ctx.bodyPaintFiles || [] : ctx.knownBodyPaintFiles || [];
  const bodyTextures = ctx.paintTextures ? [...new Set(bodyPaintFiles.flatMap((rel) => ctx.paintTextures[rel] || []))] : ctx.bodyPaintTextures || [];
  const riderModels = (ctx.riderModels || []).map((m) => ({ ...m, compatible: bodyTextures.every((t) => m.textures.some((n) => n.toLowerCase() === t.toLowerCase())) }));
  const compatibleRiders = riderModels.filter((m) => m.compatible);
  const riderTarget = opts.riderTarget || compatibleRiders.find((m) => m.name === 'default_mx')?.name || (compatibleRiders.length === 1 ? compatibleRiders[0].name : null);
  const needsRiderTarget = bodyTextures.length > 0 && !riderModels.some((m) => m.name === riderTarget && (m.compatible || m.unverified && opts.riderTarget));
  const showRiderTarget = bodyTextures.length > 0 && (needsRiderTarget || !riderModels.some((m) => m.name === 'default_mx' && m.compatible) || opts.riderTarget && opts.riderTarget !== 'default_mx');
  const o = {
    trackType: opts.trackType || guessTrackType(text),
    paintTarget: opts.paintTarget || null,
    customDir: opts.customDir != null ? opts.customDir : '',
    soundBike: listModels(modsDir, 'bikes').includes(opts.soundBike) ? opts.soundBike : '',
    gear: modern ? `rider/riders/${riderTarget || 'default_mx'}` : 'rider', riderTarget,
  };
  const base = K.base(o);
  const paintModelsDir = K.paintModels ? K.paintModels(o) : PAINT_OF[kind] && hasPnt ? base : null;
  const loosePntDir = K.loosePnt ? K.loosePnt(o) : null;
  const lowerSet = new Set(files.map((f) => f.rel.toLowerCase()));
  const pkzBases = new Set(files.filter((f) => /\.pkz$/i.test(f.rel)).map((f) => path.posix.basename(f.rel).slice(0, -4).toLowerCase()));
  const installedInBase = new Set(listModels(modsDir, base).map((n) => n.toLowerCase()));
  const bikeRequirements = new Map(files.filter((f) => /\.pnt$/i.test(f.rel) && (paintModelsDir === 'bikes' || /(?:^|\/)bikes\/[^/]+\/paints\//i.test(f.rel))).map((f) => [f.rel, bikeLivery.requirement(f.rel, ctx.title)]));
  const bikeModels = bikeRequirements.size ? [...new Set([...listModels(modsDir, 'bikes'), ...files.filter((f) => /(?:^|\/)bikes\/[^/]+\.pkz$/i.test(f.rel) || base === 'bikes' && /\.pkz$/i.test(f.rel)).map((f) => path.posix.basename(f.rel).slice(0, -4))])] : [];
  const bikeMatches = new Map([...bikeRequirements].map(([rel, req]) => [rel, bikeLivery.resolve(req, bikeModels, opts.paintTarget)]));
  const bikeTargetChecks = bikeModels.map((name) => ({ name, status: [...bikeRequirements.values()].some((req) => bikeLivery.compare(req, name) === 'incompatible') ? 'incompatible' : [...bikeRequirements.values()].every((req) => bikeLivery.compare(req, name) === 'match') ? 'match' : 'unknown' }));

  let paintModels = [];
  let paintGuess = null;
  if (paintModelsDir) {
    const incoming = [...new Set(files.filter((f) => /\.pkz$/i.test(f.rel)).map((f) => path.posix.basename(f.rel).slice(0, -4)))];
    paintModels = [...new Set([...listModels(modsDir, paintModelsDir), ...incoming])].sort((a, b) => a.localeCompare(b));
    if (paintModelsDir === 'bikes') {
      const targets = [...bikeMatches.values()].map((result) => result.target);
      if (!o.paintTarget && !opts.requirePaintTarget && targets.length && targets.every((target) => target && target === targets[0])) { o.paintTarget = targets[0]; paintGuess = 'bike-match'; }
      else if (o.paintTarget) paintGuess = 'user';
    } else if (!o.paintTarget && !opts.requirePaintTarget) {
      // model named in archive paths?
      const pathHit = files.map((f) => f.rel.split('/').find((s) => paintModels.some((m) => m.toLowerCase() === s.toLowerCase()))).find(Boolean);
      if (pathHit) { o.paintTarget = paintModels.find((m) => m.toLowerCase() === pathHit.toLowerCase()); paintGuess = 'path'; }
      else if (incoming.length === 1) { o.paintTarget = incoming[0]; paintGuess = 'bundle'; }
      else { const g = guessModel(paintModels, text); if (g) { o.paintTarget = g; paintGuess = 'title'; } }
    } else paintGuess = 'user';
  }
  // Setups: profiles/<profile>/setups/common/<bike>/<name>.stp (where MX Bikes saves them). A setup
  // without that folder layout is for the bike named in its folders, else the bike the player picks
  // (suggested from the mod name).
  const userRoot = K.root === 'user';
  const setupBikes = kind === 'setup' ? listModels(modsDir, 'bikes') : [];
  const setupBikeFor = (segs) => segs.slice(0, -1).reverse().map((s) => setupBikes.find((b) => b.toLowerCase() === s.toLowerCase())).find(Boolean);
  const setupRest = (segs) => {
    const si = segs.map((s) => s.toLowerCase()).lastIndexOf('setups');
    return si >= 0 && segs.length - si - 1 >= 3 ? segs.slice(si + 1) : null;
  };
  if (kind === 'setup') {
    paintModels = setupBikes;
    if (opts.paintTarget && setupBikes.includes(opts.paintTarget)) paintGuess = 'user';
    else {
      o.paintTarget = null;
      const needsBike = files.some((f) => /\.st[pt]$/i.test(f.rel) && !setupRest(f.rel.split('/')) && !setupBikeFor(f.rel.split('/')));
      if (needsBike && !opts.requirePaintTarget) { const g = guessSetupBike(setupBikes, ctx.title || '') || guessModel(setupBikes, text); if (g) { o.paintTarget = g; paintGuess = 'title'; } }
    }
  }

  const entries = [];
  // Graphics mods (ReShade, presets, overhauls) go in the game install folder, keeping the archive layout
  // minus a single wrapper folder. Never auto-installed: always shown for review first.
  const gameRoot = K.root === 'game';
  let strip = 0;
  if (gameRoot) {
    const tops = new Set(files.map((f) => f.rel.split('/')[0].toLowerCase()));
    const only = [...tops][0];
    if (tops.size === 1 && files.every((f) => f.rel.includes('/')) && !/^(reshade-shaders|reshade-presets|plugins|ui|shaders|textures)$/.test(only)) strip = 1;
  }
  // Tracks often ship a rider copy and a dedicated-server copy with the same file name, the server
  // one inside a "server" folder (e.g. havoc/Havoc Raceway.pkz + havoc/server/Havoc Raceway.pkz).
  // Both would land on the same path, so skip the server copy whenever the rider copy is present.
  const SERVER_DIR = /^(?:servers?|dedicated|dedi|server[ _-]?(?:files?|version|only|side))$/i;
  const isServerCopy = (rel) => rel.split('/').slice(0, -1).some((s) => SERVER_DIR.test(s));
  const riderNames = new Set(files.filter((f) => !isServerCopy(f.rel)).map((f) => f.rel.split('/').pop().toLowerCase()));
  // A plugin archive that has a "plugins" folder (often next to an "Auto Install" setup program)
  // installs what is inside that folder only, so the setup is never copied. (A program inside a
  // plugin's own folder, like MXB Damage's updater, belongs to the plugin and is kept.) A plugin's
  // existing settings (.ini / .cfg) are kept when it is updated.
  const pluginsAt = (rel) => rel.split('/').findIndex((seg, i, all) => i < all.length - 1 && seg.toLowerCase() === 'plugins');
  const hasPluginsFolder = kind === 'plugin' && files.some((f) => pluginsAt(f.rel) >= 0);
  // Some plugins ship one .dlo per PiBoSo game (MXBMRP3: mxbmrp3.dlo for MX Bikes, mxbmrp3_gpb.dlo for
  // GP Bikes, mxbmrp3_krp.dlo for Kart Racing Pro). Only the MX Bikes one goes in; the others are for
  // other games and are not copied.
  const otherGame = (rel) => kind === 'plugin' && /_(gpb|krp|wrs)\.dl[oi]$/i.test(rel) && files.some((x) => /\.dlo$/i.test(x.rel) && !/_(gpb|krp|wrs)\.dl[oi]$/i.test(x.rel));
  const menuDest = kind === 'menuUi' ? menuDestinations(files) : null;
  // Translations: MX Bikes/ui/<language>.str; the language is chosen per profile in game.
  const special = kind === 'stand' ? standDestinations(files) : kind === 'pitboard' ? pitboardDestinations(files)
    : kind === 'translation' ? new Map(files.map((f) => [f.rel, /\.str$/i.test(f.rel) ? `ui/${path.posix.basename(f.rel)}` : null])) : null;
  const pick = special ? pickVariant(special, opts.variant) : { variants: [], variant: null, waiting: false, other: new Set() };
  if (pick.variant) o.variant = pick.variant;
  const tyreDirs = new Set(files.filter((f) => /\.tyre$/i.test(f.rel)).map((f) => path.posix.dirname(f.rel).toLowerCase()));
  const fontDirs = new Set(files.filter((f) => /(?:^|\/)(?:plate|number|name)\.tga$/i.test(f.rel)).map((f) => path.posix.dirname(f.rel).toLowerCase()));
  for (const f of files) {
    if (special) {
      const dest = special.get(f.rel);
      const status = dest === null ? 'skip' : dest === undefined ? 'unresolved' : ctx.installDir && fs.existsSync(path.join(ctx.installDir, dest)) ? 'overwrite' : 'new';
      const how = dest ? kind : pick.other.has(f.rel) ? 'other-variant' : dest === null ? (/\.pnt$/i.test(f.rel) ? 'paint-elsewhere' : 'doc') : pick.waiting ? 'choose-variant' : 'unknown';
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: dest || null, status, how });
      continue;
    }
    if (userRoot) {
      const segs = f.rel.split('/'), fname = segs[segs.length - 1];
      let dest = null, how = 'user';
      if (kind === 'hudTexture' && /\.tga$/i.test(fname)) dest = `mxbmrp3/textures/${fname}`;
      else if (kind === 'setup' && /\.st[pt]$/i.test(fname)) {
        const bike = setupBikeFor(segs) || o.paintTarget;
        const rest = setupRest(segs) || (bike ? ['common', bike, fname] : null);
        dest = ctx.profile && rest ? ['profiles', ctx.profile, 'setups', ...rest].join('/') : null;
        how = setupRest(segs) ? 'structure' : setupBikeFor(segs) ? 'setup-bike' : 'setup';
      }
      const status = dest ? (ctx.userDir && fs.existsSync(path.join(ctx.userDir, dest)) ? 'overwrite' : 'new') : NOT_CONTENT.test(f.rel) || DOC_EXT.test(fname) || !/\.(st[pt]|tga)$/i.test(fname) ? 'skip' : 'unresolved';
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest, status, how: dest ? how : status === 'skip' ? 'doc' : how });
      continue;
    }
    if (hasPluginsFolder) {
      const at = pluginsAt(f.rel), segs = f.rel.split('/');
      const dest = at < 0 ? null : ['plugins', ...segs.slice(at + 1)].join('/');
      const exists = dest && ctx.installDir && fs.existsSync(path.join(ctx.installDir, dest));
      const keep = exists && /\.(ini|cfg)$/i.test(dest);
      if (otherGame(f.rel)) { entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: null, status: 'skip', how: 'other-game' }); continue; }
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: keep ? null : dest, status: !dest || keep ? 'skip' : exists ? 'overwrite' : 'new', how: keep ? 'keep-settings' : 'game' });
      continue;
    }
    if (!gameRoot && isServerCopy(f.rel) && riderNames.has(f.rel.split('/').pop().toLowerCase())) {
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: null, status: 'skip', how: 'server-copy' });
      continue;
    }
    if (menuDest) {
      const dest = menuDest.get(f.rel);
      const status = dest === null ? 'skip' : dest === undefined ? 'unresolved' : ctx.installDir && fs.existsSync(path.join(ctx.installDir, dest)) ? 'overwrite' : 'new';
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: dest || null, status, how: dest ? 'menu' : dest === null ? 'doc' : 'menu-unknown' });
      continue;
    }
    if (gameRoot) {
      const segs = f.rel.split('/').slice(strip);
      const fname = segs[segs.length - 1];
      const skip = otherGame(f.rel) || segs.length === 1 && (/\.(txt|md|url|pdf|html?|docx?|rtf|lnk|jpe?g|png|webp|gif)$/i.test(fname) || /^(license|licence|readme|changelog|notice|authors|credits|copying)$/i.test(fname));
      const dest = kind === 'animationGame' ? (/\.anm$/i.test(fname) ? `rider/animations/mx/${fname}` : null)
        : skip ? null : kind === 'plugin' ? (segs[0].toLowerCase() === 'plugins' ? segs.join('/') : ['plugins', ...segs].join('/')) : segs.join('/');
      const status = !dest ? 'skip' : ctx.installDir && fs.existsSync(path.join(ctx.installDir, dest)) ? 'overwrite' : 'new';
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest, status, how: 'game' });
      continue;
    }
    const segs = f.rel.split('/');
    const lsegs = segs.map((s) => s.toLowerCase());
    const fname = segs[segs.length - 1];
    let dest = null, how = '';
    if (ctx.relocate && /\.pnt$/i.test(fname) && !bikeRequirements.has(f.rel)) {
      if (paintModelsDir && o.paintTarget) dest = `${paintModelsDir}/${o.paintTarget}/${kind === 'goggles' ? 'goggles' : 'paints'}/${fname}`;
      else if (loosePntDir && !needsRiderTarget) dest = `${loosePntDir}/${fname}`;
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest, status: !dest ? 'unresolved' : fs.existsSync(path.join(modsDir, dest)) ? 'overwrite' : 'new', how: 'relocate' });
      continue;
    }

    // 1) Archive already contains the mods/ structure
    const mi = lsegs.lastIndexOf('mods');
    if (mi >= 0 && mi < segs.length - 1) {
      let rest = segs.slice(mi + 1);
      if (rest[0].toLowerCase() === 'tracks' && rest.length > 1 && !TRACK_TYPES.includes(rest[1].toLowerCase())) rest = ['tracks', o.trackType, ...rest.slice(1)];
      dest = rest.join('/'); how = 'structure';
    }
    if (!dest) {
      const ti = lsegs.findIndex((s, i) => TOP.has(s) && i < segs.length - 1);
      if (ti >= 0) {
        let rest = segs.slice(ti);
        if (lsegs[ti] === 'tracks' && !TRACK_TYPES.includes(lsegs[ti + 1])) rest = ['tracks', o.trackType, ...segs.slice(ti + 1)];
        dest = rest.join('/'); how = 'structure';
      }
    }
    // Mixed apparel bundles have explicit folder cues.  Apply this before
    // generic paint placement so a whole kit is never redirected into one
    // arbitrary boot/helmet model selected by the user.
    if (!dest && mixedGear && /\.pnt$/i.test(fname)) {
      const routed = mixedGearDestination(segs, lsegs, fname, o, kind);
      if (routed) { dest = routed; how = 'mixed-gear'; }
    }
    // Paints bundled next to a new model belong to that model, not rider-kit paints.
    if (!dest && paintModelsDir && /\.pnt$/i.test(fname) && o.paintTarget && ['paints', 'goggles'].includes(lsegs[0])) {
      dest = `${paintModelsDir}/${o.paintTarget}/${lsegs[0]}/${fname}`; how = 'paint';
    }
    if (!dest && base.startsWith('rider')) {
      const ri = lsegs.findIndex((s, i) => RIDER_SUBS.has(s) && i < segs.length - 1 && (i === 0 || (s !== 'paints' && s !== 'goggles')));
      if (ri >= 0) {
        // 'riders/<model>/...' is already the full modern path under rider/
        dest = (lsegs[ri] === 'riders' ? ['rider', ...segs.slice(ri)] : [o.gear, ...segs.slice(ri)]).join('/');
        how = 'structure';
      }
    }
    // 2) A model/track file or folder
    // Loose sound files are a replacement for one selected bike. Archives
    // with an explicit mods/bikes layout were already routed above.
    if (!dest && kind === 'sound' && !DOC_EXT.test(fname)) {
      if (o.soundBike) {
        const start = lsegs.findIndex((s) => /^(?:engine\.scl|sfx(?:\.cfg)?|samples)$/i.test(s));
        const relative = start >= 0 ? segs.slice(start).join('/') : fname;
        // Packs may ship 250 and 450 variants together. Never copy both over
        // one bike's sound files or silently choose the wrong displacement.
        const variant = lsegs.slice(0, Math.max(0, start)).map((s) => s.match(/(?:^|\D)(125|250|350|450|500)(?:f)?(?:\D|$)/)?.[1]).find(Boolean);
        const bikeSize = o.soundBike.match(/(?:^|\D)(125|250|350|450|500)(?:f)?(?:\D|$)/)?.[1];
        if (variant && variant !== bikeSize) {
          entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: null, status: 'skip', how: 'other-engine-size' });
          continue;
        }
        if (!variant || variant === bikeSize) { dest = `bikes/${o.soundBike}/${relative}`; how = 'sound-bike'; }
      }
    }
    if (!dest && /\.pkz$/i.test(fname)) { dest = `${base}/${fname}`; how = 'model'; }
    if (!dest && recipe && /\.(ps1|bat|cmd|vbs)$/i.test(fname)) {
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: null, status: 'skip', how: 'script' });
      continue;
    }
    // A loose tyre set: the folder holding its .tyre files (e.g. m_sm/m_sm_f_soft.tyre) is the tyre.
    if (!dest && kind === 'tyre' && segs.length > 1 && !DOC_EXT.test(fname)) {
      for (let j = segs.length - 2; j >= 0; j--) {
        if (tyreDirs.has(lsegs.slice(0, j + 1).join('/'))) { dest = `tyres/${segs.slice(j).join('/')}`; how = 'model'; break; }
      }
    }
    // Number fonts: a folder with plate.tga (bike) or name.tga/number.tga (rider) and its .ini.
    if (!dest && (kind === 'bikeFont' || kind === 'riderFont') && !DOC_EXT.test(fname)) {
      const dirs = segs.slice(0, -1);
      for (let j = dirs.length; j >= 1; j--) {
        if (fontDirs.has(lsegs.slice(0, j).join('/'))) { dest = `${base}/${segs.slice(j - 1).join('/')}`; how = 'model'; break; }
      }
      if (!dest && fontDirs.has('.')) {
        const ini = files.find((x) => !x.rel.includes('/') && /\.ini$/i.test(x.rel));
        const name = ini ? ini.rel.slice(0, -4) : String(ctx.title || 'font').replace(/[^\w .-]+/g, '').trim() || 'font';
        if (!f.rel.includes('/')) { dest = `${base}/${name}/${fname}`; how = 'model'; }
      }
    }
    if (!dest && kind === 'animation' && /\.anm$/i.test(fname)) { dest = `rider/animations/mx/${fname}`; how = 'animation'; }
    if (!dest && segs.length > 1) {
      for (let j = segs.length - 2; j >= 0; j--) {
        const s = lsegs[j];
        const dirPath = lsegs.slice(0, j + 1).join('/');
        if (pkzBases.has(s) || installedInBase.has(s) || lowerSet.has(`${dirPath}/${s}.ini`)) {
          dest = `${base}/${segs.slice(j).join('/')}`; how = 'model'; break;
        }
      }
    }
    if (!dest && kind === 'bikeSwap' && o.paintTarget && require('./bike-swaps').visual(fname)) {
      dest = `bikes/${o.paintTarget}/${segs.join('/')}`; how = 'model-swap';
    }
    // 3) Loose paints
    if (!dest && /\.pnt$/i.test(fname)) {
      if (paintModelsDir) {
        if (o.paintTarget) {
          const sub = lsegs[lsegs.length - 2] === 'goggles' ? 'goggles' : 'paints';
          dest = `${paintModelsDir}/${o.paintTarget}/${sub}/${fname}`; how = 'paint';
        }
      } else if (loosePntDir) { dest = `${loosePntDir}/${fname}`; how = 'paint'; }
    }
    // 4) Custom destination keeps the archive layout
    if (!dest && kind === 'custom' && o.customDir !== '' && !DOC_EXT.test(fname)) {
      dest = `${o.customDir}/${f.rel}`.replace(/^\/+/, ''); how = 'custom';
    }

    // A body paint cannot become a helmet paint just because a mixed download
    // carries helmet categories. Its texture IDs take precedence for placement.
    if (/\.pnt$/i.test(fname) && bodyPaintFiles.includes(f.rel)) {
      dest = needsRiderTarget ? null : `${modern ? `rider/riders/${riderTarget || 'default_mx'}` : 'rider'}/paints/${fname}`;
      how = 'paint-content';
    }
    // Validate every livery independently, including structured archives and
    // mixed packs. A global selector must not redirect a different bike's paint.
    const bikeMatch = bikeMatches.get(f.rel);
    if (bikeMatch) { dest = bikeMatch.target ? `bikes/${bikeMatch.target}/paints/${fname}` : null; how = 'bike-match'; }
    if (kind === 'bikeSwap' && dest && !require('./bike-swaps').visual(dest) && !/\.pnt$/i.test(dest)) {
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: null, status: 'skip', how: 'not-appearance' }); continue;
    }
    let status;
    if (dest) {
      dest = dest.replace(/\/+/g, '/').replace(/^\//, '');
      if (modern) dest = layout.canonical(dest, riderTarget || 'default_mx');
      if (bodyPaintFiles.includes(f.rel) && /\/paints\//i.test(dest) && /^rider\//i.test(dest)) {
        if (needsRiderTarget) { dest = null; how = 'missing-rider'; }
        else if (riderTarget) dest = dest.replace(/^rider\/riders\/default_mx\//i, `rider/riders/${riderTarget}/`);
      }
      status = !dest ? 'unresolved' : fs.existsSync(path.join(modsDir, dest)) ? 'overwrite' : 'new';
    } else if (DOC_EXT.test(fname)) status = 'skip';
    else status = 'unresolved';
    entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest, status, how, ...(bikeMatch ? { bikeMatch } : {}) });
  }

  // Several animation downloads contain alternatives with the same ANM name.
  // Never silently let the last archive entry win over another variant.
  const ambiguousAnimations = new Set();
  if (kind === 'animation' || kind === 'animationGame') {
    const byDestination = new Map();
    for (const entry of entries.filter((e) => e.dest)) {
      const key = entry.dest.toLowerCase();
      byDestination.set(key, (byDestination.get(key) || 0) + 1);
    }
    for (const entry of entries.filter((e) => e.dest && byDestination.get(e.dest.toLowerCase()) > 1)) {
      ambiguousAnimations.add(entry.dest.toLowerCase());
      entry.dest = null;
      entry.status = 'unresolved';
      entry.how = 'multiple-variants';
    }
  }
  // A track's server version (cut-down, little or no scenery) never replaces a file you already have:
  // with the player track's name it would leave you riding an empty or black track.
  const serverNote = [];
  if (ctx.serverVersion) {
    let kept = 0;
    for (const e of entries) if (e.status === 'overwrite' && /\.pkz$/i.test(e.dest || '')) { e.status = 'skip'; e.how = 'server-keeps-player'; e.dest = null; kept++; }
    if (kept) serverNote.push(`This is the server version of the track. ${kept === 1 ? 'A track with the same file is' : `${kept} tracks with the same files are`} already installed (normally the player version), so ${kept === 1 ? 'it is' : 'they are'} kept and not replaced. Riding the server version looks empty or black.`);
    else serverNote.push('This is the server version of the track: a cut-down copy for running a dedicated server. In game it shows up as a separate track that looks empty or black when ridden.');
  }
  if (recipe && kind === recipe.kind) {
    for (const c of recipe.copies) {
      const exists = fs.existsSync(path.join(modsDir, c.dest));
      entries.push({ rel: `(game) ${c.pkz}/${c.inner}`, abs: null, size: 0, fromGame: c, dest: ctx.installDir ? c.dest : null, status: !ctx.installDir ? 'unresolved' : exists ? 'overwrite' : 'new', how: 'game-file' });
    }
  }
  const counts = entries.reduce((a, e) => ((a[e.status] = (a[e.status] || 0) + 1), a), {});
  const setupNeedsBike = kind === 'setup' && entries.some((e) => !e.dest && /\.st[pt]$/i.test(e.rel));
  const needsPaintTarget = (!!paintModelsDir && !o.paintTarget && entries.some((e) => (kind === 'bikeSwap' || /\.pnt$/i.test(e.rel)) && !e.dest)) || (setupNeedsBike && !!ctx.profile);
  const needsSoundBike = kind === 'sound' && entries.some((e) => e.status === 'unresolved' && !DOC_EXT.test(e.rel));
  const installable = entries.filter((e) => e.dest).length;
  const bikeBlocked = [...bikeMatches.values()].some((result) => ['missing', 'incompatible'].includes(result.status));
  const bikeResults = [...bikeMatches.values()];
  const bikeCompatibility = { targets: bikeTargetChecks, messages: [...new Set(bikeResults.map((result) => result.message))], blocked: bikeBlocked, multiple: bikeResults.every((result) => result.target) && new Set(bikeResults.map((result) => result.target)).size > 1 };
  const warnings = [];
  warnings.push(...serverNote);
  if (ambiguousAnimations.size) warnings.push('This download contains multiple variants for the same animation file. Install one variant at a time; CoreMX will not pick one silently.');
  if ((kind === 'animation' || kind === 'animationGame') && ctx.animationLocation === null) warnings.push('The creator did not specify whether this animation belongs in the game install folder or mods folder. Check the installation instructions and change the content type below if needed.');
  const awaitingTarget = entries.filter((e) => e.status === 'unresolved' && (/\.pnt$/i.test(e.rel) || setupNeedsBike && /\.st[pt]$/i.test(e.rel)) && (needsPaintTarget || needsRiderTarget) || e.how === 'choose-variant').length;
  if (pick.waiting) warnings.push('This download has several versions for the same place (for example one per brand), and the game uses one at a time. Choose the one you want below.');
  if (kind === 'setup' && !ctx.profile) warnings.push('Create a rider profile in MX Bikes first: setups are saved in your profile.');
  if (!installable && !awaitingTarget && !needsSoundBike && !ambiguousAnimations.size) warnings.push('Choose the content type or destination folder to continue.');
  if ((counts.unresolved || 0) > awaitingTarget && !needsSoundBike) warnings.push(`${counts.unresolved - awaitingTarget} file(s) could not be matched and will be skipped.`);
  if (needsSoundBike && o.soundBike) warnings.push('Some sound files are for a different engine size or have an unknown layout. Check the file list before installing.');
  const otherSoundVariants = entries.filter((e) => e.how === 'other-engine-size').length;
  if (otherSoundVariants) warnings.push(`${otherSoundVariants} sound file(s) for another engine size will be skipped.`);
  if (counts.overwrite) warnings.push(`${counts.overwrite} file(s) already exist and will be replaced.`);
  if (kind !== 'bikePaint' && ctx.unreadablePaints?.length) warnings.push('Some paints could not be inspected. Check the creator’s required model and target folder before installing.');
  if (needsRiderTarget) warnings.push(`These are paints for a different rider model (${bodyTextures.filter((t) => !['rider', 'gloves', 'skin'].includes(t)).join(', ') || 'custom rider'}). Install the matching model, then select it. Paints do not include the model.`);
  const required = new Map();
  for (const entry of entries.filter((e) => e.dest && /\.pnt$/i.test(e.dest))) {
    const match = entry.dest.match(/^(.*?\/(helmets|boots|protections)\/[^/]+)\/(?:paints|goggles)\//i) || entry.dest.match(/^(bikes\/[^/]+)\/paints\//i);
    if (!match) continue;
    const dir = match[1], name = dir.split('/').pop();
    const builtin = /^(default|full|neck)$/i.test(name);
    const included = entries.some((e) => e.dest === dir + '.pkz' || e.dest?.startsWith(dir + '/') && /\.(edf|hrc|engn|geom)$/i.test(e.dest));
    const installed = builtin || modelExists(path.join(modsDir, dir));
    required.set(dir, { name, kind: match[2] || 'bike', installed, included });
  }
  const requiredModels = [...required.values()];
  for (const m of requiredModels.filter((m) => m.kind !== 'bike' && !m.installed && !m.included)) warnings.push(`These paints need the ${m.name} model. Install that model too before equipping the paints.`);
  // Some plugins draw text with the game's own fonts, copied next to them under their own names;
  // their instructions ask players to copy these out of the game's .pkz files by hand. CoreMX
  // copies them (local copies of the player's own game files) as part of the install, so they are
  // also removed with it.
  for (const need of PLUGIN_GAME_FILES) {
    if (kind !== 'plugin' || !entries.some((e) => e.dest && e.dest.toLowerCase() === need.when)) continue;
    for (const c of need.copies) {
      if (entries.some((e) => e.dest && e.dest.toLowerCase() === c.dest.toLowerCase())) continue;
      const exists = ctx.installDir && fs.existsSync(path.join(ctx.installDir, c.dest));
      entries.push({ rel: `(game) ${c.loose || c.pkz + '/' + c.inner}`, abs: null, size: 0, fromGame: c, dest: c.dest, status: exists ? 'overwrite' : 'new', how: 'game-file' });
    }
  }
  if ((gameRoot || recipe && kind === recipe.kind) && !ctx.installDir) warnings.push(`Set your game install folder in Settings first — ${kind === 'plugin' ? 'plugins go there' : kind === 'animationGame' ? 'animations go there' : kind === 'graphics' ? 'graphics mods go there' : recipe && kind === recipe.kind ? 'CoreMX copies the stock wheel files from it' : 'this goes there'}.`);
  if (recipe && kind === recipe.kind) warnings.push('This fix comes as a script. CoreMX never runs scripts; it copies the same stock wheel files from your game (tyres.pkz) into mods/tyres/Factory_tyre itself.');
  if (kind === 'translation') warnings.push('After installing, choose the language in MX Bikes: Profiles → Modify → Language.');
  if (kind === 'stand') warnings.push('The game uses one stand for every bike. Installing replaces the stand you use now (the original stays in the game files, so removing this brings it back). A stand\'s colours come from each bike\'s paint.');
  if (kind === 'pitboard' && entries.some((e) => e.how === 'paint-elsewhere')) warnings.push('The trackside pitboard paints (.pnt) in this download go in mods/misc/pitboard and are not part of this install. Only the HUD pitboard is installed.');
  if (kind === 'pitboard' && installable && !entries.some((e) => /^misc\/(hud|pitboard)\/pitboard\.(cfg|tga|edf)$/i.test(e.dest || ''))) warnings.push('These pitboard files have numbered names. The game only uses pitboard.cfg and pitboard.tga, so follow the creator\'s readme to rename the board you want.');
  if (kind === 'setup' && ctx.profile && installable) warnings.push(`Setups are saved in your profile "${ctx.profile}" and show up in that bike's setup list in game.`);
  if (kind === 'hudTexture') warnings.push('These are textures for the MXBMRP3 HUD plugin. They go in Documents/PiBoSo/MX Bikes/mxbmrp3/textures; pick them in the plugin\'s settings.');
  if (kind === 'menuUi' && files.some((f) => /\.(bat|cmd|exe)$/i.test(f.rel))) warnings.push('This mod comes with a launcher (.bat/.exe). CoreMX never runs those; only its images and menu files are installed.');
  if (kind === 'menuUi' && entries.some((e) => e.status === 'unresolved')) warnings.push('Some files have no known place in MX Bikes/ui or MX Bikes/misc (or several files would land in the same place, like colour options). Check the mod description and pick the ones you want.');
  if (gameRoot) warnings.push(kind === 'plugin' ? 'This plugin goes in the MX Bikes plugins folder. Close the game before installing it.' : kind === 'animationGame' ? 'The creator requires these .anm files in MX Bikes/rider/animations/mx. Close the game before installing or changing them.' : 'This goes into your MX Bikes install folder. Any game file it replaces is backed up first (as .mxbm-bak) so you can undo it.');
  else if (/^tools|^plugins|reshade/i.test(ctx.categoryNames ? ctx.categoryNames.join(' ') : '')) warnings.push('Tools, plugins and ReShade presets usually go in the game install folder, not mods/. Check the mod description.');

  // Everything placed by the archive's own folder structure counts as certain even without a known type.
  const allStructured = installable > 0 && entries.every((e) => !e.dest || e.how === 'structure');
  const confident = !ctx.serverVersion && installable > 0 && !counts.unresolved && !needsPaintTarget && paintGuess !== 'title' && !bikeBlocked && [...bikeMatches.values()].every((result) => result.status === 'match')
    && !requiredModels.some((m) => !m.installed && !m.included) && !needsRiderTarget && (kind === 'bikePaint' || !ctx.unreadablePaints?.length)
    && kind !== 'bikeSwap' && !pick.waiting && !(kind === 'setup' && !ctx.profile) && (kind !== 'custom' || allStructured) && (!counts.overwrite || ctx.reinstall)
    && !(ctx.local && !ctx.kindHint && !allStructured) && !gameRoot && !(gameRoot && !ctx.installDir);

  return {
    kind, kindLabel: mixedGear ? 'Mixed rider gear paints' : K.label, autoKind, base: gameRoot ? 'MX Bikes install folder' : userRoot ? 'MX Bikes documents folder' : base, root: gameRoot ? 'game' : userRoot ? 'user' : 'mods',
    gameDir: ctx.installDir || null, variants: pick.variants, needsVariant: pick.waiting,
    askType: !!ctx.local && !ctx.kindHint && !opts.kind && !allStructured,
    kindHint: ctx.kindHint || null, detectReason: ctx.detectReason || null,
    options: o, paintModels, paintModelsBase: mixedGear ? null : kind === 'setup' ? (setupNeedsBike || paintGuess ? 'bikes' : null) : paintModelsDir, paintGuess, bikeCompatibility,
    entries, counts, installable, warnings, confident, requiredModels, needsPaintTarget, needsSoundBike,
    soundBikes: kind === 'sound' ? listModels(modsDir, 'bikes') : [], riderModels: showRiderTarget ? riderModels : [], needsRiderTarget,
    requiresModelWarning: kind !== 'bikePaint' && (requiredModels.some((r) => !r.included && !r.installed) || needsPaintTarget || needsRiderTarget || riderModels.some((r) => r.name === riderTarget && r.unverified)), dependencies: ctx.dependencies || [],
    kinds: Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label })),
    trackTypes: TRACK_TYPES,
  };
}

// Game files some plugins need copied next to them (see plan()).
const PLUGIN_GAME_FILES = [
  { when: 'plugins/mxb_ragdoll.dlo', copies: [
    { pkz: 'misc.pkz', inner: 'misc/misc.fnt', dest: 'plugins/mxb_ragdoll.fnt' },
    { loose: 'ui/main.fnt', pkz: 'ui.pkz', inner: 'ui/main.fnt', dest: 'plugins/mxb_ragdoll_title.fnt' },
    { pkz: 'misc.pkz', inner: 'misc/hud/LCD.fnt', dest: 'plugins/mxb_ragdoll_lcd.fnt' },
  ] },
];
// Reads one of the game's own files: loose in the install folder, else from a plain .pkz there.
async function readGameFile(gameDir, c) {
  if (c.loose) { const loose = path.join(gameDir, ...c.loose.split('/')); if (fs.existsSync(loose)) return fsp.readFile(loose); }
  const pkz = path.join(gameDir, c.pkz);
  if (!fs.existsSync(pkz)) throw new Error(`The game file ${c.pkz} was not found`);
  return require('./zipread').withZip(pkz, async (entries, read) => {
    const entry = entries.find((e) => e.fileName.replace(/\\/g, '/').toLowerCase() === c.inner.toLowerCase());
    if (!entry) throw new Error(`${c.inner} was not found in the game's ${c.pkz}`);
    return read(entry, 8 * 1024 * 1024);
  });
}

async function apply(p, rootDir, { signal, rollbackDir } = {}) {
  if (p.bikeCompatibility?.blocked) throw new Error(p.bikeCompatibility.messages.join(' '));
  const written = [], journal = [];
  let temporary = null, keepRecovery = false;
  const check = () => { if (signal?.aborted) throw new Error('Cancelled'); };
  try {
  for (const e of p.entries) {
    check();
    if (!e.dest) continue;
    const to = path.join(rootDir, e.dest);
    if (!path.resolve(to).toLowerCase().startsWith(path.resolve(rootDir).toLowerCase() + path.sep)) continue; // never write outside the target folder
    await fsp.mkdir(path.dirname(to), { recursive: true });
    let previous = null;
    if (fs.existsSync(to)) {
      if (!temporary) { const parent = rollbackDir || os.tmpdir(); await fsp.mkdir(parent, { recursive: true }); temporary = await fsp.mkdtemp(path.join(parent, 'mxbm-install-')); }
      previous = path.join(temporary, String(journal.length)); await fsp.copyFile(to, previous);
    }
    const createdBackup = p.root === 'game' && fs.existsSync(to) && !fs.existsSync(to + '.mxbm-bak');
    journal.push({ to, previous, createdBackup });
    // In the game folder, keep the original file before replacing it
    if (p.root === 'game' && fs.existsSync(to) && !fs.existsSync(to + '.mxbm-bak')) await fsp.copyFile(to, to + '.mxbm-bak');
    if (e.fromGame) await fsp.writeFile(to, await readGameFile(p.gameDir || rootDir, e.fromGame));
    else await fsp.copyFile(e.abs, to);
    check();
    const now = new Date();
    await fsp.utimes(to, now, now).catch(() => {}); // Windows copy keeps the archive's old dates
    written.push(e.dest);
  }
  return written;
  } catch (error) {
    const failures = [];
    for (const entry of journal.reverse()) {
      try {
        if (entry.previous) await fsp.copyFile(entry.previous, entry.to);
        else await fsp.unlink(entry.to).catch((e) => { if (e.code !== 'ENOENT') throw e; });
        if (entry.createdBackup) await fsp.unlink(entry.to + '.mxbm-bak').catch((e) => { if (e.code !== 'ENOENT') throw e; });
      } catch (e) { failures.push(e); }
    }
    if (failures.length) { keepRecovery = true; const e = new Error(`${error.message}. Some files could not be restored; recovery copies were kept in ${temporary || rollbackDir}.`); e.rollbackFailed = true; throw e; }
    throw error;
  } finally {
    if (temporary && !keepRecovery) await fsp.rm(temporary, { recursive: true, force: true });
  }
}

module.exports = { menuDestinations, plan, apply, KINDS, kindFromCategories, packageKind, pickVariant, guessTrackType, guessModel, listModels };
