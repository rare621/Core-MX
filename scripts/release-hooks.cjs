const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

function releaseServiceUrl(value = '') {
  if (!value.trim()) return '';
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MXB_SERVICE_URL must be an HTTP(S) server origin without credentials or a path');
  }
  return url.origin;
}

async function prepareResources(context) {
  const root = context.packager.projectDir;
  const target = path.join(root, 'build', 'generated');
  fs.mkdirSync(target, { recursive: true });
  // Inherit the project's configured server unless the build explicitly overrides it.
  const configured = JSON.parse(fs.readFileSync(path.join(root, 'online.config.json'), 'utf8'));
  const serviceUrl = releaseServiceUrl(process.env.MXB_SERVICE_URL || configured.serviceUrl || '');
  const bundled = { serviceUrl };
  if (serviceUrl === releaseServiceUrl(configured.serviceUrl || '') && Array.isArray(configured.previousServiceUrls)) {
    bundled.previousServiceUrls = configured.previousServiceUrls.map(releaseServiceUrl).filter(Boolean);
  }
  fs.writeFileSync(path.join(target, 'online.config.json'), JSON.stringify(bundled, null, 2) + '\n');
  if (!fs.existsSync(path.join(root, 'plugin', 'mxbm_presence.dlo'))) throw new Error('The bundled presence plugin is missing');
}

async function verifyPackage({ appOutDir, packager }) {
  const archive = path.join(appOutDir, 'resources', 'app.asar');
  const files = asar.listPackage(archive).map((name) => name.replace(/\\/g, '/').replace(/^\//, ''));
  const forbidden = files.filter((name) => /^(?:\.git|\.tmp|test|scripts|server|dist|docs|build|CODEX_NOTES\.md|MODDING_PLAN\.md|online\.config\.json)(?:\/|$)/i.test(name)
    || /(?:^|\/)(?:data\.json|mxbm-data\.json|Cookies(?:-journal)?|Login Data|\.env)$/.test(name)
    || /\.(?:pkz|pnt|edf|lnk)$/i.test(name));
  if (forbidden.length) throw new Error(`Unexpected release content: ${forbidden.slice(0, 10).join(', ')}`);
  for (const required of ['main.js', 'preload.js', 'src/renderer/index.html', 'node_modules/three/build/three.module.min.js', 'THIRD_PARTY_NOTICES.md']) {
    if (!files.includes(required)) throw new Error(`Release is missing ${required}`);
  }
  const bundled = JSON.parse(fs.readFileSync(path.join(appOutDir, 'resources', 'online.config.json'), 'utf8'));
  const expected = JSON.parse(fs.readFileSync(path.join(packager.projectDir, 'build', 'generated', 'online.config.json'), 'utf8'));
  if (JSON.stringify(bundled) !== JSON.stringify(expected)) throw new Error('The installer online-service configuration does not match its build configuration');
  console.log(`  verified release contents (${files.length} entries; no game assets or user data)`);
  console.log(`  verified bundled online service: ${bundled.serviceUrl || '(none)'}`);
}

module.exports = { releaseServiceUrl, prepareResources, verifyPackage };
