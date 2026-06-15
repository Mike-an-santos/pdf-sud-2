const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenPDF: (callback) => ipcRenderer.on('open-pdf', (event, payload) => callback(payload)),
  imprimir: () => ipcRenderer.invoke('imprimir'),
  imprimirPDF: (base64) => ipcRenderer.invoke('imprimir-pdf', base64)
});
