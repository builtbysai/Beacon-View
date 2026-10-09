// Sandboxed preload (CommonJS is required for sandboxed preloads). It exposes
// exactly one frozen object -- the contract in
// apps/web-viewer/src/desktop-shell.ts -- and never Node, Electron, or IPC.
// `import = require` is the only import form a .cts file allows under
// verbatimModuleSyntax.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

const { ipcRenderer } = electron;

electron.contextBridge.exposeInMainWorld(
  'beaconDesktop',
  Object.freeze({
    getAutostart(): Promise<boolean> {
      return ipcRenderer.invoke('beacon:get-autostart') as Promise<boolean>;
    },
    setAutostart(enabled: unknown): Promise<boolean> {
      return ipcRenderer.invoke(
        'beacon:set-autostart',
        enabled === true,
      ) as Promise<boolean>;
    },
    setCameraActivity(activity: unknown): void {
      if (activity === 'off' || activity === 'standby' || activity === 'live')
        ipcRenderer.send('beacon:camera-activity', activity);
    },
    setCameraResume(path: unknown): void {
      if (path === null || typeof path === 'string')
        ipcRenderer.send('beacon:camera-resume', path);
    },
    setCaptureActive(active: unknown): void {
      if (typeof active === 'boolean')
        ipcRenderer.send('beacon:camera-activity', active ? 'live' : 'off');
    },
    setTrayCameras(cameras: unknown): void {
      if (Array.isArray(cameras))
        ipcRenderer.send('beacon:tray-cameras', cameras);
    },
    showAlert(alert: unknown): void {
      if (alert && typeof alert === 'object') {
        const { category, eventId, route } = alert as Record<string, unknown>;
        ipcRenderer.send('beacon:show-alert', { category, eventId, route });
      }
    },
    version: 1,
  }),
);
