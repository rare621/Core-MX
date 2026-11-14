const { execFile } = require('child_process');
const cache = new Map();
function ping(ip) {
  return new Promise((resolve) => {
    execFile('ping.exe', ['-n', '1', '-w', '1000', ip], { windowsHide: true, timeout: 1800, encoding: 'utf8' }, (error, stdout) => {
      const match = String(stdout).match(/[=<]\s*(\d+)\s*ms/i);
      resolve(!error && match ? Number(match[1]) : null);
    });
  });
}
async function measure(servers, probe = ping, force = false) {
  const result = servers.map((s) => ({ ...s, ping: null, pingSource: 'network' }));
  let next = 0;
  const fresh = new Set();
  async function worker() {
    while (next < Math.min(40, result.length)) {
      const index = next++, server = result[index];
      const ip = server.address?.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)?.[1];
      if (!ip) continue;
      let hit = cache.get(ip);
      if (!hit || Date.now() - hit.at >= 300000 || force && !fresh.has(ip)) { fresh.add(ip); hit = { at: Date.now(), value: Promise.resolve().then(() => probe(ip)).catch(() => null) }; cache.set(ip, hit); }
      server.ping = await hit.value;
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  while (cache.size > 200) cache.delete(cache.keys().next().value);
  return result;
}
function filter(servers, { population = 'all', maxPing = '', sort = 'activity' } = {}) {
  const out = servers.filter((s) => {
    const count = s.riders?.length || 0, capacity = Number(s.capacity || s.maxPlayers) || 0;
    if (population === 'empty' && count !== 0 || population === 'populated' && count === 0 || population === 'full' && (!capacity || count < capacity) || population === 'available' && capacity && count >= capacity) return false;
    return !maxPing || s.ping != null && s.ping <= Number(maxPing);
  });
  if (sort === 'ping') out.sort((a, b) => (a.ping ?? Infinity) - (b.ping ?? Infinity));
  return out;
}
module.exports = { measure, filter };
