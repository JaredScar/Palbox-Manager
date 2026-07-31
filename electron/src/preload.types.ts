/** Shared type declaration for the contextBridge API surface. */
export interface PalboxAPI {
  isElectron: true;
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => () => void;
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void;
  onUpdateProgress: (cb: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void;
  onUpdateError: (cb: (message: string) => void) => () => void;
  installUpdate: () => void;
  checkForUpdates: () => void;
  getVersion: () => Promise<string>;
  notify: (title: string, body: string) => void;
  openEnv: () => void;
}

declare global {
  interface Window {
    palbox?: PalboxAPI;
  }
}
