// Tiny INI parser for MX Bikes .ini files.
function parseIni(text) {
  const out = {};
  let sec = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { sec = m[1].trim().toLowerCase(); out[sec] = out[sec] || {}; continue; }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim().toLowerCase();
    const v = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    (out[sec] = out[sec] || {})[k] = v;
  }
  return out;
}
module.exports = { parseIni };
