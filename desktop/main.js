const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1120, minHeight: 720,
    frame: false, autoHideMenuBar: true,
    backgroundColor: '#0b0815', title: 'ZELUX-DL Pulse',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
ipcMain.on('window-minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.on('window-maximize', event => { const win=BrowserWindow.fromWebContents(event.sender); if(win?.isMaximized()) win.unmaximize(); else win?.maximize(); });
ipcMain.on('window-close', event => BrowserWindow.fromWebContents(event.sender)?.close());
