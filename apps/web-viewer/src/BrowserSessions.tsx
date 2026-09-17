import { useEffect, useState } from 'react';
import { request } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { browserOsLabel } from './naming';

interface BrowserSession {
  createdAt: string;
  current: boolean;
  expiresAt: string;
  id: string;
  lastSeenAt: string;
  userAgent?: string | null;
}

const REVEAL_INITIAL = 8;

function sessionLabel(session: BrowserSession): string {
  const known = browserOsLabel(
    session.userAgent,
    session.current ? 'This device' : 'Signed-in device',
  );
  return known;
}

export function BrowserSessions({
  onCurrentRevoked,
}: {
  onCurrentRevoked: () => void;
}) {
  const [sessions, setSessions] = useState<BrowserSession[] | null>(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState('');
  const [visible, setVisible] = useState(REVEAL_INITIAL);
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
        if (active) setError('Signed-in devices could not be loaded.');
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
      setError('That device could not be revoked. Try again.');
    } finally {
      setRevoking('');
    }
  }

  return (
    <section aria-label="Signed-in devices" className="settings-subsection">
      <h3>Signed-in devices</h3>
      {error && (
        <p role="alert" className="settings-card-inline-message">
          {error}
        </p>
      )}
      {sessions === null && !error && (
        <p role="status" className="settings-card-inline-message">
          Loading…
        </p>
      )}
      {sessions?.length === 0 && (
        <p className="settings-card-empty">No signed-in devices.</p>
      )}
      {sessions && sessions.length > 0 && (
        <>
          <ul className="session-list">
            {sessions.slice(0, visible).map((session) => (
              <li className="session-row" key={session.id}>
                <span className="item-icon">
                  <Icon name="browser" />
                </span>
                <div className="session-identity">
                  <strong>{sessionLabel(session)}</strong>
                  <span>
                    {session.current
                      ? 'Active now'
                      : `Last active ${new Date(session.lastSeenAt).toLocaleDateString()}`}
                  </span>
                </div>
                {session.current ? (
                  <span className="pill">Current</span>
                ) : (
                  <button
                    className="secondary"
                    disabled={Boolean(revoking)}
                    onClick={() => setConfirmSession(session)}
                    type="button"
                  >
                    {revoking === session.id ? 'Revoking…' : 'Revoke'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {sessions.length > visible && (
            <div className="notification-reveal">
              <span>
                {visible} of {sessions.length} devices
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => setVisible((count) => count + REVEAL_INITIAL)}
              >
                Load more devices
              </button>
            </div>
          )}
        </>
      )}
      {confirmSession && (
        <ConfirmDialog
          title="Revoke this device?"
          description="It will be signed out immediately and will need to sign in again to view cameras."
          confirmLabel="Revoke device"
          onConfirm={() => void revoke(confirmSession)}
          onCancel={() => setConfirmSession(null)}
        />
      )}
    </section>
  );
}
