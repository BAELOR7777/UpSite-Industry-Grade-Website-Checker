const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  shell,
} = require('electron');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.upsite.desktop');
}

let mainWindow = null;
let httpServer = null;
let tray = null;
let isQuitting = false;
let minimizeToTray = true;
let trayStatusSummary = 'Ready';
let trayDownCount = 0;
const startMinimized = process.argv.includes('--minimized');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([lenBuf, combined, crcBuf]);
}

function createTrayIconImage(downCount = 0) {
  const size = 32;
  const raw = Buffer.alloc(size * (1 + size * 4));
  // Cobalt Blue (#2563EB) normally, Crimson (#E11D48) badge dot if sites are down
  const bgR = 37;
  const bgG = 99;
  const bgB = 235;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x += 1) {
      const idx = rowStart + 1 + x * 4;
      const dx = x - 15.5;
      const dy = y - 15.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded circle badge
      if (dist > 14.5) {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
        continue;
      }

      // Crisp white "U" / pulse arc inside
      const inOuterRing = dist >= 6.5 && dist <= 9.2 && (y >= 11 || Math.abs(dx) >= 4.5);
      const inInnerDot = dist <= 3.1;
      const isAlertBadge = downCount > 0 && x >= 20 && y <= 11 && Math.hypot(x - 24, y - 7) <= 5.2;

      if (isAlertBadge) {
        raw[idx] = 225;
        raw[idx + 1] = 29;
        raw[idx + 2] = 72;
        raw[idx + 3] = 255;
      } else if (inOuterRing || inInnerDot) {
        raw[idx] = 255;
        raw[idx + 1] = 255;
        raw[idx + 2] = 255;
        raw[idx + 3] = 255;
      } else {
        raw[idx] = bgR;
        raw[idx + 1] = bgG;
        raw[idx + 2] = bgB;
        raw[idx + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const pngBuffer = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return nativeImage.createFromBuffer(pngBuffer);
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  refreshTrayMenu();
}

function hideMainWindowToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const visible = Boolean(mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized());
  tray.setToolTip(`upsite — ${trayStatusSummary}`);
  const menu = Menu.buildFromTemplate([
    { label: `upsite · ${trayStatusSummary}`, enabled: false },
    { type: 'separator' },
    {
      label: visible ? 'Minimize to Tray' : 'Show upsite',
      click: () => {
        if (visible) hideMainWindowToTray();
        else showMainWindow();
      },
    },
    {
      label: 'Run Organisation Checks',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('upsite:tray-run-org');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit upsite',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function ensureTray() {
  if (tray) return;
  try {
    tray = new Tray(createTrayIconImage(trayDownCount));
    tray.on('click', () => {
      if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
        hideMainWindowToTray();
      } else {
        showMainWindow();
      }
    });
    tray.on('double-click', showMainWindow);
    refreshTrayMenu();
  } catch {
    tray = null;
  }
}

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

ipcMain.handle('upsite:show-notification', (_event, payload) => {
  try {
    if (!Notification.isSupported()) {
      return { ok: false };
    }
    const title = String(payload?.title || 'upsite Alert').slice(0, 120);
    const body = String(payload?.body || '').slice(0, 300);
    const id = payload?.id ? String(payload.id) : '';
    const note = new Notification({
      title,
      body,
      silent: false,
    });
    note.on('click', () => {
      showMainWindow();
      if (mainWindow && id) {
        mainWindow.webContents.send('upsite:notification-click', id);
      }
    });
    note.show();
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('upsite:set-tray-settings', (_event, payload) => {
  minimizeToTray = payload?.minimizeToTray !== false;
  refreshTrayMenu();
  return { ok: true };
});

ipcMain.handle('upsite:minimize-to-tray', () => {
  ensureTray();
  hideMainWindowToTray();
  return { ok: true };
});

ipcMain.handle('upsite:update-tray-status', (_event, payload) => {
  const nextDown = typeof payload?.downCount === 'number' ? Math.max(0, payload.downCount) : 0;
  const nextSummary =
    typeof payload?.summary === 'string' && payload.summary.trim()
      ? payload.summary.trim().slice(0, 80)
      : 'Ready';
  const iconChanged = (nextDown > 0) !== (trayDownCount > 0);
  trayDownCount = nextDown;
  trayStatusSummary = nextSummary;
  if (tray) {
    if (iconChanged) {
      tray.setImage(createTrayIconImage(trayDownCount));
    }
    refreshTrayMenu();
  }
  return { ok: true };
});

ipcMain.handle('upsite:set-launch-at-startup', (_event, enabled) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      args: ['--minimized'],
    });
    return { ok: true };
  } catch {
    return { ok: false };
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
    minWidth: 420,
    minHeight: 480,
    show: !startMinimized,
    title: 'upsite',
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  ensureTray();

  mainWindow.on('focus', () => {
    mainWindow?.flashFrame(false);
    refreshTrayMenu();
  });

  mainWindow.on('show', refreshTrayMenu);
  mainWindow.on('hide', refreshTrayMenu);

  mainWindow.on('minimize', (event) => {
    if (minimizeToTray && tray) {
      event.preventDefault();
      hideMainWindowToTray();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && minimizeToTray && tray) {
      event.preventDefault();
      hideMainWindowToTray();
    }
  });

  // Enable standard right-click Cut / Copy / Paste / Select All context menu everywhere
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo },
        { label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      template.push(
        { label: 'Copy', role: 'copy' },
        { label: 'Select All', role: 'selectAll' },
      );
    } else {
      template.push({ label: 'Select All', role: 'selectAll' });
    }

    if (template.length > 0) {
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow });
    }
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

app.on('activate', () => {
  if (mainWindow) {
    showMainWindow();
  } else {
    void createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  if (!isQuitting && minimizeToTray && tray) {
    return;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
