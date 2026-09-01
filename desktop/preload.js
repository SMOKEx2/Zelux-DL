const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('zelux', { version: '1.6.0', platform: process.platform });
