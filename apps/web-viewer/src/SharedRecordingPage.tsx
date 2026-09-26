import { useEffect, useRef, useState } from 'react';

import { ApiError, request } from './api';
import { downloadBlob } from './browser-download';
import { Brand } from './Icon';
import {
  extensionForRecordingMime,
  loadSharedRecordingForPlayback,
} from './recording-playback';
import './RecordingLibrary.css';
import './ShareClipDialog.css';

type Status = 'checking' | 'invalid' | 'unavailable' | 'ready';

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/** The public, no-account counterpart to the owner's own clip playback:
 * opening /shared/:token checks the link is still valid, then lets the
 * visitor decrypt and view (or save) exactly that one clip -- nothing else
 * about the household is ever exposed. See ADR 0077. */
export function SharedRecordingPage() {
  const token = window.location.pathname.slice('/shared/'.length);
  const [status, setStatus] = useState<Status>('checking');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingClip, setLoadingClip] = useState(false);
  const [error, setError] = useState('');
  const [playback, setPlayback] = useState<{
    url: string;
    type: string;
  } | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('checking');
    void request<{ expiresAt: string }>(`/api/shared-recordings/${token}`)
      .then((result) => {
        if (cancelled) return;
        setExpiresAt(result.expiresAt);
        setStatus('ready');
      })
      .catch((caught) => {
        if (cancelled) return;
        setStatus(
          caught instanceof ApiError && caught.status === 404
            ? 'invalid'
            : 'unavailable',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  async function play() {
    setLoadingClip(true);
    setError('');
    try {
      const blob = await loadSharedRecordingForPlayback(token);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPlayback({ type: blob.type, url });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The clip could not be loaded.',
      );
    } finally {
      setLoadingClip(false);
    }
  }

  async function download() {
    setLoadingClip(true);
    setError('');
    try {
      const blob = await loadSharedRecordingForPlayback(token);
      downloadBlob(
        blob,
        `beacon-shared-clip.${extensionForRecordingMime(blob.type)}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The clip could not be downloaded.',
      );
    } finally {
      setLoadingClip(false);
    }
  }

  if (status === 'checking')
    return (
      <main className="shell trust-shell pair-link-shell">
        <section className="trust-page" aria-labelledby="shared-clip-title">
          <a className="trust-brand" href="/" aria-label="Beacon home">
            <Brand />
          </a>
          <p className="eyebrow">Shared clip</p>
          <h1 id="shared-clip-title">Checking link…</h1>
        </section>
      </main>
    );

  if (status === 'invalid')
    return (
      <main className="shell trust-shell pair-link-shell">
        <section className="trust-page" aria-labelledby="shared-clip-title">
          <a className="trust-brand" href="/" aria-label="Beacon home">
            <Brand />
          </a>
          <p className="eyebrow">Shared clip</p>
          <h1 id="shared-clip-title">This link is no longer available.</h1>
          <p className="trust-lead">
            It may have expired or been revoked by whoever shared it. Ask them
            for a new link.
          </p>
          <a className="secondary button-link" href="/">
            Return to Beacon
          </a>
        </section>
      </main>
    );

  if (status === 'unavailable')
    return (
      <main className="shell trust-shell pair-link-shell">
        <section className="trust-page" aria-labelledby="shared-clip-title">
          <a className="trust-brand" href="/" aria-label="Beacon home">
            <Brand />
          </a>
          <p className="eyebrow">Shared clip</p>
          <h1 id="shared-clip-title">Couldn’t connect right now.</h1>
          <p className="trust-lead">
            Check your connection and try again. Your link may still be valid.
          </p>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Try again
          </button>
        </section>
      </main>
    );

  return (
    <main className="shell trust-shell pair-link-shell">
      <section className="trust-page" aria-labelledby="shared-clip-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">Shared clip</p>
        <h1 id="shared-clip-title">Someone shared a clip with you.</h1>
        {expiresAt && (
          <p className="trust-lead">
            This link is available until {formatExpiry(expiresAt)}.
          </p>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--status-error)' }}>
            {error}
          </p>
        )}
        {!playback ? (
          <div className="share-clip-actions">
            <button
              type="button"
              className="btn primary"
              disabled={loadingClip}
              onClick={() => void play()}
            >
              {loadingClip ? 'Loading…' : 'Play clip'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={loadingClip}
              onClick={() => void download()}
            >
              Download
            </button>
          </div>
        ) : (
          <div className="recording-library-player">
            <video
              aria-label="Shared clip"
              controls
              autoPlay
              playsInline
              src={playback.url}
            />
          </div>
        )}
      </section>
    </main>
  );
}
