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
  tyre:            { label: 'Tyres', base: () => 'tyres' },
  sound:           { label: 'Bike sound', base: () => 'bikes' },
  plugin:          { label: 'Game plugin', base: () => 'plugins', root: 'game' },
  graphics:        { label: 'Graphics mod (game folder)', base: () => '', root: 'game' },
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
  [[174, 609, 130], 'graphics'],
  [[30], 'riderKit'], [[29], 'bike'],
];

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
  let kind = files.some((f) => /\.dlo$/i.test(f.rel)) ? 'plugin' : opts.kind || ((!ctx.categories || !ctx.categories.length) && ctx.kindHint) || kindFromCategories(ctx.categories);
  let autoKind = !opts.kind;
  const visualBikeFiles = files.some((f) => /\.edf$/i.test(f.rel)) && !files.some((f) => /\.(engn|geom)$/i.test(f.rel));
  if (autoKind && visualBikeFiles && (kind === 'bike' || files.some((f) => /(?:^|\/)bikes\//i.test(f.rel)) || /model[\s_-]*swap/i.test(text + ' ' + (ctx.categoryNames || []).join(' ')))) kind = 'bikeSwap';
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
  for (const f of files) {
    if (!gameRoot && isServerCopy(f.rel) && riderNames.has(f.rel.split('/').pop().toLowerCase())) {
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest: null, status: 'skip', how: 'server-copy' });
      continue;
    }
    if (gameRoot) {
      const segs = f.rel.split('/').slice(strip);
      const fname = segs[segs.length - 1];
      const skip = segs.length === 1 && /\.(txt|md|url|pdf|html?|docx?|rtf|lnk|jpe?g|png|webp|gif)$/i.test(fname);
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
  const counts = entries.reduce((a, e) => ((a[e.status] = (a[e.status] || 0) + 1), a), {});
  const needsPaintTarget = !!paintModelsDir && !o.paintTarget && entries.some((e) => (kind === 'bikeSwap' || /\.pnt$/i.test(e.rel)) && !e.dest);
  const needsSoundBike = kind === 'sound' && entries.some((e) => e.status === 'unresolved' && !DOC_EXT.test(e.rel));
  const installable = entries.filter((e) => e.dest).length;
  const bikeBlocked = [...bikeMatches.values()].some((result) => ['missing', 'incompatible'].includes(result.status));
  const bikeResults = [...bikeMatches.values()];
  const bikeCompatibility = { targets: bikeTargetChecks, messages: [...new Set(bikeResults.map((result) => result.message))], blocked: bikeBlocked, multiple: bikeResults.every((result) => result.target) && new Set(bikeResults.map((result) => result.target)).size > 1 };
  const warnings = [];
  if (ambiguousAnimations.size) warnings.push('This download contains multiple variants for the same animation file. Install one variant at a time; CoreMX will not pick one silently.');
  if ((kind === 'animation' || kind === 'animationGame') && ctx.animationLocation === null) warnings.push('The creator did not specify whether this animation belongs in the game install folder or mods folder. Check the installation instructions and change the content type below if needed.');
  const awaitingTarget = entries.filter((e) => e.status === 'unresolved' && /\.pnt$/i.test(e.rel) && (needsPaintTarget || needsRiderTarget)).length;
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
  if (gameRoot && !ctx.installDir) warnings.push(`Set your game install folder in Settings first — ${kind === 'plugin' ? 'plugins' : kind === 'animationGame' ? 'animations' : 'graphics mods'} go there.`);
  if (gameRoot) warnings.push(kind === 'plugin' ? 'This plugin goes in the MX Bikes plugins folder. Close the game before installing it.' : kind === 'animationGame' ? 'The creator requires these .anm files in MX Bikes/rider/animations/mx. Close the game before installing or changing them.' : 'This goes into your MX Bikes install folder. Any game file it replaces is backed up first (as .mxbm-bak) so you can undo it.');
  else if (/^tools|^plugins|reshade/i.test(ctx.categoryNames ? ctx.categoryNames.join(' ') : '')) warnings.push('Tools, plugins and ReShade presets usually go in the game install folder, not mods/. Check the mod description.');

  // Everything placed by the archive's own folder structure counts as certain even without a known type.
  const allStructured = installable > 0 && entries.every((e) => !e.dest || e.how === 'structure');
  const confident = installable > 0 && !counts.unresolved && !needsPaintTarget && paintGuess !== 'title' && !bikeBlocked && [...bikeMatches.values()].every((result) => result.status === 'match')
    && !requiredModels.some((m) => !m.installed && !m.included) && !needsRiderTarget && (kind === 'bikePaint' || !ctx.unreadablePaints?.length)
    && kind !== 'bikeSwap' && (kind !== 'custom' || allStructured) && (!counts.overwrite || ctx.reinstall)
    && !(ctx.local && !ctx.kindHint && !allStructured) && !gameRoot && !(gameRoot && !ctx.installDir);

  return {
    kind, kindLabel: mixedGear ? 'Mixed rider gear paints' : K.label, autoKind, base: gameRoot ? 'MX Bikes install folder' : base, root: gameRoot ? 'game' : 'mods',
    askType: !!ctx.local && !ctx.kindHint && !opts.kind && !allStructured,
    kindHint: ctx.kindHint || null, detectReason: ctx.detectReason || null,
    options: o, paintModels, paintModelsBase: mixedGear ? null : paintModelsDir, paintGuess, bikeCompatibility,
    entries, counts, installable, warnings, confident, requiredModels, needsPaintTarget, needsSoundBike,
    soundBikes: kind === 'sound' ? listModels(modsDir, 'bikes') : [], riderModels: showRiderTarget ? riderModels : [], needsRiderTarget,
    requiresModelWarning: kind !== 'bikePaint' && (requiredModels.some((r) => !r.included && !r.installed) || needsPaintTarget || needsRiderTarget || riderModels.some((r) => r.name === riderTarget && r.unverified)), dependencies: ctx.dependencies || [],
    kinds: Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label })),
    trackTypes: TRACK_TYPES,
  };
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
    await fsp.copyFile(e.abs, to);
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

module.exports = { plan, apply, KINDS, kindFromCategories, guessTrackType, guessModel, listModels };
