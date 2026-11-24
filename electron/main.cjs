const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

let mainWindow = null;
let httpServer = null;

function sanitizePdfFilename(raw) {
  const base = path.basename(String(raw || 'upsite-report.pdf')).replace(/[^a-zA-Z0-9._-]/g, '-');
  const trimmed = base.replace(/^-+/, '') || 'upsite-report';
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

function writePdfTempOrDownload(dirPath, filename, base64) {
  if (typeof base64 !== 'string' || base64.length === 0 || base64.length > 20 * 1024 * 1024) {
    throw new Error('Invalid PDF payload.');
  }
  const safeName = sanitizePdfFilename(filename);
  const cleanBase64 = base64.includes(',') ? base64.split(',').pop() : base64;
  const buf = Buffer.from(cleanBase64, 'base64');
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  const fullPath = path.join(dirPath, safeName);
  fs.writeFileSync(fullPath, buf);
  return fullPath;
}

function copyFilePathToOsClipboard(filePath) {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; $sc = New-Object System.Collections.Specialized.StringCollection; $sc.Add($env:UPSITE_PDF_PATH); [System.Windows.Forms.Clipboard]::SetFileDropList($sc)',
        ],
        { env: { ...process.env, UPSITE_PDF_PATH: filePath }, windowsHide: true },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
      return;
    }
    if (process.platform === 'darwin') {
      execFile(
        'osascript',
        ['-e', 'on run argv', '-e', 'set the clipboard to POSIX file (item 1 of argv)', '-e', 'end run', '--', filePath],
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
      return;
    }
    reject(new Error('File clipboard drop is not supported on this OS.'));
  });
}

ipcMain.handle('upsite:copy-pdf-file', async (_event, payload) => {
  try {
    const tempDir = path.join(app.getPath('temp'), 'upsite-reports');
    const filePath = writePdfTempOrDownload(tempDir, payload?.filename, payload?.base64);
    await copyFilePathToOsClipboard(filePath);
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unable to copy PDF file.' };
  }
});

ipcMain.handle('upsite:share-pdf-file', async (_event, payload) => {
  try {
    const targetDir = app.getPath('downloads') || path.join(app.getPath('temp'), 'upsite-reports');
    const filePath = writePdfTempOrDownload(targetDir, payload?.filename, payload?.base64);
    shell.showItemInFolder(filePath);
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unable to save PDF file.' };
  }
});

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
      preload: path.join(__dirname, 'preload.cjs'),
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
