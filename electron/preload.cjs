const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('upsiteDesktop', {
  isDesktop: true,
  copyPdfFile: (filename, base64) =>
    ipcRenderer.invoke('upsite:copy-pdf-file', { filename, base64 }),
  sharePdfFile: (filename, base64) =>
    ipcRenderer.invoke('upsite:share-pdf-file', { filename, base64 }),
});
