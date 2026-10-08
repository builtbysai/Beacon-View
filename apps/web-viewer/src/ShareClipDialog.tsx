import { useEffect, useState } from 'react';

import { request } from './api';
import { friendlyError } from './friendly-errors';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import './ShareClipDialog.css';

interface ActiveLink {
  id: string;
  expiresAt: string;
}

interface CreatedLink {
  token: string;
  url: string;
  expiresAt: string;
}

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/** Owner-only: create, inspect, or revoke the one active share link for a
 * clip. The raw token is only ever shown once, right after creation --
 * matching how a pairing code or invitation link works. See ADR 0077. */
export function ShareClipDialog({
  recordingId,
  cameraName,
  onClose,
}: {
  recordingId: string;
  cameraName: string;
  onClose: () => void;
}) {
  const [checking, setChecking] = useState(true);
  const [activeLink, setActiveLink] = useState<ActiveLink | null>(null);
  const [hours, setHours] = useState(24);
  const [consent, setConsent] = useState(false);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void request<{ active: ActiveLink | null }>(
      `/api/recordings/${recordingId}/share-links`,
    )
      .then((result) => {
        if (!cancelled) setActiveLink(result.active);
      })
      .catch(() => {
        if (!cancelled)
          setError('Couldn’t check for an existing share link. Try again.');
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  async function createLink() {
    setBusy(true);
    setError('');
    try {
      const result = await request<CreatedLink>(
        `/api/recordings/${recordingId}/share-links`,
        {
          body: JSON.stringify({ expiresInHours: hours }),
          method: 'POST',
        },
      );
      setCreated(result);
      setActiveLink(null);
    } catch (caught) {
      setError(
        friendlyError(caught, 'The share link couldn’t be created. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeLink(linkId: string) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/recordings/share-links/${linkId}`, {
        method: 'DELETE',
      });
      setActiveLink(null);
    } catch (caught) {
      setError(
        friendlyError(
          caught,
          'The share link couldn’t be turned off. Try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3_000);
    } catch {
      setError('Couldn’t copy the link. Select it and copy it manually.');
    }
  }

  return (
    <ModalDialog labelledBy="share-clip-title" onDismiss={onClose}>
      <section aria-labelledby="share-clip-title" className="share-clip-modal">
        <div className="share-clip-header">
          <h2 id="share-clip-title">Share {cameraName} clip</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        {error && (
          <p role="alert" className="share-clip-error">
            {error}
          </p>
        )}

        {checking ? (
          <p role="status">Checking for an existing link…</p>
        ) : created ? (
          <div className="share-clip-result">
            <p>
              Anyone with this link can view this clip until{' '}
              {formatExpiry(created.expiresAt)}.
            </p>
            <div className="share-clip-linkrow">
              <input
                type="text"
                readOnly
                value={created.url}
                aria-label="Share link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="btn secondary"
                onClick={() => void copyLink(created.url)}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <button type="button" className="btn secondary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : activeLink ? (
          <div className="share-clip-active">
            <p>
              A link for this clip is active until{' '}
              {formatExpiry(activeLink.expiresAt)}. Anyone who has it can view
              the clip until then.
            </p>
            <div className="share-clip-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void revokeLink(activeLink.id)}
              >
                {busy ? 'Revoking…' : 'Revoke link'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => setActiveLink(null)}
              >
                Replace with a new link
              </button>
            </div>
          </div>
        ) : (
          <div className="share-clip-create">
            <label className="share-clip-duration">
              Link expires after
              <select
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
              >
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={72}>72 hours</option>
              </select>
            </label>
            <label className="share-clip-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I understand anyone with this link can view this clip without a
              Beacon account until it expires or I revoke it.
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={!consent || busy}
              onClick={() => void createLink()}
            >
              {busy ? 'Creating…' : 'Create link'}
            </button>
          </div>
        )}
      </section>
    </ModalDialog>
  );
}
