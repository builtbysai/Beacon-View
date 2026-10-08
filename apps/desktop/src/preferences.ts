import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { validResumePath } from './camera-setup.js';

/** Small, non-sensitive shell preferences. Sessions live in the webview's
 * own (encrypted, see the cookie-encryption fuse) cookie store, never here. */
export interface DesktopPreferences {
  /** Camera Mode path to reopen at startup (ADR 0083), or null. */
  cameraResumePath: string | null;
  /** Set just before an automatic update restarts Beacon, so the next launch
   * stays in the tray like the one it replaces (ADR 0085). Used once. */
  relaunchHidden: boolean;
  trayHintShown: boolean;
}

export function readPreferences(file: string): DesktopPreferences {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object') {
      const { cameraResumePath, relaunchHidden, trayHintShown } =
        parsed as Record<string, unknown>;
      return {
        cameraResumePath: validResumePath(cameraResumePath),
        relaunchHidden: relaunchHidden === true,
        trayHintShown: trayHintShown === true,
      };
    }
  } catch {
    // Missing or unreadable preferences fall back to defaults.
  }
  return {
    cameraResumePath: null,
    relaunchHidden: false,
    trayHintShown: false,
  };
}

export function writePreferences(
  file: string,
  preferences: DesktopPreferences,
): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(preferences, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, file);
}
