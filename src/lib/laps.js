// Best laps from MX Bikes' own records (profiles/<profile>/records.ini), for the friends leaderboard:
//   [Track name]
//   <bike folder>=<seconds> <unix time it was set>
const fs = require('fs');
const path = require('path');

function parseRecords(text) {
  const out = [];
  let track = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const head = line.match(/^\s*\[(.+)\]\s*$/);
    if (head) { track = head[1].trim(); continue; }
    const m = track && line.match(/^\s*([^=]+?)\s*=\s*([\d.]+)(?:\s+(\d+))?\s*$/);
    if (!m) continue;
    const time = Number(m[2]);
    if (time > 5 && time < 3600) out.push({ track, bike: m[1], time, at: Number(m[3]) || 0 });
  }
  return out;
}

// The current profile's best laps (the profile MX Bikes opened last).
function readBestLaps(userDir) {
  if (!userDir) return [];
  try {
    const name = fs.readFileSync(path.join(userDir, 'global.ini'), 'latin1').match(/^lastprofile=(.*)$/m)?.[1]?.trim();
    if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) return [];
    return parseRecords(fs.readFileSync(path.join(userDir, 'profiles', name, 'records.ini'), 'latin1'));
  } catch { return []; }
}

module.exports = { parseRecords, readBestLaps };
