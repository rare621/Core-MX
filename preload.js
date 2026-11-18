const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['app:update', 'jobs:update', 'jobs:review', 'library:changed', 'rider:changed', 'rider:pendingApplied', 'missing:track', 'plugin:hook', 'shops:changed', 'game:status', 'jobs:started', 'deeplink:join', 'deeplink:open', 'servers:discovered', 'host:status', 'online:status']);

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) return () => {};
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
});
