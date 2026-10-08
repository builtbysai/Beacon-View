import { useEffect, useState } from 'react';

import { ApiError, request } from './api';
import { friendlyError } from './friendly-errors';
import { SettingsCard, SettingsRow } from './SettingsUI';

interface DriveStatus {
  connected: boolean;
  configured: boolean;
  recordingsConnected: boolean;
  /** Google stopped accepting the connection (expired or revoked). */
  expired?: boolean;
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
      setError('Google Drive couldn’t be connected. Try again.');
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
        friendlyError(
          caught,
          'Google Drive status couldn’t be loaded. Try again.',
        ),
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
        friendlyError(caught, 'Google Drive couldn’t be checked. Try again.'),
      );
      // Verification can discover the connection expired; show that state.
      if (caught instanceof ApiError && caught.code) void load(false);
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
          ? {
              ...current,
              connected: false,
              expired: false,
              providerEmail: null,
              recordingsConnected: false,
            }
          : current,
      );
      setMessage('Google Drive disconnected.');
    } catch (caught) {
      setError(
        friendlyError(
          caught,
          'Google Drive couldn’t be disconnected. Try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return error ? (
      <p role="alert">
        {error}{' '}
        <button type="button" className="secondary" onClick={() => void load()}>
          Retry
        </button>
      </p>
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
            : status.expired
              ? 'Your Google Drive connection expired, so recordings can’t be saved. Reconnect to continue.'
              : 'Store Beacon app data and optional recordings in your Drive.'
        }
      >
        {status.connected ? (
          <span className="pill pill-on">Connected</span>
        ) : status.configured ? (
          <>
            <span className={status.expired ? 'pill pill-warn' : 'pill'}>
              {status.expired ? 'Expired' : 'Not connected'}
            </span>
            <a
              className="secondary button-link"
              href="/api/drive/connect?purpose=recordings"
            >
              {status.expired ? 'Reconnect' : 'Connect'}
            </a>
          </>
        ) : (
          <>
            <span className="pill pill-warn">Unavailable</span>
            <span>Google Drive is not configured on this Beacon server.</span>
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
