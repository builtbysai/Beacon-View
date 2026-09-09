import { useEffect, useState } from 'react';
import { request } from './api';
import { ConfirmDialog } from './ConfirmDialog';

interface BrowserSession {
  createdAt: string;
  current: boolean;
  expiresAt: string;
  id: string;
  lastSeenAt: string;
  userAgent?: string | null;
}

/** A short, privacy-preserving browser/OS label parsed from the session's
 * user-agent string — e.g. "Chrome on Windows", "Safari on iPhone". No IP
 * address or fingerprinting: just the same coarse browser family/OS info
 * every site already receives on every request. Falls back to a generic
 * label when the user-agent is missing or unrecognized. */
export function friendlySessionLabel(userAgent: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  if (!userAgent) return { browser: null, os: null };
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\/|CriOS\//.test(userAgent)
        ? 'Chrome'
        : /Firefox\/|FxiOS\//.test(userAgent)
          ? 'Firefox'
          : /Version\/.*Safari\//.test(userAgent)
            ? 'Safari'
            : null;
  const os = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : null;
  return { browser, os };
}

function sessionLabel(session: BrowserSession): string {
  const { browser, os } = friendlySessionLabel(session.userAgent);
  const known =
    browser && os
      ? `${browser} on ${os}`
      : (browser ??
        os ??
        (session.current ? 'This browser' : 'Signed-in browser'));
  return session.current ? `${known} · current session` : known;
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
    <section aria-labelledby="browser-sessions-title">
      <h4 id="browser-sessions-title">Signed-in browsers</h4>
      <p className="notice">
        Revoke any browser you do not recognize. Beacon never shows IP addresses
        or device fingerprints here — only the browser and operating system
        family.
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
                <strong>{sessionLabel(session)}</strong>
                <span>
                  Last active {new Date(session.lastSeenAt).toLocaleString()}
                </span>
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
    </section>
  );
}
