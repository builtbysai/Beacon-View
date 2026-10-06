// Sandboxed preload (CommonJS is required for sandboxed preloads). It exposes
// exactly one frozen object -- the contract in
// apps/web-viewer/src/desktop-shell.ts -- and never Node, Electron, or IPC.
// `import = require` is the only import form a .cts file allows under
// verbatimModuleSyntax.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

electron.contextBridge.exposeInMainWorld(
  'beaconDesktop',
  Object.freeze({
    setCaptureActive(active: unknown): void {
      if (typeof active === 'boolean')
        electron.ipcRenderer.send('beacon:capture-state', active);
    },
    version: 1,
  }),
);
