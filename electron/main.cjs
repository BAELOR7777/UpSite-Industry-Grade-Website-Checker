const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, shell } = require('electron');

let mainWindow = null;
let httpServer = null;

async function listenOnPort(expressApp, port) {
  return new Promise((resolve, reject) => {
    const srv = expressApp.listen(port, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind local port'));
        return;
      }
      resolve({ server: srv, port: addr.port });
    });
    srv.on('error', reject);
  });
}

async function startLocalBackend() {
  const compiledEntry = path.join(__dirname, '..', 'dist-server', 'server.mjs');
  const sourceEntry = path.join(__dirname, '..', 'server.ts');
  const targetPath = fs.existsSync(compiledEntry) ? compiledEntry : sourceEntry;

  process.env.NODE_ENV = 'production';
  process.env.UPSITE_DATA_DIR = path.join(app.getPath('userData'), 'data');
  const mod = await import(pathToFileURL(targetPath).href);
  const expressApp = await mod.createServer();

  try {
    return await listenOnPort(expressApp, 47381);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      return listenOnPort(expressApp, 0);
    }
    throw err;
  }
}

async function createWindow() {
  const { server, port } = await startLocalBackend();
  httpServer = server;
  const localOrigin = `http://127.0.0.1:${port}`;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'upsite',
    backgroundColor: '#0F111A',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(localOrigin)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(url);
      }
    } catch {
      // Ignore invalid URLs
    }
    return { action: 'deny' };
  });

  await mainWindow.loadURL(localOrigin);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
