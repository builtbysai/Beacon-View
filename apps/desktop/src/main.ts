import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  Notification,
  powerSaveBlocker,
  session,
  shell,
  systemPreferences,
} from 'electron';

import {
  autostartSupported,
  getOpenAtLogin,
  launchedInBackground,
  setOpenAtLogin,
} from './autostart.js';
import { APP_ID, resolveAppOrigin } from './config.js';
import {
  DEEP_LINK_SCHEME,
  type DesktopAuthLink,
  findDesktopAuthLink,
  parseDesktopAuthLink,
} from './deep-link.js';
import {
  exchangeScript,
  googleStartUrl,
  parseExchangeResult,
  PendingGoogleSignIn,
} from './google-sign-in.js';
import {
  classifyNavigation,
  isAppUrl,
  type NavigationDecision,
} from './navigation-policy.js';
import { isPermissionGranted } from './permissions.js';
import { readPreferences, writePreferences } from './preferences.js';
import { BeaconTray } from './tray.js';

const appRoot = path.join(import.meta.dirname, '..');
const assetsDirectory = path.join(appRoot, 'assets');
const appOrigin = resolveAppOrigin(
  app.isPackaged,
  process.env.BEACON_DESKTOP_ORIGIN,
);
const SIGN_IN_TTL_MS = 10 * 60 * 1_000;
const ERR_ABORTED = -3;

if (!app.isPackaged && process.env.BEACON_DESKTOP_USER_DATA)
  app.setPath('userData', path.resolve(process.env.BEACON_DESKTOP_USER_DATA));

const preferencesFile = path.join(
  app.getPath('userData'),
  'desktop-preferences.json',
);
const preferences = readPreferences(preferencesFile);
const pendingSignIn = new PendingGoogleSignIn(SIGN_IN_TTL_MS);

let mainWindow: BrowserWindow | null = null;
let tray: BeaconTray | null = null;
let quitting = false;
let captureActive = false;
let captureBlocker: number | null = null;

function appUrl(pathname: string): string {
  return new URL(pathname, appOrigin).href;
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ body, silent: true, title });
  notification.on('click', () => showWindow());
  notification.show();
}

function showWindow(): BrowserWindow {
  const window = mainWindow ?? createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

// --- Capture visibility -----------------------------------------------------

function notifyStillLive(): void {
  notify(
    'Beacon Camera Mode is still live',
    'This computer keeps broadcasting while the window is closed. Choose Quit Beacon in the tray to stop.',
  );
}

function setCaptureActive(active: boolean): void {
  if (active === captureActive) return;
  captureActive = active;
  tray?.setLive(active);
  if (active) {
    captureBlocker = powerSaveBlocker.start('prevent-app-suspension');
    if (mainWindow && !mainWindow.isVisible()) notifyStillLive();
  } else if (captureBlocker !== null) {
    powerSaveBlocker.stop(captureBlocker);
    captureBlocker = null;
  }
}

ipcMain.on('beacon:capture-state', (event, active: unknown) => {
  const frame = event.senderFrame;
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    !frame ||
    frame !== event.sender.mainFrame ||
    !isAppUrl(frame.url, appOrigin) ||
    typeof active !== 'boolean'
  )
    return;
  setCaptureActive(active);
});

// --- Google sign-in through the system browser (ADR 0082) -------------------

function startGoogleSignIn(addPassword: boolean): void {
  const challenge = pendingSignIn.begin();
  void shell.openExternal(googleStartUrl(appOrigin, challenge, addPassword));
}

async function completeGoogleSignIn(link: DesktopAuthLink): Promise<void> {
  const verifier = pendingSignIn.take();
  // A link this app did not ask for (no verifier) is dropped silently.
  if (!verifier) return;
  const window = showWindow();
  let destination = '/?googleSignIn=failed';
  if (link.kind === 'code') {
    try {
      if (!isAppUrl(window.webContents.getURL(), appOrigin))
        await window.loadURL(appUrl('/'));
      const outcome = parseExchangeResult(
        await window.webContents.executeJavaScript(
          exchangeScript(link.code, verifier),
        ),
      );
      if (outcome.kind === 'signedIn') destination = outcome.path;
      else if (outcome.kind === 'linkRequired')
        destination = '/?googleSignIn=linkRequired';
    } catch {
      // Falls through to the web viewer's own failed-sign-in message.
    }
  }
  await window.loadURL(appUrl(destination)).catch(() => undefined);
}

