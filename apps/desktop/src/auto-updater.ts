import electronUpdater from 'electron-updater';

import {
  canInstallQuietly,
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  type InstallMoment,
  INSTALL_RETRY_MS,
  selfUpdating,
} from './updates.js';

const { autoUpdater } = electronUpdater;

export interface UpdateOffer {
  label: string;
  run(): void;
}

export interface AutoUpdaterHooks {
  /** What is happening right now, to pick a quiet moment to restart. */
  moment(): InstallMoment;
  /** Called just before a quiet restart, so the app comes back the way it
   * was (hidden, camera resumed) instead of opening its window. */
  beforeQuietRestart(): void;
  /** A tray entry for the update, or null to remove it. */
  offer(offer: UpdateOffer | null): void;
  /** Opens the download page (platforms that cannot update themselves). */
  openDownloadPage(): void;
}

/**
 * Keeps the desktop shell up to date from the Beacon server's /downloads
 * feed (ADR 0085). The feed's latest*.yml carries a SHA-512 for each
 * installer, which electron-updater checks before running anything.
 */
export class BeaconAutoUpdater {
  #ready: string | null = null;
  #retry: NodeJS.Timeout | null = null;
  readonly #self = selfUpdating(process.platform, process.env);

  constructor(private readonly hooks: AutoUpdaterHooks) {}

  start(): void {
    autoUpdater.autoDownload = this.#self;
    // Quitting Beacon also finishes a downloaded update, silently.
    autoUpdater.autoInstallOnAppQuit = this.#self;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;

    autoUpdater.on('error', () => {
      // Offline or a feed problem: the next scheduled check tries again.
    });
    autoUpdater.on('update-available', (info) => {
      if (this.#self) return;
      this.hooks.offer({
        label: `Download Beacon ${info.version}…`,
        run: () => this.hooks.openDownloadPage(),
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.#ready = info.version;
      this.hooks.offer({
        label: `Restart to update to Beacon ${info.version}`,
        run: () => this.#install(false),
      });
      this.consider();
    });

    const check = () => void autoUpdater.checkForUpdates().catch(() => null);
    setTimeout(check, FIRST_CHECK_DELAY_MS).unref();
    setInterval(check, CHECK_INTERVAL_MS).unref();
  }

  /** Installs a downloaded update now if this is a quiet moment; otherwise
   * looks again later. Call it whenever the window hides or the camera
   * state changes. */
  consider(): void {
    if (!this.#ready) return;
    if (canInstallQuietly(this.hooks.moment())) {
      this.#install(true);
      return;
    }
    if (this.#retry === null) {
      this.#retry = setTimeout(() => {
        this.#retry = null;
        this.consider();
      }, INSTALL_RETRY_MS);
      this.#retry.unref();
    }
  }

  #install(quiet: boolean): void {
    if (quiet) this.hooks.beforeQuietRestart();
    // Silent installer, then relaunch Beacon.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }
}
