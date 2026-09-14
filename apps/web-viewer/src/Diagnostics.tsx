import { useEffect, useState } from 'react';

import { request } from './api';

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
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void request<DiagnosticSnapshot>('/api/diagnostics')
      .then((result) => {
        if (active) setDiagnostics(result);
      })
      .catch(() => {
        if (active)
          setError('Connection diagnostics are temporarily unavailable.');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="card wide">
      <h3>Development diagnostics</h3>
      {error && <p role="alert">{error}</p>}
      {!diagnostics && !error && (
        <p role="status">Loading sanitized connection diagnostics...</p>
      )}
      {diagnostics && (
        <>
          <h4>Devices</h4>
          <ul className="diagnostic-list">
            {diagnostics.devices.map((device) => (
              <li key={device.deviceId}>
                <strong>{device.platform}</strong>
                <span>{device.connectionState}</span>
                <span>{device.lastHeartbeatAt ?? 'No heartbeat'}</span>
              </li>
            ))}
          </ul>
          <h4>Camera sessions</h4>
          <ul className="diagnostic-list">
            {diagnostics.cameras.map((camera) => (
              <li key={camera.cameraId}>
                <strong>{camera.facing}</strong>
                <span>Capture: {camera.captureState}</span>
                <span>Viewers: {camera.viewerCount}</span>
                <span>
                  Connections: {camera.viewerConnectionIds.join(', ') || 'none'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="notice">
        Diagnostics use public identifiers and never include credentials, SDP,
        raw ICE candidates, or household IDs.
      </p>
    </section>
  );
}
