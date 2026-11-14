// Paint sync: share the paint files your outfit uses (bike livery, kit, gloves, helmet, goggles,
// boots, protector) with mutual friends, and download theirs into your mods folder so MX Bikes
// shows them on track. Only readable .pnt paints travel — never models, never sealed paints.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const profile = require('./profile');
const pnt = require('./pnt');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rel = (modsDir, abs) => path.relative(modsDir, abs).split(path.sep).join('/');
// Same rule as the service: relative, inside bikes/ or rider/, a .pnt, no "..".
const safeRel = (p) => typeof p === 'string' && /^(bikes|rider)\/.+\.pnt$/i.test(p) && !p.split('/').some((x) => !x || x === '.' || x === '..') && !/[\\:\0]/.test(p);

function readable(buf) { try { return pnt.isPnt(buf) && pnt.names(buf).length > 0; } catch { return false; } }

// The paint files behind a bike's outfit, with what a friend needs installed for each to show.
async function outfitFiles(modsDir, prof, bike) {
  const lo = await profile.loadout(modsDir, prof, bike);
  const c = lo.current, gd = lo.gearDir;
  const bikeDir = await profile.findBikeDir(modsDir, bike);
  const helmet = c.helmet && c.helmet !== 'default' ? c.helmet : null;
  const boots = c.boots && c.boots !== 'default' ? c.boots : null;
  const prot = c.protection || 'chest';
  const want = [
    ['bikePaint', 'Bike livery', c.bikePaint, [bikeDir && path.join(bikeDir, 'paints'), path.join(modsDir, 'bikes', bike, 'paints')], [{ kind: 'bike', name: bike }]],
    ['suitPaint', 'Rider kit', c.suitPaint, [path.join(gd, 'paints')], []],
    ['glovesPaint', 'Gloves', c.glovesPaint, [path.join(gd, 'gloves')], []],
    ['helmetPaint', 'Helmet paint', c.helmetPaint, helmet ? [path.join(gd, 'helmets', helmet, 'paints')] : [], helmet ? [{ kind: 'helmet', name: helmet }] : []],
    ['gogglesPaint', 'Goggles', c.gogglesPaint, [helmet && path.join(gd, 'helmets', helmet, 'goggles'), path.join(gd, 'goggles')], helmet ? [{ kind: 'helmet', name: helmet }] : []],
    ['bootsPaint', 'Boot paint', c.bootsPaint, [boots && path.join(gd, 'boots', boots, 'paints'), path.join(gd, 'boots'), path.join(gd, 'boots paints')], boots ? [{ kind: 'boots', name: boots }] : []],
    ['protectionPaint', 'Protector paint', c.protectionPaint, [path.join(gd, 'protections', prot, 'paints')], prot !== 'chest' ? [{ kind: 'protection', name: prot }] : []],
  ];
  const out = [];
  for (const [slot, label, name, dirs, needs] of want) {
    if (!name) continue;
    for (const d of dirs.filter(Boolean)) {
      const f = path.join(d, name + '.pnt');
      let buf;
      try { buf = await fsp.readFile(f); } catch { continue; }
      if (!readable(buf)) break; // sealed / protected: not shared
      const r = rel(modsDir, f);
      if (safeRel(r)) out.push({ slot, label: `${label}: ${name}`, path: r, sha256: sha256(buf), size: buf.length, buf, needs });
      break;
    }
  }
  return { bike, items: out };
}

// Upload what's missing on the service, then publish the outfit.
async function share({ call, upload, modsDir, prof, bike, bikeName }) {
  const { items } = await outfitFiles(modsDir, prof, bike);
  const meta = items.map(({ buf, ...m }) => m);
  const r = await call('POST', '/v1/loadout', { bike, bikeName, items: meta });
  for (const sha of r.missing || []) {
    const it = items.find((x) => x.sha256 === sha);
    if (it) await upload(sha, it.buf);
  }
  if ((r.missing || []).length) await call('POST', '/v1/loadout', { bike, bikeName, items: meta }); // now complete
  return meta;
}

// Download friends' paints you don't have. Never overwrites a file you already have.
// received: { relPath: { sha256, from, at } } — what paint sync has written, so it can be undone.
async function fetchFriends({ call, download, modsDir, received, have }) {
  const { loadouts } = await call('GET', '/v1/loadouts');
  const report = [];
  for (const lo of loadouts) {
    const items = [];
    for (const it of lo.items) {
      const entry = { slot: it.slot, label: it.label, path: it.path, needs: [] };
      if (!safeRel(it.path)) { entry.state = 'skipped'; items.push(entry); continue; }
      const dst = path.join(modsDir, ...it.path.split('/'));
      if (!dst.startsWith(path.resolve(modsDir) + path.sep)) { entry.state = 'skipped'; items.push(entry); continue; }
      for (const n of it.needs || []) if (!have(n)) entry.needs.push(n);
      let existing = null;
      try { existing = await fsp.readFile(dst); } catch {}
      if (existing) {
        entry.state = sha256(existing) === it.sha256 ? 'have' : 'name-taken';
      } else {
        try {
          const buf = await download(it.sha256);
          if (sha256(buf) !== it.sha256 || !readable(buf)) throw new Error('bad file');
          await fsp.mkdir(path.dirname(dst), { recursive: true });
          await fsp.writeFile(dst, buf);
          received[it.path] = { sha256: it.sha256, from: lo.name || lo.id, at: Date.now() };
          entry.state = 'downloaded';
        } catch (e) { entry.state = 'failed'; entry.error = e.message; }
      }
      items.push(entry);
    }
    report.push({ id: lo.id, name: lo.name, bike: lo.bike, bikeName: lo.bikeName, at: lo.at, items });
  }
  return report;
}

// Remove every paint paint-sync downloaded (unchanged files only).
async function removeReceived(modsDir, received) {
  let n = 0;
  for (const [r, info] of Object.entries(received)) {
    if (!safeRel(r)) { delete received[r]; continue; }
    const f = path.join(modsDir, ...r.split('/'));
    try { if (sha256(await fsp.readFile(f)) === info.sha256) { await fsp.rm(f); n++; } } catch {}
    delete received[r];
  }
  return n;
}

module.exports = { outfitFiles, share, fetchFriends, removeReceived, safeRel };
