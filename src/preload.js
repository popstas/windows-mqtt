const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message) => ipcRenderer.send('message-from-renderer', message),
  log: (message) => ipcRenderer.send('log', message),
  onMessage: (callback) => ipcRenderer.on('message-from-main', (event, arg) => callback(arg)),
  getEnabledModules: () => ipcRenderer.send('message-from-renderer', {type: 'getEnabledModules'}),
});