const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

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
ipcMain.handle('system-stats', () => {
  const root = app.getPath('downloads');
  let free = 0;
  try { const s = fs.statfsSync(root); free = s.bavail * s.bsize; } catch {}
  const cpus = os.cpus();
  const idle = cpus.reduce((n, c) => n + c.times.idle, 0);
  const total = cpus.reduce((n, c) => n + Object.values(c.times).reduce((a, v) => a + v, 0), 0);
  return { memory: Math.round((1 - os.freemem() / os.totalmem()) * 100), cpu: total ? Math.round((1 - idle / total) * 100) : 0, free, connections: cpus.length };
});
ipcMain.handle('download-start', (event, urls) => {
  const list = Array.isArray(urls) ? urls.filter(u => /^https?:\/\//i.test(u)) : [];
  if (!list.length) throw new Error('No valid URLs');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'zelux.js'), ...list], { cwd: path.join(__dirname, '..'), windowsHide: true });
  child.stdout.on('data', data => event.sender.send('download-output', String(data)));
  child.stderr.on('data', data => event.sender.send('download-output', String(data)));
  child.on('close', code => event.sender.send('download-finished', code));
  return { started: list.length };
});
