import { useEffect, useState } from 'react';

import { desktopBridge } from './desktop-shell';
import { SettingsRow } from './SettingsUI';
import { Switch } from './Switch';

/** Settings for the computer running the Beacon desktop app (ADR 0083).
 * Rendered only inside the desktop app. */
export function DesktopComputerSettings() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void (desktopBridge()?.getAutostart?.() ?? Promise.resolve(false)).then(
      setAutostart,
      () => setAutostart(false),
    );
  }, []);

  async function change(next: boolean) {
    setMessage('');
    const bridge = desktopBridge();
    if (!bridge?.setAutostart) return;
    const actual = await bridge.setAutostart(next).catch(() => !next);
    setAutostart(actual);
    if (actual !== next)
      setMessage(
        'Starting with this computer is available in the installed Beacon app.',
      );
  }

  return (
    <div className="desktop-computer-settings">
      <SettingsRow
        title="Start Beacon when this computer starts"
        description="Beacon opens in the background, so alerts arrive and a camera on this computer comes back after a restart."
      >
        <Switch
          checked={autostart === true}
          disabled={autostart === null}
          label="Start Beacon when this computer starts"
          onChange={(next) => void change(next)}
        />
      </SettingsRow>
      <SettingsRow
        title="Closing the window"
        description="Beacon keeps running in the system tray. Choose Quit Beacon from the tray to close it completely."
      />
      {message && (
        <p role="status" className="settings-card-inline-message">
          {message}
        </p>
      )}
    </div>
  );
}
