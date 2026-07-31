import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  shell,
  Notification,
  ipcMain,
  dialog,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { spawn, execSync, ChildProcess } from 'child_process';
import fs from 'fs';

// ── GPU / hardware-acceleration guard ────────────────────────────────────────
//
// On Windows VPS / Server hosts the GPU process crashes fatally (error_code=18)
// before any Node.js event handlers can fire — so a "detect on crash" approach
// cannot work.  We must decide synchronously at module load time, before
// app.whenReady(), whether to enable or disable hardware acceleration.
//
// Strategy:
//  • Query Win32_VideoController via wmic/PowerShell synchronously.
//  • If every adapter is a "Microsoft Basic Display Adapter" or an RDP/Citrix
//    virtual adapter (i.e. no real GPU), disable hardware acceleration.
//  • If at least one real GPU is found, leave acceleration enabled.
//  • On non-Windows platforms we rely on Electron's own detection.

function queryGPUNames(): string[] {
  if (process.platform !== 'win32') return ['real-gpu']; // non-Windows: assume GPU present

  const cmds = [
    // wmic — available on Windows 10 / Server 2019+
    'wmic path Win32_VideoController get Name /format:value',
    // PowerShell fallback (wmic removed in some Windows 11 builds)
    'powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_VideoController).Name -join \'||\'"',
  ];

  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 4000, stdio: 'pipe' });
      if (out.trim()) return out.split(/\r?\n|[||]+/).map(l => l.replace(/^Name=/i, '').trim()).filter(Boolean);
    } catch { /* try next */ }
  }
  return []; // could not determine — treat as no GPU
}

function shouldDisableGPU(): boolean {
  const names = queryGPUNames();
  if (names.length === 0) return true; // no adapters found → headless

  const VIRTUAL_PATTERNS = [
    /microsoft basic display/i,
    /remote desktop/i,
    /citrix/i,
    /vmware svga/i,
    /virtualbox/i,
    /hyper-v video/i,
    /parsec/i,
  ];

  // If every adapter matches a virtual/basic pattern, there is no real GPU
  return names.every(name => VIRTUAL_PATTERNS.some(p => p.test(name)));
}

if (shouldDisableGPU()) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

const API_URL = 'http://localhost:4000';
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let apiProcess: ChildProcess | null = null;
let isQuitting = false;

// ── Resource paths ────────────────────────────────────────────────────────────

/**
 * When packaged, the API and UI are bundled into extraResources.
 * Structure in the installed app:
 *   resources/
 *     api/dist/          <- compiled API
 *     api/node_modules/  <- API dependencies
 *     ui/dist/           <- built SPA (served statically by the API)
 *     .env               <- user's config file
 */
const apiDir = app.isPackaged
  ? path.join(process.resourcesPath, 'api')
  : path.join(__dirname, '../../api');

const uiDist = app.isPackaged
  ? path.join(process.resourcesPath, 'ui', 'dist')
  : path.join(__dirname, '../../ui/dist');

// User config lives in the OS appData folder so it survives updates
const envFile = app.isPackaged
  ? path.join(app.getPath('userData'), '.env')
  : path.join(__dirname, '../../api/.env');

// ── Node discovery ────────────────────────────────────────────────────────────

/** Find the node executable on the system PATH (cross-platform). */
function findNodeExe(): string {
  // In dev mode the current exe IS node (via tsx / ts-node)
  if (!app.isPackaged) return process.execPath;

  const candidates: string[] = [];

  // Ask the shell where node lives — command differs by platform
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node';
    const result = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    candidates.push(...result.trim().split(/\r?\n/).filter(Boolean));
  } catch { /* not on PATH */ }

  // Common fallback locations per platform
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      path.join(process.env.APPDATA ?? '', '..\\Local\\Programs\\nodejs\\node.exe'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/opt/homebrew/bin/node',   // Apple Silicon Homebrew
      '/usr/local/bin/node',      // Intel Homebrew / nvm
      '/usr/bin/node',
    );
  } else {
    candidates.push(
      '/usr/local/bin/node',
      '/usr/bin/node',
    );
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'node';
}

// ── .env bootstrap ────────────────────────────────────────────────────────────

/**
 * On first launch after install, seed the user's .env from the bundled example.
 * The API reads from dotenv on startup, so we just need the file to exist.
 */
