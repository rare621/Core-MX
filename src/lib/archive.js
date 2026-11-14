// Archive extraction using 7-Zip (preferred), WinRAR's UnRAR, or Windows' built-in tar (bsdtar).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { detectSevenZip, detectUnrar, detectTar } = require('./paths');

const ARCHIVES = /\.(zip|rar|7z)$/i;

function run(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(exe)} failed: ${(stderr || stdout || err.message).toString().trim().slice(0, 400)}`));
      else resolve(stdout);
    });
  });
}

function tools(settings = {}) {
  return {
    sevenZip: settings.sevenZipPath && fs.existsSync(settings.sevenZipPath) ? settings.sevenZipPath : detectSevenZip(),
    unrar: detectUnrar(),
    tar: detectTar(),
  };
}

async function extract(file, outDir, settings) {
  fs.mkdirSync(outDir, { recursive: true });
  const t = tools(settings);
  const isRar = /\.rar$/i.test(file);
  const errors = [];
  if (t.sevenZip) {
    try { await run(t.sevenZip, ['x', '-y', '-bso0', '-bsp0', `-o${outDir}`, file]); return; } catch (e) { errors.push(e.message); }
  }
  if (isRar && t.unrar) {
    try { await run(t.unrar, ['x', '-y', '-o+', file, outDir + path.sep]); return; } catch (e) { errors.push(e.message); }
  }
  if (t.tar) {
    try { await run(t.tar, ['-xf', file, '-C', outDir]); return; } catch (e) { errors.push(e.message); }
  }
  throw new Error(errors.length ? errors.join('\n') : 'No extraction tool found. Install 7-Zip (7-zip.org) to unpack .zip/.rar/.7z mods.');
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, rel));
    else out.push({ rel, abs, size: fs.statSync(abs).size });
  }
  return out;
}

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;

// Stage a downloaded file: extract archives (and nested archives one level deep), return file list.
async function stage(file, stageDir, settings) {
  if (!ARCHIVES.test(file)) {
    return [{ rel: path.basename(file), abs: file, size: fs.statSync(file).size }];
  }
  const x = path.join(stageDir, 'x');
  await extract(file, x, settings);
  let files = walk(x).filter((f) => !JUNK.test(f.rel));
  const nested = files.filter((f) => ARCHIVES.test(f.rel));
  if (nested.length) {
    for (const n of nested) {
      const sub = path.join(stageDir, 'n', path.basename(n.rel).replace(/\.[^.]+$/, ''));
      try {
        await extract(n.abs, sub, settings);
        const prefix = n.rel.replace(/\.[^.]+$/, '');
        files = files.filter((f) => f !== n);
        files.push(...walk(sub).filter((f) => !JUNK.test(f.rel)).map((f) => ({ ...f, rel: `${prefix}/${f.rel}` })));
      } catch { /* leave nested archive as-is */ }
    }
  }
  return files;
}

module.exports = { extract, stage, tools, ARCHIVES };
