const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { version } = require('../package.json');
const dir = path.resolve(__dirname, '..', 'dist');
const files = fs.readdirSync(dir).filter((name) => name.startsWith(`CoreMX-Setup-${version}-`) && name.endsWith('.exe')).sort();
if (!files.length) throw new Error('No installer was built for this version');
// Older Drive updaters only recognize this filename. Ship an identical alias
// and point latest.yml to it so existing users can upgrade to the new brand.
for (const name of [...files]) {
  const alias = name.replace('CoreMX-Setup-', 'MX-Bikes-Manager-Setup-');
  fs.copyFileSync(path.join(dir, name), path.join(dir, alias));
  files.push(alias);
}
const manifest = path.join(dir, 'latest.yml');
if (fs.existsSync(manifest)) fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8')
  .replace(/(^\s*(?:url|path):\s*)CoreMX-Setup-/gm, '$1MX-Bikes-Manager-Setup-'));
if (fs.existsSync(path.join(dir, 'mxbm-online-service.zip'))) files.push('mxbm-online-service.zip');
if (fs.existsSync(path.join(dir, 'latest.yml'))) files.push('latest.yml');
const lines = files.map((file) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')}  ${file}`);
fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`Checksums written for ${files.length} release file(s)`);