function ensureEnv(): void {
  if (!app.isPackaged) return;
  if (fs.existsSync(envFile)) return;

  const examplePath = path.join(process.resourcesPath, '.env.example');
  if (fs.existsSync(examplePath)) {
    // Auto-generate a JWT secret to make first-boot secure by default
    const { randomBytes } = require('crypto');
    let example = fs.readFileSync(examplePath, 'utf8');
    example = example.replace(
      /^JWT_SECRET=.*$/m,
      `JWT_SECRET=${randomBytes(48).toString('hex')}`,
    );
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, example, 'utf8');
  }
}

// ── API process ───────────────────────────────────────────────────────────────

function startApi(): void {
  const nodeExe = findNodeExe();
  const apiScript = app.isPackaged
    ? path.join(apiDir, 'dist', 'index.js')
    : path.join(apiDir, 'src', 'index.ts');

  // Validate node.exe actually exists
  if (app.isPackaged && !fs.existsSync(nodeExe) && nodeExe === 'node') {
    dialog.showErrorBox(
      'Node.js not found',
      'Palbox requires Node.js 22 or newer.\n\nPlease install it from https://nodejs.org and restart the app.',
    );
    app.quit();
    return;
  }

  const args = app.isPackaged
    ? [apiScript]
    : ['--import', 'tsx', apiScript];

  apiProcess = spawn(nodeExe, args, {
    cwd: apiDir,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: envFile,
      PALBOX_ELECTRON: 'true',
      // Tell the API where to find the UI's static files
      UI_DIST: uiDist,
    },
    stdio: 'inherit',
  });

  apiProcess.on('exit', (code) => {
    if (!isQuitting) {
      console.warn(`API process exited (code ${code}) — restarting in 3 s`);
      setTimeout(startApi, 3000);
    }
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#120F1C',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: getIcon(),
    show: false,
  });

  loadWithRetry();

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function loadWithRetry(retries = 30): void {
  fetch(API_URL + '/api/health')
    .then(() => mainWindow?.loadURL(API_URL))
    .catch(() => {
      if (retries > 0) setTimeout(() => loadWithRetry(retries - 1), 1000);
      else {
        dialog.showErrorBox(
          'API failed to start',
          'The Palbox API did not respond after 30 seconds.\n\nCheck that Node.js is installed and no other process is using port 4000.',
        );
      }
    });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray(): void {
  tray = new Tray(getIcon());
  tray.setToolTip('Palbox — Palworld Server Panel');

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Palbox',      click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Open in browser',  click: () => shell.openExternal(API_URL) },
    { label: 'Open config file', click: () => shell.openPath(envFile) },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));

  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.focus();
    else mainWindow?.show();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getIcon(): Electron.NativeImage {
  const iconPath = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
    'assets',
    'icon.png',
  );
  try { return nativeImage.createFromPath(iconPath); }
  catch { return nativeImage.createEmpty(); }
}

// ── App events ────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  ensureEnv();

  if (!process.env.PALBOX_EXTERNAL_API) {
    startApi();
  }

  createWindow();
  createTray();
  initAutoUpdater();

  app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });

  if (process.argv.includes('--hidden')) {
    mainWindow?.hide();
  }
});

app.on('window-all-closed', (e: Event) => e.preventDefault());
app.on('before-quit', () => { isQuitting = true; apiProcess?.kill(); });
app.on('activate', () => mainWindow?.show());

// IPC: native notifications
ipcMain.on('notify', (_event, { title, body }: { title: string; body: string }) => {
  new Notification({ title, body, icon: getIcon() }).show();
});

// IPC: open config file for editing
ipcMain.on('open-env', () => shell.openPath(envFile));

// IPC: version query from renderer
ipcMain.handle('get-version', () => app.getVersion());

// IPC: trigger update install
ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

// IPC: manual update check from renderer
ipcMain.on('check-for-updates', () => {
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
});

// ── Auto-updater ─────────────────────────────────────────────────────────────

function initAutoUpdater(): void {
  if (!app.isPackaged) return; // Skip in dev — no release feed available

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
    tray?.setToolTip(`Palbox — Update v${info.version} available`);
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-progress', {
      percent:        progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred:    progress.transferred,
      total:          progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', { version: info.version });
    // Offer restart via system notification too
    const n = new Notification({
      title: 'Palbox update ready',
      body:  `v${info.version} downloaded — click to restart and install.`,
      icon:  getIcon(),
    });
    n.on('click', () => autoUpdater.quitAndInstall());
    n.show();
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-error', err.message);
  });

  // First check 60 s after launch to not slow startup, then every 6 hours
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 60_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}
