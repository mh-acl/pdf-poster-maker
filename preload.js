const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  savePdf: (opts) => ipcRenderer.invoke('save-pdf', opts),
  inspectPdf: (bytes) => ipcRenderer.invoke('inspect-pdf', bytes),
  svgToPdf: (opts) => ipcRenderer.invoke('svg-to-pdf', opts),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } }
});
