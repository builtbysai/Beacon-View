import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Small, non-sensitive shell preferences. Sessions live in the webview's
 * own (encrypted, see the cookie-encryption fuse) cookie store, never here. */
export interface DesktopPreferences {
  trayHintShown: boolean;
}

const DEFAULTS: DesktopPreferences = { trayHintShown: false };

export function readPreferences(file: string): DesktopPreferences {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object') {
      const { trayHintShown } = parsed as Record<string, unknown>;
      return { trayHintShown: trayHintShown === true };
    }
  } catch {
    // Missing or unreadable preferences fall back to defaults.
  }
  return { ...DEFAULTS };
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
