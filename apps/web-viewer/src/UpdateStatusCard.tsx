import { useEffect, useState } from 'react';

import { useAppUpdate } from './app-update';
import { type DesktopUpdateStatus, desktopBridge } from './desktop-shell';
import { SettingsCard, SettingsRow } from './SettingsUI';

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
    </SettingsCard>
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
