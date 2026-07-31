/**
 * Preload runs in an isolated world before the page loads.
 * contextBridge is the only way to share data with the renderer
 * when contextIsolation: true (which is our security default).
 */
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('palbox', {
  isElectron: true as const,

  // ── Updater ────────────────────────────────────────────────────────────────
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => {
    ipcRenderer.on('update-available', (_e, info) => cb(info));
    return () => ipcRenderer.removeAllListeners('update-available');
  },
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on('update-downloaded', (_e, info) => cb(info));
    return () => ipcRenderer.removeAllListeners('update-downloaded');
  },
  onUpdateProgress: (cb: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
    ipcRenderer.on('update-progress', (_e, p) => cb(p));
    return () => ipcRenderer.removeAllListeners('update-progress');
  },
  onUpdateError: (cb: (message: string) => void) => {
    ipcRenderer.on('update-error', (_e, msg) => cb(msg));
    return () => ipcRenderer.removeAllListeners('update-error');
  },
  installUpdate:   () => ipcRenderer.send('install-update'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  getVersion:      () => ipcRenderer.invoke('get-version') as Promise<string>,

  // ── Existing IPC ──────────────────────────────────────────────────────────
  notify:  (title: string, body: string) => ipcRenderer.send('notify', { title, body }),
  openEnv: () => ipcRenderer.send('open-env'),
} satisfies import('./preload.types').PalboxAPI);

export {};
