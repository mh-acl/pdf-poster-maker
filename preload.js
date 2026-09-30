const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  savePdf: (opts) => ipcRenderer.invoke('save-pdf', opts),
  inspectPdf: (bytes) => ipcRenderer.invoke('inspect-pdf', bytes)
});
