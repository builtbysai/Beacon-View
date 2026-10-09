import { useEffect, useState } from 'react';

import { request } from './api';
import { Icon } from './Icon';
import { SetupHealthCheck } from './SetupHealthCheck';
import {
  connectionGuidance,
  diagnosticReport,
  heartbeatSummary,
  type DiagnosticSnapshot,
} from './diagnostic-report';
import './Diagnostics.css';

export function Diagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticSnapshot | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [requestRevision, setRequestRevision] = useState(0);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void request<DiagnosticSnapshot>('/api/diagnostics', {
      signal: controller.signal,
    })
      .then((result) => {
        if (active) {
          setDiagnostics(result);
          setCheckedAt(new Date());
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [requestRevision]);

  function retry() {
    setError(false);
    setDiagnostics(null);
    setCheckedAt(null);
    setCopyStatus('');
    setRequestRevision((revision) => revision + 1);
  }

  const camerasUnavailable = diagnostics?.unavailable?.includes('cameras');
  const devicesUnavailable = diagnostics?.unavailable?.includes('devices');
  const report =
    diagnostics && checkedAt ? diagnosticReport(diagnostics, checkedAt) : '';

  async function copyReport() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus('Report copied. Review it before sharing.');
    } catch {
      setCopyStatus(
        'Copy is unavailable. Open Preview report to select the text and copy it manually.',
      );
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="view-body">
      <div className="diagnostics-view">
        <header className="diagnostics-header">
          <h2>Connection details</h2>
          <p>
            Check whether your cameras are reaching Beacon and get help with
            connection problems.
          </p>
        </header>

        <SetupHealthCheck />
        {error ? (
          <p role="alert">
            Diagnostics could not be loaded.{' '}
            <button type="button" className="secondary" onClick={retry}>
              Retry
            </button>
          </p>
        ) : !diagnostics ? (
          <p>Loading sanitized connection diagnostics...</p>
        ) : (
          <>
            <div className="diagnostics-actions">
              <p>
                Checked at {checkedAt?.toLocaleTimeString()}. This snapshot does
                not test video, audio, or notification delivery.
              </p>
              <button
                type="button"
                className="secondary"
                disabled={copying}
                onClick={retry}
              >
                Refresh status
              </button>
            </div>
            {(camerasUnavailable || devicesUnavailable) && (
              <p role="alert">
                Some diagnostics could not be loaded.{' '}
                <button
                  type="button"
                  className="secondary"
                  disabled={copying}
                  onClick={retry}
                >
                  Retry
                </button>
              </p>
            )}
            <section className="diagnostic-section">
              <h3>Devices</h3>
              <ul className="diagnostic-list">
                {devicesUnavailable ? (
                  <li className="text-muted">
                    Device diagnostics unavailable.
                  </li>
                ) : diagnostics.devices.length === 0 ? (
                  <li className="text-muted">No devices connected.</li>
                ) : (
                  diagnostics.devices.map((device, index) => (
                    <li key={device.deviceId}>
                      <strong>
                        Device {index + 1} · {device.platform}
                      </strong>
                      <span>{device.connectionState}</span>
                      <span>
                        {heartbeatSummary(device.lastHeartbeatAt, checkedAt!)}
                      </span>
                      <p className="diagnostic-guidance">
                        {connectionGuidance(device.connectionState)}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className="diagnostic-section">
              <h3>Camera Sessions</h3>
              <ul className="diagnostic-list">
                {camerasUnavailable ? (
                  <li className="text-muted">
                    Camera diagnostics unavailable.
                  </li>
                ) : diagnostics.cameras.length === 0 ? (
                  <li className="text-muted">No active camera sessions.</li>
                ) : (
                  diagnostics.cameras.map((camera, index) => (
                    <li key={camera.cameraId}>
                      <strong>
                        Camera {index + 1} · {camera.facing}
                      </strong>
                      <span>Capture: {camera.captureState}</span>
                      <span>Viewers: {camera.viewerCount}</span>
                      <span>
                        {camera.availability ?? 'Availability unknown'}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </section>
            <section className="diagnostic-section diagnostics-report">
              <h3>Report for troubleshooting</h3>
              <p>
                Preview a report with connection states and counts. Device
                names, identifiers, credentials, raw connection data, and
                precise heartbeat times are omitted. Nothing is uploaded.
              </p>
              <details>
                <summary>Preview report</summary>
                <textarea
                  aria-label="Troubleshooting report"
                  readOnly
                  value={report}
                  spellCheck={false}
                />
              </details>
              <button
                type="button"
                className="secondary"
                disabled={copying}
                onClick={() => void copyReport()}
              >
                {copying ? 'Copying…' : 'Copy report'}
              </button>
              {copyStatus && <p role="status">{copyStatus}</p>}
            </section>
          </>
        )}

        <div className="diagnostics-notice">
          <Icon name="shield" />
          <p>
            Diagnostics use public identifiers and never include credentials,
            SDP, raw ICE candidates, or household IDs.
          </p>
        </div>
      </div>
    </div>
  );
}
