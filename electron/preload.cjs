const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('upsiteDesktop', {
  isDesktop: true,
  copyPdfFile: (filename, base64) =>
    ipcRenderer.invoke('upsite:copy-pdf-file', { filename, base64 }),
  sharePdfFile: (filename, base64) =>
    ipcRenderer.invoke('upsite:share-pdf-file', { filename, base64 }),
  showNotification: (payload) =>
    ipcRenderer.invoke('upsite:show-notification', payload),
  onNotificationClick: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, id) => callback(id);
    ipcRenderer.on('upsite:notification-click', listener);
    return () => ipcRenderer.removeListener('upsite:notification-click', listener);
  },
  setTraySettings: (payload) =>
    ipcRenderer.invoke('upsite:set-tray-settings', payload),
  minimizeToTrayNow: () =>
    ipcRenderer.invoke('upsite:minimize-to-tray'),
  updateTrayStatus: (payload) =>
    ipcRenderer.invoke('upsite:update-tray-status', payload),
  onTrayRunOrg: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('upsite:tray-run-org', listener);
    return () => ipcRenderer.removeListener('upsite:tray-run-org', listener);
  },
  setLaunchAtStartup: (enabled) =>
    ipcRenderer.invoke('upsite:set-launch-at-startup', enabled),
});
