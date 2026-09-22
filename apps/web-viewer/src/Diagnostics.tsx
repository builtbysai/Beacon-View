import { useEffect, useState } from 'react';

import { request } from './api';
import { Icon } from './Icon';
import './Diagnostics.css';

interface DiagnosticSnapshot {
  cameras: Array<{
    cameraId: string;
    captureState: string;
    facing: string;
    viewerConnectionIds: string[];
    viewerCount: number;
  }>;
  devices: Array<{
    connectionState: string;
    deviceId: string;
    lastHeartbeatAt: string | null;
    platform: string;
  }>;
}

export function Diagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticSnapshot | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [requestRevision, setRequestRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void request<DiagnosticSnapshot>('/api/diagnostics')
      .then((result) => {
        if (active) setDiagnostics(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [requestRevision]);

  function retry() {
    setError(false);
    setRequestRevision((revision) => revision + 1);
  }

  return (
    <div className="view-body">
      <div className="diagnostics-view">
        <header className="diagnostics-header">
          <h2>Development Diagnostics</h2>
          <p>System and device status for debugging.</p>
        </header>

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
            <section className="diagnostic-section">
              <h3>Devices</h3>
              <ul className="diagnostic-list">
                {diagnostics.devices.length === 0 ? (
                  <li className="text-muted">No devices connected.</li>
                ) : (
                  diagnostics.devices.map((device) => (
                    <li key={device.deviceId}>
                      <strong>{device.platform}</strong>
                      <span>{device.connectionState}</span>
                      <span>{device.lastHeartbeatAt ?? 'No heartbeat'}</span>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className="diagnostic-section">
              <h3>Camera Sessions</h3>
              <ul className="diagnostic-list">
                {diagnostics.cameras.length === 0 ? (
                  <li className="text-muted">No active camera sessions.</li>
                ) : (
                  diagnostics.cameras.map((camera) => (
                    <li key={camera.cameraId}>
                      <strong>{camera.facing}</strong>
                      <span>Capture: {camera.captureState}</span>
                      <span>Viewers: {camera.viewerCount}</span>
                      <span>
                        Conns: {camera.viewerConnectionIds.join(', ') || 'none'}
                      </span>
                    </li>
                  ))
                )}
              </ul>
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
