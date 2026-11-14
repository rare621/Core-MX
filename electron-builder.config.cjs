const { prepareResources, verifyPackage } = require('./scripts/release-hooks.cjs');

module.exports = {
  appId: 'com.rare621.mxbikesmanager',
  productName: 'MX Bikes Manager',
  executableName: 'MX Bikes Manager',
  asar: true,
  npmRebuild: false,
  compression: 'normal',
  directories: { output: 'dist', buildResources: 'build' },
  files: [
    'main.js', 'preload.js', 'src/**/*', 'package.json', 'THIRD_PARTY_NOTICES.md',
    '!**/*.map', '!**/.DS_Store',
  ],
  extraResources: [
    { from: 'build/generated/online.config.json', to: 'online.config.json' },
    { from: 'plugin', to: 'plugin', filter: ['mxbm_presence.dlo', 'README.md'] },
  ],
  protocols: [{ name: 'MX Bikes Manager join links', schemes: ['mxbm'] }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/generated/icon.ico',
    signExecutable: false,
    artifactName: 'MX-Bikes-Manager-Setup-${version}-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MX Bikes Manager',
    uninstallDisplayName: 'MX Bikes Manager',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    packElevateHelper: false,
    differentialPackage: false,
  },
  beforePack: prepareResources,
  afterPack: verifyPackage,
};
