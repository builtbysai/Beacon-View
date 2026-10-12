/**
 * The Beacon Android app (apps/android-camera, ADR 0121) hosts this web app in a WebView and injects one object,
 * `BeaconAndroid`, only into pages of this origin. In an ordinary browser it is absent and every helper here is a no-op,
 * like the desktop shell's (desktop-shell.ts).
 *
 * Messages go to the app as JSON with an opaque id and a `type`; the app answers with the same id, or sends an event.
 * The app validates every message and ignores anything it does not know, so this list is the whole surface.
 */
export interface AndroidCameraState {
  deviceName: string;
  online: boolean;
  paired: boolean;
  privacy: boolean;
  running: boolean;
  viewers: number;
}

export interface AndroidHello {
  app: 'android';
  camera: AndroidCameraState;
  version: string;
}

interface BeaconAndroidBridge {
  addEventListener?(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
  postMessage(message: string): void;
}

declare global {
  interface Window {
    BeaconAndroid?: BeaconAndroidBridge;
  }
}

const REPLY_TIMEOUT_MS = 8_000;

export function androidBridge(): BeaconAndroidBridge | null {
  const bridge = window.BeaconAndroid;
  return bridge && typeof bridge.postMessage === 'function' ? bridge : null;
}

/** Running inside the Beacon Android app. */
export function isAndroidApp(): boolean {
  return androidBridge() !== null;
}

/** The app's version from its user agent (`BeaconApp/<version>`), available before the first message. */
export function androidAppVersion(
  userAgent: string = navigator.userAgent,
): string | null {
  return /\bBeaconApp\/([\w.+-]+)/.exec(userAgent)?.[1] ?? null;
}

type Pending = {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();
const cameraListeners = new Set<(state: AndroidCameraState) => void>();
let attachedTo: BeaconAndroidBridge | null = null;
let counter = 0;

function handleMessage(event: { data: unknown }): void {
  let message: unknown;
  try {
    message =
      typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (!message || typeof message !== 'object') return;
  const value = message as {
    data?: unknown;
    error?: unknown;
    event?: unknown;
    id?: unknown;
    ok?: unknown;
  };
  if (
    value.event === 'camera' &&
    value.data &&
    typeof value.data === 'object'
  ) {
    for (const listener of cameraListeners)
      listener(value.data as AndroidCameraState);
    return;
  }
  if (typeof value.id !== 'string') return;
  const waiting = pending.get(value.id);
  if (!waiting) return;
  pending.delete(value.id);
  clearTimeout(waiting.timer);
  if (value.ok === true) waiting.resolve(value.data);
  else
    waiting.reject(
      new Error(
        typeof value.error === 'string' ? value.error : 'The app said no.',
      ),
    );
}

function attach(bridge: BeaconAndroidBridge): void {
  if (attachedTo === bridge) return;
  attachedTo = bridge;
  if (bridge.addEventListener)
    bridge.addEventListener('message', handleMessage);
  else bridge.onmessage = handleMessage;
}

/** Sends one message and resolves with the app's answer. Rejects outside the app, on a refusal, or after 8 seconds. */
export function sendToAndroid<T = unknown>(
  type: string,
  fields: Record<string, unknown> = {},
): Promise<T> {
  const bridge = androidBridge();
  if (!bridge) return Promise.reject(new Error('Not in the Beacon app.'));
  attach(bridge);
  const id = `m${++counter}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The app did not answer.'));
    }, REPLY_TIMEOUT_MS);
    pending.set(id, {
      reject,
      resolve: resolve as (v: unknown) => void,
      timer,
    });
    bridge.postMessage(JSON.stringify({ id, type, ...fields }));
  });
}

export const androidApp = {
  disconnectCamera: () => sendToAndroid('disconnectCamera'),
  hello: () => sendToAndroid<AndroidHello>('hello'),
  openCameraScreen: () => sendToAndroid('openCameraScreen'),
  openUpdate: () => sendToAndroid('openUpdate'),
  setPrivacy: (enabled: boolean) => sendToAndroid('setPrivacy', { enabled }),
  /** Pairs this phone as a camera with a code the signed-in person just created, then shows the camera screen. */
  startCamera: (code: string) => sendToAndroid('startCamera', { code }),
};

/** Hears about the phone's own camera (running, private, online) changing. Returns the way to stop listening. */
export function onAndroidCameraState(
  listener: (state: AndroidCameraState) => void,
): () => void {
  const bridge = androidBridge();
  if (bridge) attach(bridge);
  cameraListeners.add(listener);
  return () => {
    cameraListeners.delete(listener);
  };
}

/**
 * Is [latest] newer than [installed]? Versions look like "0.1.0-alpha13": numbers compare as numbers (alpha13 is after
 * alpha9), text compares as text, and a release with no suffix beats its own alphas. Mirrors the app's own check.
 */
export function isNewerAndroidVersion(
  latest: string,
  installed: string,
): boolean {
  const tokens = (version: string) => version.match(/\d+|[A-Za-z]+/g) ?? [];
  const a = tokens(latest);
  const b = tokens(installed);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return true;
    if (y === undefined) return false;
    const xn = /^\d+$/.test(x) ? Number(x) : null;
    const yn = /^\d+$/.test(y) ? Number(y) : null;
    return xn !== null && yn !== null ? xn > yn : x > y;
  }
  return false;
}
