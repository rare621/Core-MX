const fs = require('fs');
const path = require('path');

// Only server-owned, hash-named cache files are eligible. Never touch accounts,
// user mods, unexpected files, directories or links.
// Synced files someone still needs: the gear users wear, counting only users who share it and were
// seen (any CoreMX heartbeat) within inactiveMs. Files of users away longer are removed; their app
// uploads them again when it next shares their outfit.
function liveFiles(users, { now = Date.now(), inactiveMs = Infinity } = {}) {
  const live = new Set();
  for (const user of Object.values(users || {})) {
    if (!user || user.sharePaints === false) continue;
    if (inactiveMs !== Infinity && !(now - (user.lastSeen || 0) < inactiveMs)) continue;
    for (const item of user.loadout?.items || []) live.add(item.sha256);
  }
  return live;
}

function createCacheCleanup({ directory, users, busy = () => false, now = Date.now, graceMs = 120000, inactiveMs = Infinity }) {
  const unusedSince = new Map();
  let running = false;
  return async function cleanup() {
    if (running) return;
    running = true;
    let removed = 0, bytes = 0;
    try {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      const live = liveFiles(users(), { now: now(), inactiveMs });
      const present = new Set(entries.map((entry) => entry.name));
      for (const name of unusedSince.keys()) if (!present.has(name) || live.has(name)) unusedSince.delete(name);
      for (const entry of entries) {
        if (!entry.isFile() || !/^[a-f0-9]{64}(?:\.tmp)?$/.test(entry.name)) continue;
        const name = entry.name, hash = name.replace(/\.tmp$/, '');
        if (live.has(hash) || busy(hash)) { unusedSince.delete(name); continue; }
        if (!unusedSince.has(name)) unusedSince.set(name, now());
        if (now() - unusedSince.get(name) < graceMs) continue;
        // No await between the reference check and unlink: a new loadout or
        // download cannot race deletion on the Node event loop.
        try {
          const file = path.join(directory, name), stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.isSymbolicLink()) continue;
          fs.unlinkSync(file); removed++; bytes += stat.size; unusedSince.delete(name);
        } catch { /* A locked download is retried on the next sweep. */ }
      }
      return { removed, bytes };
    } finally { running = false; }
  };
}
module.exports = { createCacheCleanup, liveFiles };
