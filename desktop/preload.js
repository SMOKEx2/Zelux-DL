const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zelux', { version: '1.6.0', platform: process.platform, window: { minimize: () => ipcRenderer.send('window-minimize'), maximize: () => ipcRenderer.send('window-maximize'), close: () => ipcRenderer.send('window-close') } });
