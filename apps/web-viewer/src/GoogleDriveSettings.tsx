import { useEffect, useState } from 'react';

import { request } from './api';
import { SettingsCard, SettingsRow } from './SettingsUI';

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

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const result = parameters.get('drive');
    if (result === 'connected') {
      setMessage('Google Drive connected.');
    } else if (result === 'denied') {
      setError(
        'Google Drive permission was not granted. Try again when ready.',
      );
    } else if (result === 'failed') {
      setError('Google Drive could not be connected. Please try again.');
    }
    if (result) {
      parameters.delete('drive');
      const search = parameters.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`,
      );
    }
  }, []);

  async function load(clearError = true) {
    try {
      if (clearError) setError('');
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
    void load(false);
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

  if (!status) {
    return error ? (
      <p role="alert">{error}</p>
    ) : (
      <p role="status">Loading Google Drive…</p>
    );
  }

  return (
    <SettingsCard aria-label="Google Drive">
      <SettingsRow
        title={
          status.connected
            ? 'Google Drive connected'
            : 'Use Google Drive for Beacon data'
        }
        description={
          <>
            Private app data only. Camera media and recordings are not uploaded.
            {status.providerEmail && (
              <>
                <br />
                Connected account: {status.providerEmail}
              </>
            )}
          </>
        }
      >
        {!status.connected && status.configured && (
          <a className="secondary button-link" href="/api/drive/connect">
            Connect Google Drive
          </a>
        )}
        {!status.configured && (
          <a className="secondary button-link" href="/api/drive/connect">
            Retry setup
          </a>
        )}
      </SettingsRow>
      {status.connected && (
        <SettingsRow
          title="Manage connection"
          description="Verify Beacon can still reach Drive, or disconnect it."
        >
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
        </SettingsRow>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </SettingsCard>
  );
}
