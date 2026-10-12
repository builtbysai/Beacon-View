import type { CameraActivity } from './camera-power';

export interface DesktopAlert {
  category: 'motion' | 'offline' | 'recovered' | 'security' | 'health';
  eventId: string;
  route: '/activity' | '/settings';
}

/**
 * The Beacon desktop app (apps/desktop, ADRs 0082 and 0083) loads this same
 * web viewer and exposes exactly this object from its preload script. In an
 * ordinary browser it is absent and every helper here is a no-op.
 *
 * Everything after `setCaptureActive` was added later and is optional, so a
 * newer web viewer keeps working inside an older installed app.
 */
/** The desktop app's own update state (ADR 0118). */
export interface DesktopUpdateStatus {
  checkedAt?: number;
  currentVersion: string;
  percent?: number;
  selfUpdating: boolean;
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'manual' | 'error';
  version?: string;
}

export interface BeaconDesktopBridge {
  readonly version: 1;
  /** Drives the tray's visible "camera is live" indicator while the window
   * is hidden -- capture must stay visible to the person at the device. */
  setCaptureActive(active: boolean): void;
  /** Like setCaptureActive, but also distinguishes standby (camera off,
   * waiting for a viewer) from live. */
  setCameraActivity?(activity: CameraActivity): void;
  getAutostart?(): Promise<boolean>;
  setAutostart?(enabled: boolean): Promise<boolean>;
  /** A same-origin Camera Mode path to reopen when the app starts, or null
   * to stop resuming. */
  setCameraResume?(path: string | null): void;
  showAlert?(alert: DesktopAlert): void;
  getUpdateStatus?(): Promise<DesktopUpdateStatus | null>;
  checkForUpdates?(): Promise<DesktopUpdateStatus | null>;
  installUpdate?(): Promise<void>;
  /** The favorite cameras to offer as tray shortcuts (ADR 0095). */
  setTrayCameras?(cameras: { id: string; name: string }[]): void;
}

declare global {
  interface Window {
    beaconDesktop?: BeaconDesktopBridge;
  }
}

export function desktopBridge(): BeaconDesktopBridge | null {
  const bridge = window.beaconDesktop;
  return bridge?.version === 1 && typeof bridge.setCaptureActive === 'function'
    ? bridge
    : null;
}

export function isDesktopShell(): boolean {
  return desktopBridge() !== null;
}

export function reportDesktopCapture(active: boolean): void {
  desktopBridge()?.setCaptureActive(active);
}

export function reportDesktopCameraActivity(activity: CameraActivity): void {
  const bridge = desktopBridge();
  if (!bridge) return;
  if (bridge.setCameraActivity) bridge.setCameraActivity(activity);
  else bridge.setCaptureActive(activity === 'live');
}

export function desktopSupportsAlerts(): boolean {
  return typeof desktopBridge()?.showAlert === 'function';
}

export function desktopSupportsAutostart(): boolean {
  const bridge = desktopBridge();
  return (
    typeof bridge?.getAutostart === 'function' &&
    typeof bridge.setAutostart === 'function'
  );
}
