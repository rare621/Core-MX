const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const paths = require('../src/lib/paths');
const archive = require('../src/lib/archive');

// 7-Zip ships with CoreMX, so .rar/.7z mods unpack without the player installing anything.
test('the bundled 7-Zip is used first and unpacks mods', async (t) => {
  const exe = paths.bundledSevenZip();
  assert.ok(exe && exe.endsWith(path.join('vendor', '7zip', '7z.exe')));
  assert.equal(paths.detectSevenZip(), exe, 'preferred over an installed 7-Zip');
  const formats = execFileSync(exe, ['i'], { encoding: 'utf8', windowsHide: true });
  assert.match(formats, /\bRar5\b/); assert.match(formats, /\b7z\b/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-7z-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'src', 'rider', 'helmets', 'Test Lid', 'paints'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src', 'rider', 'helmets', 'Test Lid', 'paints', 'Red.pnt'), 'PNT\0paint');
  execFileSync(exe, ['a', '-bso0', '-bsp0', path.join(dir, 'mod.7z'), 'rider'], { cwd: path.join(dir, 'src'), windowsHide: true });
  await archive.extract(path.join(dir, 'mod.7z'), path.join(dir, 'out'), {});
  assert.equal(await fs.readFile(path.join(dir, 'out', 'rider', 'helmets', 'Test Lid', 'paints', 'Red.pnt'), 'utf8'), 'PNT\0paint');
});
