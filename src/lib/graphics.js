// Graphics mods in the MX Bikes install folder: ReShade (and its add-ons), ReShade presets, shader packs.
// "Turn off" renames (adds .off) so it's fully reversible.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const CORE_INI = new Set(['core.ini', 'mxbikes.ini', 'proxy_udp.ini', 'reshade.ini', 'server.ini']);
const INJECT_DLL = /^(dxgi|opengl32|d3d9|d3d11|d3d12|dinput8)\.dll$/i;

async function dirSize(d) {
  let t = 0;
  for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(d, e.name);
    t += e.isDirectory() ? await dirSize(p) : (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return t;
}

async function scan(installDir) {
  if (!installDir || !fs.existsSync(installDir)) return { items: [], reshade: false };
  const items = [];
  const ents = await fsp.readdir(installDir, { withFileTypes: true });
  const names = new Set(ents.map((e) => e.name.toLowerCase()));
  const hasReshadeIni = names.has('reshade.ini') || names.has('reshade.ini.off');
  for (const e of ents) {
    const p = path.join(installDir, e.name);
    const off = /\.off$/i.test(e.name);
    const base = e.name.replace(/\.off$/i, '');
    const lower = base.toLowerCase();
    if (e.isDirectory()) {
      if (/reshade-shaders|reshade-presets|^shaders?$|^presets?$/i.test(base.replace(/ \(off\)$/, ''))) {
        items.push({ id: e.name, name: base.replace(/ \(off\)$/, ''), type: 'Shader pack', path: p, on: !/ \(off\)$/.test(base), size: await dirSize(p), dir: true });
      }
      continue;
    }
    if (INJECT_DLL.test(lower)) {
      items.push({ id: e.name, name: hasReshadeIni ? 'ReShade' : base, type: hasReshadeIni ? 'ReShade' : 'Injected DLL', detail: base, path: p, on: !off, size: (await fsp.stat(p)).size });
    } else if (/\.addon(32|64)?$/i.test(lower)) {
      items.push({ id: e.name, name: base.replace(/\.addon(32|64)?$/i, ''), type: 'ReShade add-on', path: p, on: !off, size: (await fsp.stat(p)).size });
    } else if (lower.endsWith('.ini') && !CORE_INI.has(lower)) {
      try {
        const txt = await fsp.readFile(p, 'latin1');
        if (/^\s*Techniques\s*=|^\s*PreprocessorDefinitions\s*=|^\s*\[[A-Za-z0-9_]+\.fx\]/m.test(txt)) {
          items.push({ id: e.name, name: base.replace(/\.ini$/i, ''), type: 'ReShade preset', path: p, on: !off, size: Buffer.byteLength(txt) });
        }
      } catch {}
    }
  }
  return { items, reshade: items.some((i) => i.type === 'ReShade' && i.on) };
}

async function toggle(installDir, p, on) {
  const r = path.resolve(p);
  if (!r.toLowerCase().startsWith(path.resolve(installDir).toLowerCase() + path.sep)) throw new Error('Not in the game folder');
  const st = await fsp.stat(r);
  let to;
  if (st.isDirectory()) to = on ? r.replace(/ \(off\)$/, '') : `${r} (off)`;
  else to = on ? r.replace(/\.off$/i, '') : `${r}.off`;
  if (to !== r) await fsp.rename(r, to);
  return to;
}

module.exports = { scan, toggle };
