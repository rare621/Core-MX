// Hosting your own MX Bikes dedicated server: writes PiBoSo's documented server config
// (forum.mx-bikes.com topic 197) and runs `mxbikes.exe -dedicated <port> -set params <file>`.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const game = require('./game');

const CONFIG = 'mxbm_server.ini';
const LOG = 'mxbm_server_log.txt';

// Section order as in the official format.
const SECTIONS = ['connection', 'export', 'replay', 'event', 'rating', 'weather', 'hardcore', 'reset', 'race', 'live', 'remote_admin', 'collisions', 'deformation', 'dynamicsurface', 'polls', 'log'];

function clean(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }

// cfg: { port, sections: { connection: {name:..}, event: {...}, ... }, tracks: [{track, layout}] }
function toIni(cfg) {
  const s = JSON.parse(JSON.stringify(cfg.sections || {}));
  s.event = s.event || {};
  const tracks = (cfg.tracks || []).filter((t) => t && t.track).slice(0, 10);
  tracks.forEach((t, i) => {
    const n = i === 0 ? '' : String(i + 1);
    s.event[`track${n}`] = t.track;
    s.event[`track${n}_layout`] = t.layout || '';
  });
  s.log = { file: LOG };
  const out = ['; Written by CoreMX'];
  for (const sec of SECTIONS) {
    const vals = s[sec];
    if (!vals) continue;
    const lines = Object.entries(vals).filter(([, v]) => clean(v) !== '').map(([k, v]) => `${k} = ${clean(v)}`);
    if (!lines.length) continue;
    out.push('', `[${sec}]`, ...lines);
  }
  return out.join('\r\n') + '\r\n';
}

let proc = null;
let startedAt = null;
let runningPort = null;

function validate(cfg) {
  const port = Number(cfg.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be a number between 1024 and 65535');
  if (!clean(cfg.sections && cfg.sections.connection && cfg.sections.connection.name)) throw new Error('Give your server a name');
  if (!(cfg.tracks || []).some((t) => t && t.track)) throw new Error('Pick at least one track');
  return port;
}

async function start(installDir, cfg, onExit) {
  if (proc) throw new Error('Your server is already running');
  const exe = game && installDir && path.join(installDir, 'mxbikes.exe');
  if (!exe || !fs.existsSync(exe)) throw new Error("Couldn't find mxbikes.exe — set the game install folder in Settings.");
  const port = validate(cfg);
  await fsp.writeFile(path.join(installDir, CONFIG), toIni(cfg), 'latin1');
  try { await fsp.rm(path.join(installDir, LOG), { force: true }); } catch {}
  const child = game.launch(exe, ['-dedicated', String(port), '-set', 'params', CONFIG], { keep: true });
  if (!child || child === true) throw new Error("Couldn't start the server");
  proc = child; startedAt = Date.now(); runningPort = port;
  child.on('exit', (code) => { proc = null; startedAt = null; runningPort = null; onExit && onExit(code); });
  return status(installDir);
}

function stop() {
  if (!proc) return false;
  try { proc.kill(); } catch {}
  return true;
}

async function status(installDir) {
  let log = '';
  for (const dir of [installDir, path.join(process.env.USERPROFILE || '', 'Documents', 'PiBoSo', 'MX Bikes')]) {
    try { const t = await fsp.readFile(path.join(dir, LOG), 'latin1'); log = t.split(/\r?\n/).slice(-80).join('\n'); break; } catch {}
  }
  return { running: !!proc, pid: proc ? proc.pid : null, startedAt, port: runningPort, log, configPath: installDir ? path.join(installDir, CONFIG) : null };
}

module.exports = { toIni, start, stop, status, CONFIG, LOG };
