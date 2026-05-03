const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPaths:         ()       => ipcRenderer.invoke('get-paths'),
  getState:         ()       => ipcRenderer.invoke('get-state'),
  saveState:        (data)   => ipcRenderer.invoke('save-state', data),
  scanImages:       ()       => ipcRenderer.invoke('scan-images'),
  openImagesFolder: ()       => ipcRenderer.invoke('open-images-folder'),
  exportPng:        (data)   => ipcRenderer.invoke('export-png', data),
  readImage:        (fn)     => ipcRenderer.invoke('read-image', fn),
  onImagesChanged:  (cb)     => ipcRenderer.on('images-changed', cb),
});
