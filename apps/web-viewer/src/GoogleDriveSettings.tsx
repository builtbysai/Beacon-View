import { useEffect, useState } from 'react';

import { request } from './api';
import { SettingsCard, SettingsRow } from './SettingsUI';

interface DriveStatus {
  connected: boolean;
  configured: boolean;
  recordingsConnected: boolean;
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
        title="Google Drive"
        description={
          status.connected
            ? status.providerEmail
              ? `Connected as ${status.providerEmail}.`
              : 'Connected.'
            : 'Store Beacon app data and optional recordings in your Drive.'
        }
      >
        {status.connected ? (
          <span className="pill pill-on">Connected</span>
        ) : status.configured ? (
          <>
            <span className="pill">Not connected</span>
            <a
              className="secondary button-link"
              href="/api/drive/connect?purpose=recordings"
            >
              Connect
            </a>
          </>
        ) : (
          <>
            <span className="pill pill-warn">Needs attention</span>
            <a
              className="secondary button-link"
              href="/api/drive/connect?purpose=recordings"
            >
              Retry
            </a>
          </>
        )}
      </SettingsRow>
      {status.connected && (
        <SettingsRow
          title="Cloud recording"
          description={
            status.recordingsConnected
              ? 'Recorded clips upload to your Drive.'
              : 'Grant one more permission to upload recorded clips.'
          }
        >
          {status.recordingsConnected ? (
            <span className="pill pill-on">On</span>
          ) : (
            <a
              className="primary button-link"
              href="/api/drive/connect?purpose=recordings"
            >
              Turn on
            </a>
          )}
        </SettingsRow>
      )}
      {status.connected && (
        <SettingsRow title="Connection">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void verify()}
          >
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        </SettingsRow>
      )}
      {message && (
        <p role="status" className="settings-card-inline-message">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="settings-card-inline-message">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
