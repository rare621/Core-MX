// Before joining a server: which bikes its riders use that you don't have. A server refuses you with
// "Missing Bike" when you don't have the bike it needs; the riders on it are the best guide CoreMX has.
// The game names a bike like "Kawasaki KX450 2023"; its folder is MX1OEM_2023_Kawasaki_KX450. Both
// use the same words, so a bike counts as yours when every word of its name is in one of your bikes'
// folder names or titles. Mod bikes can be named differently from their folders, so for them the
// result is "couldn't find", never "you can't join".
(function (root) {
  const STOP = new Set(['oem', 'mx1', 'mx2', 'mx3', 'mxe', 'the', 'by', 'and']);
  const tokens = (s) => String(s || '').toLowerCase()
    .replace(/^(mx\w*?|sm\w*?|en\w*?)oem_/i, ' ')
    .split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));

  // true, false, or null when the name has no words to compare.
  function haveBike(name, installed) {
    const want = tokens(name);
    if (!want.length) return null;
    return installed.some((n) => { const have = new Set(tokens(n)); return want.every((w) => have.has(w)); });
  }

  // OEM class (the game's category) -> the official pack in OEM Packs (mx, sm, enduro, freeride).
  function packFor(category) {
    const c = String(category || '').toLowerCase();
    if (!/\boem\b/.test(c)) return null;
    if (/^sm\b|supermoto/.test(c)) return 'sm';
    if (/enduro|^en\b/.test(c)) return 'enduro';
    if (/freeride|^fr\b/.test(c)) return 'freeride';
    return 'mx';
  }

  // riders: [{ name, bike, category }]; installed: your bikes' folder names and titles.
  function check(riders, installed) {
    const byBike = new Map();
    for (const r of riders || []) {
      if (!r || !r.bike) continue;
      const key = String(r.bike).toLowerCase();
      if (!byBike.has(key)) byBike.set(key, { bike: String(r.bike), category: String(r.category || ''), riders: [] });
      byBike.get(key).riders.push(String(r.name || ''));
    }
    const bikes = [...byBike.values()].map((b) => ({ ...b, have: haveBike(b.bike, installed || []), pack: packFor(b.category) }));
    const missing = bikes.filter((b) => b.have === false);
    const packs = [...new Set(missing.map((b) => b.pack).filter(Boolean))].map((pack) => ({ pack, bikes: missing.filter((b) => b.pack === pack) }));
    return { bikes, missing, packs, mods: missing.filter((b) => !b.pack), noneOwned: bikes.length > 0 && bikes.every((b) => b.have === false) };
  }

  const api = { tokens, haveBike, packFor, check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.bikeCheck = api;
}(typeof window !== 'undefined' ? window : globalThis));
