import { useEffect, useState } from 'react';
import { request } from './api';

interface BrowserSession {
  createdAt: string;
  current: boolean;
  expiresAt: string;
  id: string;
  lastSeenAt: string;
}

export function BrowserSessions({
  onCurrentRevoked,
}: {
  onCurrentRevoked: () => void;
}) {
  const [sessions, setSessions] = useState<BrowserSession[] | null>(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState('');

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
    if (revoking || !window.confirm('Revoke this browser session?')) return;
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
    <section aria-labelledby="browser-sessions-title">
      <h4 id="browser-sessions-title">Signed-in browsers</h4>
      <p className="notice">
        Revoke any browser you do not recognize. This list never includes device
        names, IP addresses, or browser fingerprints.
      </p>
      {error && <p role="alert">{error}</p>}
      {sessions === null && !error && (
        <p role="status">Loading signed-in browsers…</p>
      )}
      {sessions?.length === 0 && (
        <p className="empty">No active browser sessions.</p>
      )}
      {sessions && sessions.length > 0 && (
        <ul className="device-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <div>
                <strong>
                  {session.current ? 'This browser' : 'Signed-in browser'}
                </strong>
                <span>
                  Last active {new Date(session.lastSeenAt).toLocaleString()}
                </span>
              </div>
              <button
                className="danger"
                disabled={Boolean(revoking)}
                onClick={() => void revoke(session)}
                type="button"
              >
                {revoking === session.id ? 'Revoking…' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
