import { useEffect, useState } from 'react';

import { androidApp, isNewerAndroidVersion } from './android-shell';
import { fileVersion } from './app-downloads';
import { useAppUpdate } from './app-update';
import { type DesktopUpdateStatus, desktopBridge } from './desktop-shell';
import { loadDownloads } from './downloads';
import { SettingsCard, SettingsRow } from './SettingsUI';
import { useAndroidApp } from './use-android-app';

function ago(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** What this device is running and whether a newer version waits (ADR 0118): the web app itself, and, inside
 * the desktop app, the app around it. */
export function UpdateStatusCard() {
  const web = useAppUpdate();
  const desktop = desktopBridge();
  const [checked, setChecked] = useState<'idle' | 'checking' | 'current'>(
    'idle',
  );
  return (
    <SettingsCard aria-label="Updates">
      <SettingsRow
        title="This page"
        description={
          web.pending
            ? 'A new version of Beacon is ready.'
            : checked === 'current'
              ? 'You have the latest version.'
              : 'Beacon updates itself on the web. Reload to pick up a new version.'
        }
      >
        {web.pending ? (
          <button className="primary" onClick={web.reload} type="button">
            Reload
          </button>
        ) : (
          <button
            className="secondary"
            disabled={checked === 'checking'}
            onClick={() => {
              setChecked('checking');
              void web
                .checkNow()
                .then((newer) => setChecked(newer ? 'idle' : 'current'));
            }}
            type="button"
          >
            {checked === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </SettingsRow>
      {desktop?.getUpdateStatus && <DesktopUpdateRow />}
      <AndroidUpdateRow />
    </SettingsCard>
  );
}

/** Inside the Android app: which build is installed and whether the server publishes a newer one (ADR 0118). A
 * sideloaded app cannot update itself quietly, so the button opens the download. */
function AndroidUpdateRow() {
  const { inApp, version } = useAndroidApp();
  const [latest, setLatest] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!inApp) return;
    let active = true;
    void loadDownloads().then((manifest) => {
      if (!active) return;
      const file = manifest?.files.find(
        (entry) => entry.platform === 'android',
      );
      setLatest(file && manifest ? fileVersion(file, manifest) : null);
      setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [inApp]);
  if (!inApp || !version) return null;
  const newer = latest !== null && isNewerAndroidVersion(latest, version);
  return (
    <SettingsRow
      title={`Beacon app ${version}`}
      description={
        newer
          ? `Version ${latest} is available. Download it, open the file and allow the install; your pairing and sign-in stay as they are.`
          : checked
            ? 'You have the latest version.'
            : 'Checking for updates…'
      }
    >
      {newer && (
        <button
          className="primary"
          onClick={() => void androidApp.openUpdate().catch(() => undefined)}
          type="button"
        >
          Download {latest}
        </button>
      )}
    </SettingsRow>
  );
}

function DesktopUpdateRow() {
  const bridge = desktopBridge();
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  useEffect(() => {
    let active = true;
    const read = () =>
      void bridge?.getUpdateStatus?.().then((next) => {
        if (active) setStatus(next);
      });
    read();
    const timer = window.setInterval(read, 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [bridge]);
  if (!status) return null;

  const description =
    status.state === 'checking'
      ? 'Checking…'
      : status.state === 'downloading'
        ? `Downloading ${status.version ?? 'the update'}${status.percent === undefined ? '' : ` (${status.percent}%)`}…`
        : status.state === 'ready'
          ? `Version ${status.version ?? ''} is ready. It installs when the camera and window are idle, or now.`
          : status.state === 'manual'
            ? `Version ${status.version ?? ''} is available. Download it from the Apps list below and run it.`
            : status.state === 'error'
              ? 'The last check could not reach Beacon. It tries again by itself.'
              : status.checkedAt
                ? `Up to date. Checked ${ago(status.checkedAt)}.`
                : 'Up to date.';
  return (
    <SettingsRow
      title={`Beacon desktop app ${status.currentVersion}`}
      description={description}
    >
      {status.state === 'ready' ? (
        <button
          className="primary"
          onClick={() => void bridge?.installUpdate?.()}
          type="button"
        >
          Restart to update
        </button>
      ) : (
        <button
          className="secondary"
          disabled={
            status.state === 'checking' || status.state === 'downloading'
          }
          onClick={() => void bridge?.checkForUpdates?.().then(setStatus)}
          type="button"
        >
          Check for updates
        </button>
      )}
    </SettingsRow>
  );
}
