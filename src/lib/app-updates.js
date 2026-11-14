// electron-updater validates the published installer against latest.yml before installation.
function create({ updater, packaged, version, notify = () => {} }) {
  let state = { phase: packaged ? 'idle' : 'development', current: version }, checking = null, started = false, progressAt = 0;
  const publish = (patch) => { state = { ...state, ...patch }; notify({ ...state }); };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = true;
  updater.on('checking-for-update', () => { if (state.phase !== 'ready') publish({ phase: 'checking', error: '' }); });
  updater.on('update-available', (info) => publish({ phase: 'downloading', version: info.version, percent: 0, error: '' }));
  updater.on('update-not-available', () => { if (state.phase !== 'ready') publish({ phase: 'current', error: '', checkedAt: Date.now() }); });
  updater.on('download-progress', (info) => {
    if (Date.now() - progressAt < 700 && info.percent < 100) return;
    progressAt = Date.now(); publish({ phase: 'downloading', percent: Math.min(100, Math.max(0, Number(info.percent) || 0)) });
  });
  updater.on('update-downloaded', (info) => publish({ phase: 'ready', version: info.version, percent: 100, error: '' }));
  updater.on('error', () => { if (state.phase !== 'ready') publish({ phase: 'error', error: 'Could not reach the GitHub update or finish downloading it. Check your connection and try again.' }); });
  async function check() {
    if (!packaged || state.phase === 'ready' || state.phase === 'downloading') return { ...state };
    if (!checking) checking = Promise.resolve().then(async () => {
      try { const result = await updater.checkForUpdates(); result?.downloadPromise?.catch(() => {}); }
      catch { if (state.phase !== 'ready') publish({ phase: 'error', error: 'Could not check GitHub for updates. Try again later.' }); }
      return { ...state };
    }).finally(() => { checking = null; });
    return checking;
  }
  return {
    status: () => ({ ...state }), check,
    start: () => { if (!started) { started = true; return check(); } return Promise.resolve({ ...state }); },
    install: () => { if (state.phase !== 'ready') throw new Error('The update has not finished downloading'); updater.quitAndInstall(false, true); },
  };
}
module.exports = { create };
