import type { CameraActivity } from './tray.js';

/**
 * Automatic updates (ADR 0085). Only the desktop shell is updated this way:
 * the app UI is the live web app, so most changes reach desktop users with no
 * update at all.
 *
 * An update never signs anyone out or unpairs a camera: sessions, the camera
 * credential, and preferences live in the user-data folder, which installers
 * never touch, and the app ID that names that folder never changes.
 */

/** Platforms whose installs can replace themselves without admin rights. An
 * unsigned macOS app cannot (Squirrel.Mac requires a signature), and a .deb
 * needs root; those are told a new version exists instead. */
export function selfUpdating(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): boolean {
  if (platform === 'win32') return true;
  if (platform === 'linux') return Boolean(environment.APPIMAGE);
  return false;
}

export interface InstallMoment {
  cameraActivity: CameraActivity;
  windowVisible: boolean;
}

/**
 * A downloaded update installs on its own only when nobody would notice the
 * restart: the window is hidden and the camera is not streaming to a viewer.
 * A camera on standby restarts (offline for a few seconds) and resumes; a
 * live camera is never cut off. Otherwise it waits for one of those moments,
 * for Quit, or for "Restart to update" in the tray.
 */
export function canInstallQuietly(moment: InstallMoment): boolean {
  return !moment.windowVisible && moment.cameraActivity !== 'live';
}

/** First check shortly after start (not during it), then a few times a day. */
export const FIRST_CHECK_DELAY_MS = 60_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
/** How often a waiting update re-checks whether now is a quiet moment. */
export const INSTALL_RETRY_MS = 10 * 60_000;

/** What the app can tell the Settings page about updates (ADR 0118). */
export interface UpdateStatus {
  currentVersion: string;
  /** Last time a check finished, as epoch milliseconds. */
  checkedAt?: number;
  /** Download progress, 0 to 100, while downloading. */
  percent?: number;
  /** Can this install replace itself? When not, a new version is "manual": a download to run. */
  selfUpdating: boolean;
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'manual' | 'error';
  /** The version being downloaded, ready, or offered. */
  version?: string;
}

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'none'; at: number }
  | { type: 'error' }
  | { type: 'found'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string };

export function initialUpdateStatus(
  currentVersion: string,
  selfUpdates: boolean,
): UpdateStatus {
  return { currentVersion, selfUpdating: selfUpdates, state: 'idle' };
}

export function nextUpdateStatus(
  status: UpdateStatus,
  event: UpdateEvent,
): UpdateStatus {
  // A downloaded update stays "ready" until the app restarts; a later check does not take that back.
  if (status.state === 'ready' && event.type !== 'downloaded') return status;
  const base: UpdateStatus = { ...status };
  delete base.percent;
  switch (event.type) {
    case 'checking':
      return { ...base, state: 'checking' };
    case 'none':
      return { ...base, checkedAt: event.at, state: 'idle' };
    case 'error':
      return { ...base, state: 'error' };
    case 'found':
      return {
        ...base,
        state: status.selfUpdating ? 'downloading' : 'manual',
        version: event.version,
      };
    case 'progress':
      return {
        ...status,
        percent: Math.round(event.percent),
        state: 'downloading',
      };
    case 'downloaded':
      return { ...base, state: 'ready', version: event.version };
  }
}
