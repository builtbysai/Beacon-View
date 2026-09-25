import { useEffect, useRef, useState } from 'react';

import { request } from './api';
import { loadRecordingForPlayback } from './recording-playback';
import './RecordingLibrary.css';

interface RecordingSummary {
  id: string;
  cameraName: string;
  deviceName: string;
  status:
    | 'requested'
    | 'recording'
    | 'uploading'
    | 'available'
    | 'failed'
    | 'deleting';
  durationMs: number | null;
  createdAt: string;
}

function recordingTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function RecordingLibrary() {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<{ id: string; url: string } | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const result = await request<{ recordings: RecordingSummary[] }>(
        '/api/recordings',
      );
      if (!Array.isArray(result.recordings))
        throw new Error('Invalid recording list');
      setRecordings(result.recordings);
    } catch {
      setError('Could not load recordings. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function closePlayback() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPlayback(null);
    setBusyId(null);
  }

  async function play(recording: RecordingSummary) {
    closePlayback();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyId(recording.id);
    setError('');
    try {
      const blob = await loadRecordingForPlayback(
        recording.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPlayback({ id: recording.id, url });
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Recording could not be played.',
        );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusyId(null);
      }
    }
  }

  return (
    <section
      className="recording-library"
      aria-labelledby="recording-library-title"
    >
      <div className="recording-library-head">
        <div>
          <h2 id="recording-library-title">Recorded clips</h2>
          <p>
            Encrypted clips in your Google Drive. Playback opens on this device.
          </p>
        </div>
        <button
          className="btn secondary"
          onClick={() => void refresh()}
          type="button"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p className="recording-library-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading recordings…</p>
      ) : recordings.length === 0 ? (
        <p className="recording-library-empty">No recorded clips yet.</p>
      ) : (
        <ul className="recording-library-list">
          {recordings.map((recording) => (
            <li key={recording.id}>
              <div>
                <strong>{recording.cameraName}</strong>
                <span>
                  {recording.deviceName} · {recordingTime(recording.createdAt)}
                </span>
              </div>
              {recording.status === 'available' ? (
                <button
                  className="btn secondary"
                  disabled={busyId !== null}
                  onClick={() => void play(recording)}
                  type="button"
                >
                  {busyId === recording.id ? 'Opening…' : 'Play clip'}
                </button>
              ) : (
                <span className="recording-library-status">
                  {recording.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {playback && (
        <div className="recording-library-player">
          <video
            aria-label="Recorded clip"
            controls
            playsInline
            src={playback.url}
          />
          <button
            className="btn secondary"
            onClick={closePlayback}
            type="button"
          >
            Close clip
          </button>
        </div>
      )}
    </section>
  );
}
