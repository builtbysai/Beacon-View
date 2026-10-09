import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import type { DiagnosticSnapshot } from './diagnostic-report';

export function SetupHealthCheck() {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<string[] | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function check() {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setChecking(true);
    setResults(null);
    const options = { signal: pending.signal };
    const [connections, drive, alerts] = await Promise.allSettled([
      request<DiagnosticSnapshot>('/api/diagnostics', options),
      request<{
        configured: boolean;
        recordingsConnected: boolean;
        expired?: boolean;
      }>('/api/drive/status', options),
      request<{
        preferences: Array<{
          motionEnabled: boolean;
          offlineEnabled: boolean;
          motionSnoozedUntil?: string | null;
          quietHours?: unknown;
        }>;
      }>('/api/notification-preferences', options),
    ]);
    if (pending.signal.aborted) return;
    setResults([
      window.isSecureContext && typeof RTCPeerConnection !== 'undefined'
        ? 'Viewer: secure connection and WebRTC available. Open a camera to test video and audio.'
        : 'Viewer: use a supported browser over HTTPS to watch cameras.',
      connections.status !== 'fulfilled' ||
      !Array.isArray(connections.value.cameras) ||
      connections.value.unavailable?.includes('cameras')
        ? 'Camera connectivity: could not be checked. Retry when Beacon is reachable.'
        : connections.value.cameras.length === 0
          ? 'Camera connectivity: no cameras paired. Add a camera first.'
          : `Camera connectivity: ${connections.value.cameras.filter((camera) => camera.availability === 'online').length} of ${connections.value.cameras.length} cameras online. Review offline cameras and intentional privacy pauses on the camera device.`,
      drive.status !== 'fulfilled' ||
      typeof drive.value.configured !== 'boolean' ||
      typeof drive.value.recordingsConnected !== 'boolean'
        ? 'Recording connection: could not be checked.'
        : !drive.value.configured
          ? 'Recording connection: Google Drive is unavailable on this server.'
          : drive.value.expired
            ? 'Recording connection: reconnect Google Drive in Data & storage.'
            : drive.value.recordingsConnected
              ? 'Recording connection: Google Drive connected. Make a short, explicitly requested test clip and play it back to verify recording.'
              : 'Recording connection: connect Google Drive for recordings in Data & storage.',
      alerts.status !== 'fulfilled' || !Array.isArray(alerts.value.preferences)
        ? 'Alert preferences: could not be checked.'
        : alerts.value.preferences.some(
              (preference) =>
                preference.motionEnabled === true ||
                preference.offlineEnabled === true,
            )
          ? 'Alert preferences: enabled for at least one device. Snooze and quiet hours may delay motion alerts. Check Notifications on the receiving device and test delivery.'
          : 'Alert preferences: no motion or offline alerts enabled. Review Notifications if you want these alerts.',
    ]);
    setChecking(false);
  }

  return (
    <section className="diagnostic-section setup-health-check">
      <h3>Setup health check</h3>
      <p>
        Read-only checks for this household. No capture, permission prompts,
        recordings, or test alerts start automatically.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={checking}
        onClick={() => void check()}
      >
        {checking ? 'Checking setup…' : 'Check setup'}
      </button>
      {results && (
        <ul aria-live="polite">
          {results.map((result) => (
            <li key={result}>{result}</li>
          ))}
        </ul>
      )}
      <p>
        Permissions require a check on the camera device: confirm camera access,
        microphone access if you use audio, and visible capture status. Privacy
        mode must stay respected. Connection checks cannot verify remote
        permissions or actual capture.
      </p>
      <p>
        <a href="/">Open cameras</a> ·{' '}
        <a href="/settings?section=notifications">Notifications</a> ·{' '}
        <a href="/settings?section=data">Data &amp; storage</a>
      </p>
    </section>
  );
}