function handleDeepLink(link: DesktopAuthLink | null): void {
  if (link) void completeGoogleSignIn(link);
}

// --- Navigation -------------------------------------------------------------

function openExternal(url: string): void {
  const protocol = new URL(url).protocol;
  if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:')
    void shell.openExternal(url);
}

async function finishGoogleInBrowser(settingsPath: string): Promise<void> {
  const parent = mainWindow ?? undefined;
  const options = {
    buttons: ['Open in browser', 'Cancel'],
    cancelId: 1,
    defaultId: 0,
    detail:
      'Google doesn’t allow its sign-in page inside desktop apps. Finish connecting your Google account from Beacon in your web browser.',
    message: 'Continue in your browser',
    type: 'info' as const,
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (response === 0) openExternal(appUrl(settingsPath));
}

function act(decision: NavigationDecision): void {
  switch (decision.kind) {
    case 'google-sign-in':
      startGoogleSignIn(decision.addPassword);
      return;
    case 'google-in-browser':
      void finishGoogleInBrowser(decision.settingsPath);
      return;
    case 'external':
      openExternal(decision.url);
      return;
    default:
      return;
  }
}

// --- Window -----------------------------------------------------------------

function showOfflinePage(window: BrowserWindow): void {
  void window
    .loadFile(path.join(appRoot, 'static', 'offline.html'), {
      query: { origin: appOrigin },
    })
    .catch(() => undefined);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#090d16',
    height: 820,
    icon: path.join(assetsDirectory, 'icon.png'),
    minHeight: 560,
    minWidth: 360,
    show: false,
    title: 'Beacon',
    webPreferences: {
      // Camera Mode keeps broadcasting from the tray (ADR 0082).
      backgroundThrottling: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      safeDialogs: true,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
    width: 1280,
  });
  const contents = window.webContents;

  contents.setWindowOpenHandler(({ url }) => {
    const decision = classifyNavigation(url, appOrigin);
    if (decision.kind === 'app') void window.loadURL(url);
    else act(decision);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event) => {
    const decision = classifyNavigation(event.url, appOrigin);
    if (decision.kind === 'app') return;
    event.preventDefault();
    act(decision);
  });
  contents.on('will-redirect', (event) => {
    const decision = classifyNavigation(event.url, appOrigin);
    if (decision.kind === 'app') return;
    event.preventDefault();
    if (event.isMainFrame) act(decision);
  });
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !isAppUrl(event.url, appOrigin))
      event.preventDefault();
  });
  contents.on('did-start-navigation', (event) => {
    // A reload or full navigation tears down Camera Mode without running
    // its cleanup, so the indicator resets with the document.
    if (event.isMainFrame && !event.isSameDocument) setCaptureActive(false);
  });
  contents.on(
    'did-fail-load',
    (_event, errorCode, _description, validatedUrl, isMainFrame) => {
      if (
        isMainFrame &&
        errorCode !== ERR_ABORTED &&
        isAppUrl(validatedUrl, appOrigin)
      )
        showOfflinePage(window);
    },
  );
  contents.on('render-process-gone', () => {
    setCaptureActive(false);
    void window.loadURL(appUrl('/')).catch(() => undefined);
  });
  contents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = params.isEditable
      ? [
          { enabled: params.editFlags.canCut, role: 'cut' },
          { enabled: params.editFlags.canCopy, role: 'copy' },
          { enabled: params.editFlags.canPaste, role: 'paste' },
          { type: 'separator' },
          { role: 'selectAll' },
        ]
      : params.selectionText.trim()
        ? [{ role: 'copy' }]
        : [];
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window });
  });

  window.on('close', (event) => {
    if (quitting) return;
    // Closing hides to the tray; Quit Beacon (tray) really exits.
    event.preventDefault();
    window.hide();
    if (captureActive) {
      notifyStillLive();
    } else if (!preferences.trayHintShown) {
      notify(
        'Beacon is still running',
        'Open it again from the tray or by launching Beacon. Choose Quit Beacon in the tray to close it completely.',
      );
      preferences.trayHintShown = true;
      try {
        writePreferences(preferencesFile, preferences);
      } catch {
        // Showing the hint again next time is harmless.
      }
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  mainWindow = window;
  void window.loadURL(appUrl('/')).catch(() => undefined);
  return window;
}

// --- Session hardening ------------------------------------------------------

async function grantMacMediaAccess(
  mediaTypes: readonly string[],
): Promise<boolean> {
  for (const type of mediaTypes) {
    const device = type === 'video' ? 'camera' : 'microphone';
    if (
      systemPreferences.getMediaAccessStatus(device) !== 'granted' &&
      !(await systemPreferences.askForMediaAccess(device))
    )
      return false;
  }
  return true;
}

function configureSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler(
    (_contents, permission, callback, details) => {
      const mediaTypes =
        'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      if (
        !details.isMainFrame ||
        !isPermissionGranted(
          permission,
          details.requestingUrl,
          appOrigin,
          mediaTypes,
        )
      ) {
        callback(false);
        return;
      }
      if (permission === 'media' && process.platform === 'darwin') {
        void grantMacMediaAccess(mediaTypes).then(callback, () =>
          callback(false),
        );
        return;
      }
      callback(true);
    },
  );
  ses.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin, details) =>
      isPermissionGranted(
        permission,
        requestingOrigin,
        appOrigin,
        details.mediaType === 'audio' || details.mediaType === 'video'
          ? [details.mediaType]
          : [],
      ),
  );
  ses.setDevicePermissionHandler(() => false);
}

