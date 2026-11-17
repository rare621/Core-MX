// electron-updater validates the published installer against latest.yml before installation.
function create({ updater, packaged, version, notify = () => {} }) {
  if (packaged && updater.setFeedURL) updater.setFeedURL({ provider: 'github', owner: 'rare621', repo: 'Core-MX' });
  let state = { phase: packaged ? 'idle' : 'development', current: version }, checking = null, started = false, progressAt = 0;
  const publish = (patch) => { state = { ...state, ...patch }; notify({ ...state }); };
  const errorMessage = (_error, fallback) => fallback;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = true;
  updater.on('checking-for-update', () => { if (state.phase !== 'ready') publish({ phase: 'checking', error: '' }); });
  updater.on('update-available', (info) => publish({ phase: 'available', version: info.version, notes: info.releaseNotes || '', percent: 0, error: '' }));
  updater.on('update-not-available', () => { if (state.phase !== 'ready') publish({ phase: 'current', error: '', checkedAt: Date.now() }); });
  updater.on('download-progress', (info) => {
    if (Date.now() - progressAt < 700 && info.percent < 100) return;
    progressAt = Date.now(); publish({ phase: 'downloading', percent: Math.min(100, Math.max(0, Number(info.percent) || 0)) });
  });
  updater.on('update-downloaded', (info) => publish({ phase: 'ready', version: info.version, percent: 100, error: '' }));
  updater.on('error', (error) => { if (state.phase !== 'ready') publish({ phase: 'error', error: errorMessage(error, 'Could not download the GitHub update. Check your connection and try again.') }); });
  async function check() {
    if (!packaged || state.phase === 'ready' || state.phase === 'downloading') return { ...state };
    if (!checking) checking = Promise.resolve().then(async () => {
      try { const result = await updater.checkForUpdates(); result?.downloadPromise?.catch(() => {}); }
      catch (error) { if (state.phase !== 'ready') publish({ phase: 'error', error: errorMessage(error, 'Could not check GitHub for updates. Check your connection and try again.') }); }
      return { ...state };
    }).finally(() => { checking = null; });
    return checking;
  }
  return {
    status: () => ({ ...state }), check,
    download: async () => {
      if (state.phase === 'ready' || state.phase === 'downloading') return { ...state };
      if (state.phase !== 'available') throw new Error('Check for updates before downloading.');
      publish({ phase: 'downloading', percent: 0, error: '' });
      try { await updater.downloadUpdate(); }
      catch (error) { publish({ phase: 'error', error: errorMessage(error, 'The update could not be downloaded. Check now to retry.') }); }
      return { ...state };
    },
    start: () => { if (!started) { started = true; return check(); } return Promise.resolve({ ...state }); },
    install: () => { if (state.phase !== 'ready') throw new Error('The update has not finished downloading'); publish({ phase: 'installing' }); updater.quitAndInstall(true, true); },
  };
}
module.exports = { create };
