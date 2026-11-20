const { prepareResources, verifyPackage } = require('./scripts/release-hooks.cjs');

module.exports = {
  appId: 'com.rare621.mxbikesmanager',
  productName: 'CoreMX',
  executableName: 'CoreMX',
  asar: true,
  npmRebuild: false,
  compression: 'normal',
  releaseInfo: { releaseNotes: require('fs').readFileSync(require('path').join(__dirname, 'build/release-notes.md'), 'utf8') },
  publish: [{ provider: 'github', owner: 'rare621', repo: 'Core-MX' }],
  directories: { output: 'dist', buildResources: 'build' },
  files: [
    'main.js', 'preload.js', 'src/**/*', 'package.json', 'THIRD_PARTY_NOTICES.md',
    '!**/*.map', '!**/.DS_Store',
  ],
  extraResources: [
    { from: 'build/generated/online.config.json', to: 'online.config.json' },
    { from: 'plugin', to: 'plugin', filter: ['mxbm_presence.dlo', 'README.md'] },
    // 7-Zip 26.06 (x64) from 7-zip.org, for unpacking .zip/.rar/.7z mods; License.txt is its licence.
    { from: 'vendor/7zip', to: '7zip', filter: ['7z.exe', '7z.dll', 'License.txt'] },
  ],
  protocols: [{ name: 'CoreMX website and join links', schemes: ['mxbm'] }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/generated/icon.ico',
    signExecutable: false,
    artifactName: 'CoreMX-Setup-${version}-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'CoreMX',
    uninstallDisplayName: 'CoreMX',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    packElevateHelper: false,
    differentialPackage: false,
  },
  beforePack: prepareResources,
  afterPack: verifyPackage,
};
