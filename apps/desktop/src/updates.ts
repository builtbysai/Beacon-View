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
