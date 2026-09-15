import { useEffect, useState } from 'react';
import { request } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { browserOsLabel } from './naming';
import { SettingsCard } from './SettingsUI';

interface BrowserSession {
  createdAt: string;
  current: boolean;
  expiresAt: string;
  id: string;
  lastSeenAt: string;
  userAgent?: string | null;
}

function sessionLabel(session: BrowserSession): string {
  const known = browserOsLabel(
    session.userAgent,
    session.current ? 'This browser' : 'Signed-in browser',
  );
  return session.current ? `${known} (this session)` : known;
}

export function BrowserSessions({
  onCurrentRevoked,
}: {
  onCurrentRevoked: () => void;
}) {
  const [sessions, setSessions] = useState<BrowserSession[] | null>(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState('');
  const [confirmSession, setConfirmSession] = useState<BrowserSession | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    void request<{ sessions: BrowserSession[] }>('/api/account/sessions')
      .then((result) => {
        if (active) setSessions(result.sessions);
      })
      .catch(() => {
        if (active) setError('Signed-in sessions could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function revoke(session: BrowserSession) {
    if (revoking) return;
    setConfirmSession(null);
    setRevoking(session.id);
    setError('');
    try {
      await request<void>(`/api/account/sessions/${session.id}`, {
        method: 'DELETE',
      });
      if (session.current) {
        onCurrentRevoked();
        return;
      }
      setSessions(
        (items) => items?.filter((item) => item.id !== session.id) ?? null,
      );
    } catch {
      setError('That session could not be revoked. Try again.');
    } finally {
      setRevoking('');
    }
  }

  return (
    <SettingsCard
      title="Signed-in browsers"
      description="Revoke any browser you do not recognize. Only the browser and operating system are shown, never an IP address or device fingerprint."
    >
      {error && (
        <p role="alert" className="settings-card-inline-message">
          {error}
        </p>
      )}
      {sessions === null && !error && (
        <p role="status" className="settings-card-inline-message">
          Loading signed-in browsers…
        </p>
      )}
      {sessions?.length === 0 && (
        <p className="settings-card-empty">No active browser sessions.</p>
      )}
      {sessions && sessions.length > 0 && (
        <ul className="session-list">
          {sessions.map((session) => (
            <li className="session-row" key={session.id}>
              <span className="item-icon">
                <Icon name="browser" />
              </span>
              <div className="session-identity">
                <strong>{sessionLabel(session)}</strong>
                <time dateTime={session.lastSeenAt}>
                  Last active {new Date(session.lastSeenAt).toLocaleString()}
                </time>
              </div>
              {/* Current session already has its own "Sign out" action in
                  Account — showing Revoke here too would be the same action
                  under two names. */}
              {!session.current && (
                <button
                  className="danger"
                  disabled={Boolean(revoking)}
                  onClick={() => setConfirmSession(session)}
                  type="button"
                >
                  <Icon name="logout" />
                  {revoking === session.id ? 'Revoking…' : 'Revoke'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmSession && (
        <ConfirmDialog
          title="Revoke this browser session?"
          description="That browser will be signed out immediately and will need to sign in again to view cameras."
          confirmLabel="Revoke session"
          onConfirm={() => void revoke(confirmSession)}
          onCancel={() => setConfirmSession(null)}
        />
      )}
    </SettingsCard>
  );
}
