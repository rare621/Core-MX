const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['jobs:update', 'jobs:review', 'library:changed', 'shops:changed', 'game:status', 'jobs:started', 'deeplink:join', 'frostmod:list', 'host:status', 'online:status']);

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
