const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  savePdf: (opts) => ipcRenderer.invoke('save-pdf', opts),
  inspectPdf: (bytes) => ipcRenderer.invoke('inspect-pdf', bytes),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } }
});
