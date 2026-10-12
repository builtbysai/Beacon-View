import electronUpdater from 'electron-updater';

import { PRODUCTION_ORIGIN } from './config.js';
import {
  feedFileName,
  updateMatchesSignedFeed,
  verifyFeedSignature,
} from './update-signature.js';

import {
  canInstallQuietly,
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  initialUpdateStatus,
  type InstallMoment,
  INSTALL_RETRY_MS,
  nextUpdateStatus,
  selfUpdating,
  type UpdateEvent,
  type UpdateStatus,
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
  /** The installed version of the app. */
  version(): string;
}

/**
 * Keeps the desktop shell up to date from the Beacon server's /downloads
 * feed (ADR 0085). The feed's latest*.yml carries a SHA-512 for each
 * installer, which electron-updater checks before running anything. The feed
 * itself must carry the owner's Ed25519 signature (ADR 0110): nothing is
 * downloaded or offered until the feed verifies and matches what
 * electron-updater read, so a feed planted on the server is ignored.
 */
export class BeaconAutoUpdater {
  #ready: string | null = null;
  #retry: NodeJS.Timeout | null = null;
  readonly #self = selfUpdating(process.platform, process.env);
  #status: UpdateStatus;

  constructor(private readonly hooks: AutoUpdaterHooks) {
    this.#status = initialUpdateStatus(hooks.version(), this.#self);
  }

  /** For the Settings page. */
  status(): UpdateStatus {
    return this.#status;
  }

  /** "Check for updates" in Settings: asks now and answers with what was found. */
  async checkNow(): Promise<UpdateStatus> {
    await autoUpdater.checkForUpdates().catch(() => null);
    return this.#status;
  }

  /** "Restart to update" in Settings. */
  installNow(): void {
    if (this.#status.state === 'ready') this.#install(false);
  }

  #report(event: UpdateEvent): void {
    this.#status = nextUpdateStatus(this.#status, event);
  }

  start(): void {
    // Downloads start only after the signed feed has been checked (below).
    autoUpdater.autoDownload = false;
    // Quitting Beacon also finishes a downloaded update, silently.
    autoUpdater.autoInstallOnAppQuit = this.#self;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () =>
      this.#report({ type: 'checking' }),
    );
    autoUpdater.on('update-not-available', () =>
      this.#report({ at: Date.now(), type: 'none' }),
    );
    autoUpdater.on('download-progress', (progress) =>
      this.#report({ percent: progress.percent, type: 'progress' }),
    );
    autoUpdater.on('error', () => {
      // Offline or a feed problem: the next scheduled check tries again.
      this.#report({ type: 'error' });
    });
    autoUpdater.on('update-available', (info) => {
      void this.#verified(info).then((trusted) => {
        if (!trusted) {
          // A feed that does not verify is treated as no update at all.
          this.#report({ at: Date.now(), type: 'none' });
          return;
        }
        if (this.#ready === info.version) return;
        this.#report({ type: 'found', version: info.version });
        if (this.#self) {
          void autoUpdater.downloadUpdate().catch(() => null);
          return;
        }
        this.hooks.offer({
          label: `Download Beacon ${info.version}…`,
          run: () => this.hooks.openDownloadPage(),
        });
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.#ready = info.version;
      this.#report({ type: 'downloaded', version: info.version });
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

  /** Fetches the feed and its signature and checks both against what
   * electron-updater is about to download. Any failure means "do not update". */
  async #verified(info: {
    version: string;
    files: { sha512: string }[];
  }): Promise<boolean> {
    try {
      const base = `${PRODUCTION_ORIGIN}/downloads/${feedFileName(process.platform)}`;
      const [feed, signature] = await Promise.all(
        [base, `${base}.sig`].map(async (url) => {
          const response = await fetch(url, {
            cache: 'no-store',
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) throw new Error('feed unavailable');
          return Buffer.from(await response.arrayBuffer());
        }),
      );
      return (
        verifyFeedSignature(feed!, signature!.toString('utf8')) &&
        updateMatchesSignedFeed(info, feed!.toString('utf8'))
      );
    } catch {
      return false;
    }
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
