// "Fix & clean": things in the game/mods folders that cause crashes or waste space, each with a safe fix.
// Every fix moves things aside (renames or Recycle Bin) — nothing is permanently deleted.
const fsp = require('fs').promises;
const path = require('path');
const layout = require('./rider-layout');

const STOCK_DLLS = new Set(['oculus.dll', 'openvr.dll', 'openvr_api.dll', 'soft_oal.dll', 'steam_api64.dll']);
const RESHADE = /^(opengl32|dxgi|d3d9|d3d11|reshade.*)\.dll$/i;

async function listDir(d) { try { return await fsp.readdir(d, { withFileTypes: true }); } catch { return []; } }

// Gloves paints sitting with the rider kits (rider/riders/<body>/paints): packs that put kits and gloves
// side by side were installed whole into the kits folder. The game only offers gloves from gloves/.
// Returns [{ rider, name, from, to }] (paths relative to the mods folder).
async function glovesInKits(modsDir) {
  const { paintKind } = require('./paint-compat');
  const pnt = require('./pnt');
  const out = [];
  for (const body of await listDir(path.join(modsDir, 'rider', 'riders'))) {
    if (!body.isDirectory()) continue;
    for (const e of await listDir(path.join(modsDir, 'rider', 'riders', body.name, 'paints'))) {
      if (!e.isFile() || !/.pnt$/i.test(e.name)) continue;
      let names; try { names = pnt.names(await fsp.readFile(path.join(modsDir, 'rider', 'riders', body.name, 'paints', e.name))); } catch { continue; }
      if (paintKind(names) === 'gloves') out.push({ rider: body.name, name: e.name, from: `rider/riders/${body.name}/paints/${e.name}`, to: `rider/riders/${body.name}/gloves/${e.name}` });
    }
  }
  return out;
}

async function scan({ installDir, modsDir, items }) {
  const issues = [];
  // Game folder: ReShade / injected DLLs
  if (installDir) {
    for (const e of await listDir(installDir)) {
      if (e.isDirectory()) continue;
      const n = e.name.toLowerCase();
      if (RESHADE.test(n)) {
        issues.push({ id: `reshade:${e.name}`, kind: 'crash', title: 'ReShade is installed', detail: `${e.name} in the game folder. ReShade is a common cause of crashes on busy servers.`, fix: 'Turn off', fixId: 'disable-file', path: path.join(installDir, e.name) });
      } else if (n.endsWith('.dll') && !STOCK_DLLS.has(n)) {
        issues.push({ id: `dll:${e.name}`, kind: 'crash', title: 'Unknown DLL in the game folder', detail: `${e.name} isn't part of MX Bikes. Old runtime DLLs left here (like msvcr90.dll) can crash the game.`, fix: 'Turn off', fixId: 'disable-file', path: path.join(installDir, e.name) });
      }
    }
  }
  // Empty tyre folders break the bike list
  for (const e of await listDir(path.join(modsDir, 'tyres'))) {
    if (!e.isDirectory()) continue;
    const p = path.join(modsDir, 'tyres', e.name);
    if (!(await listDir(p)).length) issues.push({ id: `tyre:${e.name}`, kind: 'crash', title: 'Empty tyre folder', detail: `tyres/${e.name} is empty. Empty tyre folders can crash the bike selection screen.`, fix: 'Remove', fixId: 'trash', path: p });
  }
  const misplaced = await layout.misplaced(modsDir);
  if (misplaced.length) issues.push({ id: 'misplaced-gear', kind: 'clean', title: 'Gear in the wrong folders', detail: 'Helmets, boots and protection belong directly under rider/. Kits and gloves belong under rider/riders/<body>/. Repair moves files without replacing different existing copies. Identical extra copies go to the Recycle Bin.', fix: 'Repair folders', fixId: 'repair-gear' });
  const gloves = await glovesInKits(modsDir);
  if (gloves.length) issues.push({ id: 'gloves-in-kits', kind: 'clean', title: 'Gloves in the rider kit folder', detail: `${gloves.map((g) => g.name.replace(/.pnt$/i, '')).slice(0, 4).join(', ')}${gloves.length > 4 ? ` and ${gloves.length - 4} more` : ''}: gloves paints installed with the kits. MX Bikes only offers gloves from the gloves folder. Moving them puts them there; an identical copy already there makes the extra one go to the Recycle Bin.`, fix: 'Move to gloves', fixId: 'move-gloves' });
  // Mods in places the game won't read
  for (const it of items) {
    if (it.disabled) continue;
    if (it.kind === 'archive') issues.push({ id: `arch:${it.key}`, kind: 'clean', title: 'Unpacked download in your mods', detail: `${it.key} is still zipped — the game can't read it.`, fix: 'Install it', fixId: 'install-archive', itemId: it.id });
    else if (it.group === 'tracks' && it.sub === '(loose)') issues.push({ id: `loose:${it.key}`, kind: 'clean', title: 'Track in the wrong folder', detail: `${it.key} must be inside tracks/motocross (or another track type) to show up in game.`, fix: 'Move to motocross', fixId: 'move-track', itemId: it.id });
    else if (it.duplicateOf && it.duplicateExact) issues.push({ id: `dup:${it.key}`, kind: 'clean', title: 'Duplicate download', detail: `${it.key} is an identical copy of ${it.duplicateOf}.`, fix: 'Remove copy', fixId: 'trash-item', itemId: it.id, size: it.size });
    else if (it.kind === 'empty') issues.push({ id: `empty:${it.key}`, kind: 'clean', title: 'Empty mod folder', detail: `${it.key} has no files in it.`, fix: 'Remove', fixId: 'trash-item', itemId: it.id });
  }
  return issues;
}

function storage(items) {
  items = items.filter((i) => !i.virtual || i.accountedSize > 0).map((i) => i.virtual ? { ...i, virtual: false, size: i.accountedSize } : i);
  const active = items.filter((i) => !i.disabled && !i.virtual);
  const groups = {};
  for (const i of active) {
    const g = i.group === 'rider' ? (i.sub.startsWith('legacy/') ? 'Rider gear (old folders)' : 'Rider gear') : { bikes: 'Bikes', tracks: 'Tracks', tyres: 'Tyres' }[i.group] || 'Other';
    groups[g] = (groups[g] || 0) + i.size;
  }
  const disabled = items.filter((i) => i.disabled && !i.virtual).reduce((a, i) => a + i.size, 0);
  if (disabled) groups['Turned off mods'] = disabled;
  return {
    total: active.reduce((a, i) => a + i.size, 0),
    groups: Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([label, size]) => ({ label, size })),
    biggest: [...active].sort((a, b) => b.size - a.size).slice(0, 12).map((i) => ({ id: i.id, title: i.title, label: i.label, size: i.size })),
  };
}

module.exports = { glovesInKits, scan, storage };
