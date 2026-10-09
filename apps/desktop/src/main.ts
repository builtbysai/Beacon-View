import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
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
  ALERT_BODY,
  alertPath,
  parseDesktopAlert,
  RecentAlerts,
} from './alerts.js';
import {
  autostartSupported,
  getOpenAtLogin,
  launchedInBackground,
  setOpenAtLogin,
} from './autostart.js';
import {
  type CameraSetupRequest,
  cameraSetupPath,
  validResumePath,
} from './camera-setup.js';
import { BeaconAutoUpdater } from './auto-updater.js';
import { FloatingVideo } from './floating-video.js';
import { APP_ID, resolveAppOrigin } from './config.js';
import { DEEP_LINK_SCHEME, type DesktopAuthLink } from './deep-link.js';
import {
  exchangeScript,
  googleStartUrl,
  parseExchangeResult,
  PendingGoogleSignIn,
} from './google-sign-in.js';
import {
  findLaunchInput,
  type LaunchInput,
  parseLaunchUrl,
  readSetupFile,
  takePendingInstallerSetup,
} from './launch-inputs.js';
import {
  classifyNavigation,
  isAppUrl,
  type NavigationDecision,
} from './navigation-policy.js';
import { isPermissionGranted } from './permissions.js';
import { readPreferences, writePreferences } from './preferences.js';
import { BeaconTray, type CameraActivity } from './tray.js';
import { parseTrayCameras } from './tray-cameras.js';

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
const recentAlerts = new RecentAlerts();

let mainWindow: BrowserWindow | null = null;
let tray: BeaconTray | null = null;
let updater: BeaconAutoUpdater | null = null;
const floatingVideo = new FloatingVideo();
let quitting = false;
let cameraActivity: CameraActivity = 'off';
let cameraBlocker: number | null = null;

function appUrl(pathname: string): string {
  return new URL(pathname, appOrigin).href;
}

/** A computer set up as a camera reopens Camera Mode; otherwise Home. */
function startPath(): string {
  return preferences.cameraResumePath ?? '/';
}

function savePreferences(): void {
  try {
    writePreferences(preferencesFile, preferences);
  } catch {
    // Preferences are conveniences; failing to save one is not fatal.
  }
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

/** After a deep link from the browser, the app should come to the front.
 * Windows refuses focus to background processes, so float the window above
 * others for a moment instead. */
function bringToFront(): BrowserWindow {
  const window = showWindow();
  if (process.platform === 'win32') {
    window.setAlwaysOnTop(true);
    window.focus();
    window.setAlwaysOnTop(false);
  } else if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
  return window;
}

/** IPC is honored only from Beacon's own page in this window's main frame. */
function trustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return Boolean(
    mainWindow &&
    event.sender === mainWindow.webContents &&
    frame &&
    frame === event.sender.mainFrame &&
    isAppUrl(frame.url, appOrigin),
  );
}

// --- Camera visibility (ADRs 0082 and 0083) ---------------------------------

function notifyCameraInBackground(): void {
  if (cameraActivity === 'live')
    notify(
      'Beacon camera is on',
      'This computer keeps broadcasting while the window is closed. Choose Quit Beacon in the tray to stop.',
    );
  else if (cameraActivity === 'standby')
    notify(
      'Beacon camera is on standby',
      'The camera stays off and turns on only while someone views it. Choose Quit Beacon in the tray to stop.',
    );
}

function setCameraActivity(next: CameraActivity): void {
  const previous = cameraActivity;
  if (next === previous) return;
  cameraActivity = next;
  tray?.setActivity(next);
  // A camera on standby must stay reachable, so the computer stays awake
  // (the display may still sleep) whenever Camera Mode runs.
  if (next === 'off') {
    if (cameraBlocker !== null) powerSaveBlocker.stop(cameraBlocker);
    cameraBlocker = null;
  } else if (cameraBlocker === null) {
    cameraBlocker = powerSaveBlocker.start('prevent-app-suspension');
  }
  updater?.consider();
  // Capture that starts while the window is hidden is announced, so the
  // person at this computer always knows when the camera turns on.
  if (next === 'live' && mainWindow && !mainWindow.isVisible())
    notify(
      'Beacon camera turned on',
      previous === 'standby'
        ? 'Someone is viewing this camera. It turns off again after they leave.'
        : 'This computer is broadcasting. Choose Quit Beacon in the tray to stop.',
    );
}

