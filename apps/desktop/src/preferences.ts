import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { validResumePath } from './camera-setup.js';

/** Small, non-sensitive shell preferences. Sessions live in the webview's
 * own (encrypted, see the cookie-encryption fuse) cookie store, never here. */
export interface DesktopPreferences {
  /** Camera Mode path to reopen at startup (ADR 0083), or null. */
  cameraResumePath: string | null;
  trayHintShown: boolean;
}

export function readPreferences(file: string): DesktopPreferences {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object') {
      const { cameraResumePath, trayHintShown } = parsed as Record<
        string,
        unknown
      >;
      return {
        cameraResumePath: validResumePath(cameraResumePath),
        trayHintShown: trayHintShown === true,
      };
    }
  } catch {
    // Missing or unreadable preferences fall back to defaults.
  }
  return { cameraResumePath: null, trayHintShown: false };
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
