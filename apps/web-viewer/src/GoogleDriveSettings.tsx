import { useEffect, useState } from 'react';

import { request } from './api';

interface DriveStatus {
  connected: boolean;
  configured: boolean;
  providerEmail: string | null;
  updatedAt: string | null;
}

export function GoogleDriveSettings() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      setStatus(await request<DriveStatus>('/api/drive/status'));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to load Drive status',
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function verify() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/api/drive/verify', { method: 'POST' });
      setMessage('Google Drive connection verified.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Drive verification failed',
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/api/drive/connection', { method: 'DELETE' });
      setStatus((current) =>
        current
          ? { ...current, connected: false, providerEmail: null }
          : current,
      );
      setMessage('Google Drive disconnected.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to disconnect Drive',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p>Loading Google Drive…</p>;

  return (
    <div className="drive-settings">
      <div className="settings-row">
        <div>
          <strong>
            {status.connected
              ? 'Google Drive connected'
              : 'Use Google Drive for Beacon data'}
          </strong>
          <p>
            Beacon requests access only to its private app-data area. Camera
            media and recordings are not uploaded by this connection.
          </p>
          {status.providerEmail && (
            <p>Connected account: {status.providerEmail}</p>
          )}
        </div>
        {!status.connected && status.configured && (
          <a className="secondary button-link" href="/api/drive/connect">
            Connect Google Drive
          </a>
        )}
        {!status.configured && (
          <span className="settings-muted">Not enabled on this server</span>
        )}
      </div>
      {status.connected && (
        <div className="settings-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void verify()}
          >
            {busy ? 'Checking…' : 'Verify connection'}
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Disconnect Drive
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