ipcMain.on('beacon:camera-activity', (event, activity: unknown) => {
  if (
    trustedSender(event) &&
    (activity === 'off' || activity === 'standby' || activity === 'live')
  )
    setCameraActivity(activity);
});

ipcMain.on('beacon:camera-resume', (event, value: unknown) => {
  if (!trustedSender(event)) return;
  const resume = value === null ? null : validResumePath(value);
  if (value !== null && !resume) return;
  if (preferences.cameraResumePath === resume) return;
  preferences.cameraResumePath = resume;
  savePreferences();
});

ipcMain.on('beacon:tray-cameras', (event, value: unknown) => {
  if (!trustedSender(event)) return;
  const cameras = parseTrayCameras(value);
  if (cameras) tray?.setCameras(cameras);
});

ipcMain.handle('beacon:get-autostart', (event) =>
  trustedSender(event) ? getOpenAtLogin() : false,
);

ipcMain.handle('beacon:set-autostart', (event, enabled: unknown) => {
  if (!trustedSender(event) || typeof enabled !== 'boolean')
    return getOpenAtLogin();
  setOpenAtLogin(enabled);
  tray?.refresh();
  return getOpenAtLogin();
});

// --- Desktop alerts (ADR 0083) ----------------------------------------------

ipcMain.on('beacon:show-alert', (event, value: unknown) => {
  if (!trustedSender(event) || !Notification.isSupported()) return;
  const alert = parseDesktopAlert(value);
  if (!alert || !recentAlerts.firstSighting(alert.eventId)) return;
  const notification = new Notification({
    body: ALERT_BODY[alert.category],
    // Security alerts stay until dismissed, like the PWA's requireInteraction.
    timeoutType: alert.category === 'security' ? 'never' : 'default',
    title: 'Beacon',
  });
  notification.on('click', () => {
    const window = bringToFront();
    void window.loadURL(appUrl(alertPath(alert))).catch(() => undefined);
  });
  notification.show();
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
  const window = bringToFront();
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

// --- One-click camera setup (ADR 0083) --------------------------------------

function startCameraSetup(request: CameraSetupRequest): void {
  // A camera should come back after the computer restarts. The setup page
  // says so; the tray menu and Settings can turn it off again.
  if (autostartSupported() && !getOpenAtLogin()) {
    setOpenAtLogin(true);
    tray?.refresh();
    notify(
      'Beacon will start with this computer',
      'So this camera stays available after a restart. Change this from the Beacon tray menu.',
    );
  }
  const window = bringToFront();
  void window.loadURL(appUrl(cameraSetupPath(request))).catch(() => undefined);
}

function handleLaunchInput(input: LaunchInput | null): boolean {
  if (!input) return false;
  if (input.kind === 'auth') void completeGoogleSignIn(input.link);
  else startCameraSetup(input.request);
  return true;
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

/** Shows the offline page, which reconnects to `returnUrl` (the page that
 * failed), so a computer camera comes back in Camera Mode, not on Home. */
function showOfflinePage(window: BrowserWindow, returnUrl: string): void {
  void window
    .loadFile(path.join(appRoot, 'static', 'offline.html'), {
      query: {
        origin: appOrigin,
        return: isAppUrl(returnUrl, appOrigin)
          ? returnUrl
          : appUrl(startPath()),
      },
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
    if (event.isMainFrame && !event.isSameDocument) setCameraActivity('off');
  });
  contents.on(
    'did-fail-load',
    (_event, errorCode, _description, validatedUrl, isMainFrame) => {
      if (
        isMainFrame &&
        errorCode !== ERR_ABORTED &&
        isAppUrl(validatedUrl, appOrigin)
      )
        showOfflinePage(window, validatedUrl);
    },
  );
  contents.on('render-process-gone', () => {
    setCameraActivity('off');
    void window.loadURL(appUrl(startPath())).catch(() => undefined);
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
    // A camera being watched keeps playing in a floating window (ADR 0088);
    // an update waits until that's settled.
    void floatingVideo
      .float(window.webContents)
      .then(() => updater?.consider());
    if (cameraActivity !== 'off') {
      notifyCameraInBackground();
    } else if (!preferences.trayHintShown) {
      notify(
        'Beacon is still running',
        'Open it again from the tray or by launching Beacon. Choose Quit Beacon in the tray to close it completely.',
      );
      preferences.trayHintShown = true;
      savePreferences();
    }
  });
  window.on('minimize', () => void floatingVideo.float(window.webContents));
  // Back in the window: return a video the shell floated to the page.
  window.on('show', () => void floatingVideo.dock(window.webContents));
  window.on('restore', () => void floatingVideo.dock(window.webContents));
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  mainWindow = window;
  void window.loadURL(appUrl(startPath())).catch(() => undefined);
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
  if (cameraActivity !== 'off') {
    const options = {
      buttons: ['Stop camera and quit', 'Cancel'],
      cancelId: 1,
      defaultId: 1,
      detail:
        cameraActivity === 'live'
          ? 'Quitting Beacon stops broadcasting from this computer.'
          : 'Quitting Beacon takes this camera offline until Beacon starts again.',
      message:
        cameraActivity === 'live'
          ? 'This camera is on'
          : 'This camera is on standby',
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
  // Packaged installers also register the scheme (resources/installer.nsh
  // on Windows, electron-builder `protocols` elsewhere). Development builds
  // register only on request, so running from source never repoints the
  // machine's handler at a dev checkout.
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

  // macOS delivers deep links and opened files as events, possibly before
  // `ready`; those are held until the window exists.
  const early: LaunchInput[] = [];
  const deliver = (input: LaunchInput | null): void => {
    if (!input) return;
    if (app.isReady() && mainWindow) handleLaunchInput(input);
    else early.push(input);
  };

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  app.on('second-instance', (_event, argv) => {
    if (!handleLaunchInput(findLaunchInput(argv, appOrigin))) showWindow();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliver(parseLaunchUrl(url));
  });
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    deliver(readSetupFile(filePath, appOrigin));
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
      openPath: (path) => {
        void bringToFront()
          .loadURL(appUrl(path))
          .catch(() => undefined);
      },
      quit: () => void quitFromTray(),
      reload: () => showWindow().webContents.reload(),
      version: app.getVersion(),
    });
    const window = createWindow();
    const afterUpdate = preferences.relaunchHidden;
    if (afterUpdate) {
      preferences.relaunchHidden = false;
      savePreferences();
    }
    updater = new BeaconAutoUpdater({
      beforeQuietRestart: () => {
        preferences.relaunchHidden = true;
        savePreferences();
      },
      moment: () => ({
        cameraActivity,
        windowVisible:
          Boolean(mainWindow?.isVisible()) || floatingVideo.watching,
      }),
      offer: (offer) => tray?.setUpdate(offer),
      openDownloadPage: () => openExternal(appUrl('/#download')),
    });
    updater.start();
    const installerSetup = takePendingInstallerSetup(app.getPath('userData'));
    const inputs = [
      findLaunchInput(process.argv, appOrigin),
      ...early.splice(0),
      installerSetup
        ? { kind: 'camera-setup' as const, request: installerSetup }
        : null,
    ];
    let handled = false;
    for (const input of inputs) handled = handleLaunchInput(input) || handled;
    // A login-item launch stays in the tray (a camera resumes there).
    if (!handled && !afterUpdate && !launchedInBackground(process.argv))
      window.once('ready-to-show', () => window.show());
  });
}
