// Decides where each staged file goes inside mods/, and applies the plan.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const TRACK_TYPES = ['motocross', 'supercross', 'enduro', 'supermoto'];
const TOP = new Set(['bikes', 'tracks', 'rider', 'tyres', 'misc']);
const RIDER_SUBS = new Set(['helmets', 'boots', 'gloves', 'paints', 'protections', 'goggles', 'riders', 'animations', 'helmetcams', 'fonts']);
const DOC_EXT = /\.(txt|md|pdf|url|html?|jpe?g|png|webp|gif|bmp|mp4|mov|docx?|rtf|psd|lnk|exe)$/i;

// Rider gear lives in rider/riders/<model>/<type> on current MX Bikes, rider/<type> on old installs.
// o.gear is that prefix, chosen in plan().
const KINDS = {
  track:           { label: 'Track', base: (o) => `tracks/${o.trackType || 'motocross'}` },
  bike:            { label: 'Bike', base: () => 'bikes' },
  bikePaint:       { label: 'Bike livery (paint)', base: () => 'bikes', paintModels: () => 'bikes' },
  riderKit:        { label: 'Rider kit (jersey & pants)', base: (o) => `${o.gear}/paints`, loosePnt: (o) => `${o.gear}/paints` },
  gloves:          { label: 'Gloves', base: (o) => `${o.gear}/gloves`, loosePnt: (o) => `${o.gear}/gloves` },
  boots:           { label: 'Boots', base: (o) => `${o.gear}/boots` },
  bootPaint:       { label: 'Boot paint', base: (o) => `${o.gear}/boots`, paintModels: (o) => `${o.gear}/boots` },
  helmet:          { label: 'Helmet', base: (o) => `${o.gear}/helmets` },
  helmetPaint:     { label: 'Helmet paint', base: (o) => `${o.gear}/helmets`, paintModels: (o) => `${o.gear}/helmets` },
  goggles:         { label: 'Goggles', base: (o) => `${o.gear}/goggles`, loosePnt: (o) => `${o.gear}/goggles` },
  protection:      { label: 'Chest protector / neck brace', base: (o) => `${o.gear}/protections` },
  protectionPaint: { label: 'Chest protector paint', base: (o) => `${o.gear}/protections`, paintModels: (o) => `${o.gear}/protections` },
  helmetcam:       { label: 'Helmet camera', base: (o) => `${o.gear}/helmetcams` },
  riderModel:      { label: 'Rider model', base: () => 'rider/riders' },
  animation:       { label: 'Rider animation', base: () => 'rider/animations' },
  tyre:            { label: 'Tyres', base: () => 'tyres' },
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
  [[37, 51, 361], 'bikePaint'], [[45, 179, 304, 463], 'bike'],
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

// files: [{rel, abs, size}], ctx: {categories, title, modsDir}, opts: overrides {kind, trackType, paintTarget, customDir}
function plan(files, ctx, opts = {}) {
  const modsDir = ctx.modsDir;
  const text = [ctx.title || '', ...files.map((f) => f.rel)].join(' ');
  const hasPkz = files.some((f) => /\.pkz$/i.test(f.rel));
  const hasPnt = files.some((f) => /\.pnt$/i.test(f.rel));

  let kind = opts.kind || ((!ctx.categories || !ctx.categories.length) && ctx.kindHint) || kindFromCategories(ctx.categories);
  let autoKind = !opts.kind;
  if (autoKind) {
    if (PAINT_OF[kind] && !hasPkz && hasPnt) kind = PAINT_OF[kind];
    else if (MODEL_OF[kind] && hasPkz && !hasPnt) kind = MODEL_OF[kind];
  }
  const K = KINDS[kind] || KINDS.custom;
  // Current MX Bikes uses this layout even on a fresh install where the folder
  // has not been created yet. An explicitly requested legacy install can opt out.
  const modern = opts.legacyLayout !== true;
  const bodyPaintFiles = kind === 'riderKit' ? ctx.bodyPaintFiles || [] : ctx.knownBodyPaintFiles || [];
  const bodyTextures = ctx.paintTextures && bodyPaintFiles.length ? [...new Set(bodyPaintFiles.flatMap((rel) => ctx.paintTextures[rel] || []))] : ctx.bodyPaintTextures || [];
  const riderModels = (ctx.riderModels || []).map((m) => ({ ...m, compatible: bodyTextures.every((t) => m.textures.some((n) => n.toLowerCase() === t.toLowerCase())) }));
  const compatibleRiders = riderModels.filter((m) => m.compatible);
  const riderTarget = opts.riderTarget || compatibleRiders.find((m) => m.name === 'default_mx')?.name || (compatibleRiders.length === 1 ? compatibleRiders[0].name : null);
  const needsRiderTarget = bodyTextures.length > 0 && !riderModels.some((m) => m.name === riderTarget && (m.compatible || m.unverified && opts.riderTarget));
  const o = {
    trackType: opts.trackType || guessTrackType(text),
    paintTarget: opts.paintTarget || null,
    customDir: opts.customDir != null ? opts.customDir : '',
    gear: modern ? `rider/riders/${riderTarget || 'default_mx'}` : 'rider', riderTarget,
  };
  const base = K.base(o);
  const paintModelsDir = K.paintModels ? K.paintModels(o) : PAINT_OF[kind] && hasPnt ? base : null;
  const loosePntDir = K.loosePnt ? K.loosePnt(o) : null;
  const lowerSet = new Set(files.map((f) => f.rel.toLowerCase()));
  const pkzBases = new Set(files.filter((f) => /\.pkz$/i.test(f.rel)).map((f) => path.posix.basename(f.rel).slice(0, -4).toLowerCase()));
  const installedInBase = new Set(listModels(modsDir, base).map((n) => n.toLowerCase()));

  let paintModels = [];
  let paintGuess = null;
  if (paintModelsDir) {
    const incoming = [...new Set(files.filter((f) => /\.pkz$/i.test(f.rel)).map((f) => path.posix.basename(f.rel).slice(0, -4)))];
    paintModels = [...new Set([...listModels(modsDir, paintModelsDir), ...incoming])].sort((a, b) => a.localeCompare(b));
    if (!o.paintTarget && !opts.requirePaintTarget) {
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
  for (const f of files) {
    if (gameRoot) {
      const segs = f.rel.split('/').slice(strip);
      const fname = segs[segs.length - 1];
      const skip = segs.length === 1 && /\.(txt|md|url|pdf|html?|docx?|rtf|lnk|jpe?g|png|webp|gif)$/i.test(fname);
      const dest = skip ? null : segs.join('/');
      const status = !dest ? 'skip' : ctx.installDir && fs.existsSync(path.join(ctx.installDir, dest)) ? 'overwrite' : 'new';
      entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest, status, how: 'game' });
      continue;
    }
    const segs = f.rel.split('/');
    const lsegs = segs.map((s) => s.toLowerCase());
    const fname = segs[segs.length - 1];
    let dest = null, how = '';

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
    if (!dest && /\.pkz$/i.test(fname)) { dest = `${base}/${fname}`; how = 'model'; }
    if (!dest && segs.length > 1) {
      for (let j = segs.length - 2; j >= 0; j--) {
        const s = lsegs[j];
        const dirPath = lsegs.slice(0, j + 1).join('/');
        if (pkzBases.has(s) || installedInBase.has(s) || lowerSet.has(`${dirPath}/${s}.ini`)) {
          dest = `${base}/${segs.slice(j).join('/')}`; how = 'model'; break;
        }
      }
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
    if (/\.pnt$/i.test(fname) && (bodyPaintFiles.includes(f.rel) || (ctx.paintTextures?.[f.rel] || []).includes('rider'))) {
      dest = needsRiderTarget ? null : `${modern ? `rider/riders/${riderTarget || 'default_mx'}` : 'rider'}/paints/${fname}`;
      how = 'paint-content';
    }
    let status;
    if (dest) {
      dest = dest.replace(/\/+/g, '/').replace(/^\//, '');
      if (modern && (kind !== 'custom' || autoKind)) dest = dest.replace(/^rider\/(helmets|boots|boots paints|paints|gloves|protections|goggles)\//i, 'rider/riders/default_mx/$1/');
      if ((bodyPaintFiles.includes(f.rel) || (ctx.paintTextures?.[f.rel] || []).includes('rider')) && /\/paints\//i.test(dest) && /^rider\//i.test(dest)) {
        if (needsRiderTarget) { dest = null; how = 'missing-rider'; }
        else if (riderTarget) dest = dest.replace(/^rider\/riders\/default_mx\//i, `rider/riders/${riderTarget}/`);
      }
      status = !dest ? 'unresolved' : fs.existsSync(path.join(modsDir, dest)) ? 'overwrite' : 'new';
    } else if (DOC_EXT.test(fname)) status = 'skip';
    else status = 'unresolved';
    entries.push({ rel: f.rel, abs: f.abs, size: f.size, dest, status, how });
  }

  const counts = entries.reduce((a, e) => ((a[e.status] = (a[e.status] || 0) + 1), a), {});
  const needsPaintTarget = !!paintModelsDir && !o.paintTarget && entries.some((e) => /\.pnt$/i.test(e.rel) && !e.dest);
  const installable = entries.filter((e) => e.dest).length;
  const warnings = [];
  if (!installable) warnings.push('Nothing in this download could be matched to a mods folder. Choose a type or folder below.');
  if (needsPaintTarget) warnings.push(`Choose which ${paintModelsDir.split('/').pop().replace(/s$/, '')} these paints are for.`);
  if (counts.unresolved) warnings.push(`${counts.unresolved} file(s) have no destination and will be skipped.`);
  if (counts.overwrite) warnings.push(`${counts.overwrite} file(s) already exist and will be replaced.`);
  if (ctx.unreadablePaints?.length) warnings.push('Some paints could not be inspected. Check the creator’s required model and target folder before installing.');
  if (needsRiderTarget) warnings.push(`These are paints for a different rider model (${bodyTextures.filter((t) => !['rider', 'gloves', 'skin'].includes(t)).join(', ') || 'custom rider'}). Install the matching model, then choose it below. Paints do not include the model.`);
  const required = new Map();
  for (const entry of entries.filter((e) => e.dest && /\.pnt$/i.test(e.dest))) {
    const match = entry.dest.match(/^(.*?\/(helmets|boots|protections)\/[^/]+)\/(?:paints|goggles)\//i) || entry.dest.match(/^(bikes\/[^/]+)\/paints\//i);
    if (!match) continue;
    const dir = match[1], name = dir.split('/').pop();
    const builtin = /^(default|chest|full)$/i.test(name);
    const included = entries.some((e) => e.dest === dir + '.pkz' || e.dest?.startsWith(dir + '/') && /\.(edf|hrc|engn|geom)$/i.test(e.dest));
    const installed = builtin || modelExists(path.join(modsDir, dir));
    required.set(dir, { name, kind: match[2] || 'bike', installed, included });
  }
  const requiredModels = [...required.values()];
  for (const m of requiredModels.filter((m) => !m.installed && !m.included)) warnings.push(`These paints need the ${m.name} model. Install that model too before equipping the paints.`);
  if (gameRoot && !ctx.installDir) warnings.push('Set your game install folder in Settings first — graphics mods go there.');
  if (gameRoot) warnings.push('This goes into your MX Bikes install folder. Any game file it replaces is backed up first (as .mxbm-bak) so you can undo it.');
  else if (/^tools|^plugins|reshade/i.test(ctx.categoryNames ? ctx.categoryNames.join(' ') : '')) warnings.push('Tools, plugins and ReShade presets usually go in the game install folder, not mods/. Check the mod description.');

  // Everything placed by the archive's own folder structure counts as certain even without a known type.
  const allStructured = installable > 0 && entries.every((e) => !e.dest || e.how === 'structure');
  const confident = installable > 0 && !counts.unresolved && !needsPaintTarget && paintGuess !== 'title'
    && !requiredModels.some((m) => !m.installed && !m.included) && !needsRiderTarget && !ctx.unreadablePaints?.length
    && (kind !== 'custom' || allStructured) && (!counts.overwrite || ctx.reinstall)
    && !(ctx.local && !ctx.kindHint && !allStructured) && !gameRoot && !(gameRoot && !ctx.installDir);

  return {
    kind, kindLabel: K.label, autoKind, base: gameRoot ? 'MX Bikes install folder' : base, root: gameRoot ? 'game' : 'mods',
    askType: !!ctx.local && !ctx.kindHint && !opts.kind && !allStructured,
    kindHint: ctx.kindHint || null, detectReason: ctx.detectReason || null,
    options: o, paintModels, paintModelsBase: paintModelsDir, paintGuess,
    entries, counts, installable, warnings, confident, requiredModels, needsPaintTarget, riderModels, needsRiderTarget, dependencies: ctx.dependencies || [],
    kinds: Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label })),
    trackTypes: TRACK_TYPES,
  };
}

async function apply(p, rootDir) {
  const written = [];
  for (const e of p.entries) {
    if (!e.dest) continue;
    const to = path.join(rootDir, e.dest);
    if (!path.resolve(to).toLowerCase().startsWith(path.resolve(rootDir).toLowerCase() + path.sep)) continue; // never write outside the target folder
    await fsp.mkdir(path.dirname(to), { recursive: true });
    // In the game folder, keep the original file before replacing it
    if (p.root === 'game' && fs.existsSync(to) && !fs.existsSync(to + '.mxbm-bak')) await fsp.copyFile(to, to + '.mxbm-bak');
    await fsp.copyFile(e.abs, to);
    const now = new Date();
    await fsp.utimes(to, now, now).catch(() => {}); // Windows copy keeps the archive's old dates
    written.push(e.dest);
  }
  return written;
}

module.exports = { plan, apply, KINDS, kindFromCategories, guessTrackType, guessModel, listModels };
