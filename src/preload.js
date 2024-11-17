const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message) => ipcRenderer.send('message-from-renderer', message),
  log: (message) => ipcRenderer.send('log', message),
  onMessage: (callback) => ipcRenderer.on('message-from-main', (event, arg) => callback(arg)),
  onLine: (callback) => ipcRenderer.on('log-to-frontend', (event, arg, logLevel) => callback(arg, logLevel)),
  getEnabledModules: () => {
      return new Promise((resolve) => {
          ipcRenderer.once('message-from-main', (event, response) => {
              if(response.type === 'getEnabledModulesResponse') {
                resolve(response.data);
              }
          });
          ipcRenderer.send('message-from-renderer', {type: 'getEnabledModules'});
      });
  },
});