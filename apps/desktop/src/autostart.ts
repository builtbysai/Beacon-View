import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { app } from 'electron';

import { BACKGROUND_ARG } from './config.js';
import {
  LINUX_AUTOSTART_FILE,
  linuxAutostartEntry,
} from './linux-autostart.js';

/** Off by default; the person opts in from the tray menu. Only packaged
 * builds can register, since a development build has no stable launcher. */
export function autostartSupported(): boolean {
  return app.isPackaged;
}

function linuxAutostartPath(): string {
  const configHome =
    process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(configHome, 'autostart', LINUX_AUTOSTART_FILE);
}

function windowsLoginItem() {
  return { args: [BACKGROUND_ARG], path: process.execPath };
}

export function getOpenAtLogin(): boolean {
  if (!autostartSupported()) return false;
  switch (process.platform) {
    case 'linux':
      return existsSync(linuxAutostartPath());
    case 'win32':
      return app.getLoginItemSettings(windowsLoginItem()).openAtLogin;
    default:
      return app.getLoginItemSettings().openAtLogin;
  }
}

export function setOpenAtLogin(enabled: boolean): void {
  if (!autostartSupported()) return;
  switch (process.platform) {
    case 'linux': {
      const file = linuxAutostartPath();
      if (!enabled) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(path.dirname(file), { recursive: true });
      // An AppImage runs from a temporary mount; APPIMAGE is its real path.
      const executable = process.env.APPIMAGE || process.execPath;
      writeFileSync(file, linuxAutostartEntry(executable, [BACKGROUND_ARG]));
      return;
    }
    case 'win32':
      app.setLoginItemSettings({ ...windowsLoginItem(), openAtLogin: enabled });
      return;
    default:
      app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

/** True when this launch came from the login item rather than the person. */
export function launchedInBackground(argv: readonly string[]): boolean {
  if (argv.includes(BACKGROUND_ARG)) return true;
  return (
    process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
  );
}