function configureApplicationMenu(): void {
  // Windows and Linux match the installed PWA: no menu bar at all. macOS
  // needs its standard menus for Quit, Edit shortcuts, and window controls.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          { role: 'windowMenu' },
        ])
      : null,
  );
}

async function quitFromTray(): Promise<void> {
  if (captureActive) {
    const options = {
      buttons: ['Stop Camera Mode and quit', 'Cancel'],
      cancelId: 1,
      defaultId: 1,
      detail: 'Quitting Beacon stops broadcasting from this computer.',
      message: 'Camera Mode is live',
      type: 'warning' as const,
    };
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (response !== 0) return;
  }
  app.quit();
}

// --- Lifecycle --------------------------------------------------------------

function registerDeepLinkScheme(): void {
  // Packaged installers also register the scheme (electron-builder
  // `protocols`). Development builds register only on request, so running
  // from source never repoints the machine's handler at a dev checkout.
  if (app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  else if (process.env.BEACON_DESKTOP_REGISTER_PROTOCOL === '1')
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1] ?? '.'),
    ]);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  app.enableSandbox();
  registerDeepLinkScheme();

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  app.on('second-instance', (_event, argv) => {
    const link = findDesktopAuthLink(argv);
    if (link) handleDeepLink(link);
    else showWindow();
  });
  // macOS delivers deep links as open-url, possibly before `ready`.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(parseDesktopAuthLink(url));
  });
  app.on('activate', () => showWindow());
  app.on('before-quit', () => {
    quitting = true;
  });
  // Hidden windows keep Beacon alive; only Quit Beacon ends the process.
  app.on('window-all-closed', () => undefined);

  void app.whenReady().then(() => {
    configureSession();
    configureApplicationMenu();
    tray = new BeaconTray(assetsDirectory, {
      autostart: {
        enabled: autostartSupported(),
        get: getOpenAtLogin,
        set: setOpenAtLogin,
      },
      open: () => showWindow(),
      quit: () => void quitFromTray(),
      reload: () => {
        const window = showWindow();
        void window.loadURL(appUrl('/')).catch(() => undefined);
      },
    });
    const window = createWindow();
    if (!launchedInBackground(process.argv))
      window.once('ready-to-show', () => window.show());
  });
}
