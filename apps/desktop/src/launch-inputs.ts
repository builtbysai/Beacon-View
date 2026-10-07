import { readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  type CameraSetupRequest,
  parseCameraSetupFile,
  parseCameraSetupLink,
  parseInstallerFileName,
  PENDING_SETUP_MAX_AGE_MS,
  SETUP_FILE_EXTENSION,
  SETUP_FILE_MAX_BYTES,
} from './camera-setup.js';
import {
  DEEP_LINK_SCHEME,
  type DesktopAuthLink,
  parseDesktopAuthLink,
} from './deep-link.js';

export type LaunchInput =
  | { kind: 'auth'; link: DesktopAuthLink }
  | { kind: 'camera-setup'; request: CameraSetupRequest };

/** Interprets one deep link (any platform) as sign-in or camera setup. */
export function parseLaunchUrl(value: string): LaunchInput | null {
  const auth = parseDesktopAuthLink(value);
  if (auth) return { kind: 'auth', link: auth };
  const request = parseCameraSetupLink(value);
  return request ? { kind: 'camera-setup', request } : null;
}

/** Reads a double-clicked `.beaconcamera` file (path from argv on Windows
 * and Linux, or macOS `open-file`). */
export function readSetupFile(
  filePath: string,
  appOrigin: string,
): LaunchInput | null {
  if (path.extname(filePath).toLowerCase() !== SETUP_FILE_EXTENSION)
    return null;
  try {
    if (statSync(filePath).size > SETUP_FILE_MAX_BYTES) return null;
    const request = parseCameraSetupFile(
      readFileSync(filePath, 'utf8'),
      appOrigin,
    );
    return request ? { kind: 'camera-setup', request } : null;
  } catch {
    return null;
  }
}

/** Windows and Linux pass deep links and opened files as arguments of the
 * launch (forwarded to the running app by the single-instance lock). */
export function findLaunchInput(
  argv: readonly string[],
  appOrigin: string,
): LaunchInput | null {
  for (const argument of argv.slice(1)) {
    if (argument.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`))
      return parseLaunchUrl(argument);
    if (argument.toLowerCase().endsWith(SETUP_FILE_EXTENSION))
      return readSetupFile(argument, appOrigin);
  }
  return null;
}

export const PENDING_INSTALLER_SETUP = 'pending-camera-setup.txt';

/**
 * The Windows installer records its own file name here (see
 * resources/installer.nsh). A pre-configured download's name carries a
 * setup token; any other installer leaves nothing usable. The record is
 * consumed on first read whatever it contains.
 */
export function takePendingInstallerSetup(
  userDataDirectory: string,
  now = Date.now(),
): CameraSetupRequest | null {
  const file = path.join(userDataDirectory, PENDING_INSTALLER_SETUP);
  try {
    const { mtimeMs, size } = statSync(file);
    const text = size <= 1_024 ? readFileSync(file, 'utf8') : '';
    rmSync(file, { force: true });
    if (now - mtimeMs > PENDING_SETUP_MAX_AGE_MS) return null;
    return parseInstallerFileName(text.trim());
  } catch {
    return null;
  }
}
