// Preload runs in the renderer before the page loads.
// We expose a flag so the React app knows it's inside Electron.
window.PALBOX_ELECTRON = true;

export {};

declare global {
  interface Window {
    PALBOX_ELECTRON: boolean;
  }
}
