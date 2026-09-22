import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, request } from './api';
import {
  ClipRecorder,
  MAX_CLIP_DURATION_MS,
  pickRecorderMimeType,
  recordingContainerType,
  sha256Hex,
  uploadClipToDrive,
} from './recording-capture';

export type ClipRecorderStatus =
  'idle' | 'starting' | 'recording' | 'uploading' | 'available' | 'failed';

export interface ClipRecorderState {
  status: ClipRecorderStatus;
  elapsedMs: number;
  error: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : fallback;
}

/** Captures a short clip locally and uploads it straight to the Drive
 * session Beacon opens for it -- used both by the live viewer (recording
 * the stream it's receiving) and by browser camera mode (recording its own
 * local getUserMedia stream). Beacon's server never sees the media. */
export function useClipRecorder(cameraId: string): {
  state: ClipRecorderState;
  start: (stream: MediaStream) => void;
  stop: () => void;
  /** Clears a finished ('available' or 'failed') state back to 'idle' so
   * the control returns to "Record a short clip" -- a no-op while a
   * recording is actually in progress. */
  reset: () => void;
  supported: boolean;
} {
  const [state, setState] = useState<ClipRecorderState>({
    elapsedMs: 0,
    error: '',
    status: 'idle',
  });
  const recorderRef = useRef<ClipRecorder | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const tickRef = useRef<number | null>(null);
  const autoStopRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
    tickRef.current = null;
    autoStopRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    const recordingId = recordingIdRef.current;
    if (!recorder || !recordingId) return;
    clearTimers();
    setState((current) => ({ ...current, status: 'uploading' }));
    void (async () => {
      try {
        const { blob, durationMs } = await recorder.stop();
        const checksumSha256 = await sha256Hex(blob);
        const session = await request<{ uploadUrl: string }>(
          `/api/recordings/${recordingId}/upload-session`,
          {
            body: JSON.stringify({
              byteSize: blob.size,
              checksumSha256,
              durationMs: Math.min(Math.max(durationMs, 1_000), 600_000),
              mimeType: recordingContainerType(recorder.mimeType),
            }),
            method: 'POST',
          },
        );
        const providerFileId = await uploadClipToDrive(session.uploadUrl, blob);
        await request(`/api/recordings/${recordingId}/complete`, {
          body: JSON.stringify({ providerFileId }),
          method: 'POST',
        });
        setState({ elapsedMs: 0, error: '', status: 'available' });
      } catch (error) {
        setState({
          elapsedMs: 0,
          error: errorMessage(error, 'Recording could not be uploaded.'),
          status: 'failed',
        });
      } finally {
        recorderRef.current = null;
        recordingIdRef.current = null;
      }
    })();
  }, [clearTimers]);

  const start = useCallback(
    (stream: MediaStream) => {
      if (state.status === 'recording' || state.status === 'uploading') return;
      setState({ elapsedMs: 0, error: '', status: 'starting' });
      void (async () => {
        try {
          const mimeType = pickRecorderMimeType();
          if (!mimeType) throw new Error('This browser cannot record video.');
          const created = await request<{ recording: { id: string } }>(
            '/api/recordings',
            { body: JSON.stringify({ cameraId }), method: 'POST' },
          );
          recordingIdRef.current = created.recording.id;
          const recorder = new ClipRecorder(stream, mimeType);
          recorderRef.current = recorder;
          recorder.start();
          setState({ elapsedMs: 0, error: '', status: 'recording' });
          const startedAt = Date.now();
          tickRef.current = window.setInterval(() => {
            setState((current) =>
              current.status === 'recording'
                ? { ...current, elapsedMs: Date.now() - startedAt }
                : current,
            );
          }, 500);
          autoStopRef.current = window.setTimeout(stop, MAX_CLIP_DURATION_MS);
        } catch (error) {
          setState({
            elapsedMs: 0,
            error: errorMessage(error, 'Recording could not be started.'),
            status: 'failed',
          });
        }
      })();
    },
    [cameraId, state.status, stop],
  );

  const reset = useCallback(() => {
    setState((current) =>
      current.status === 'available' || current.status === 'failed'
        ? { elapsedMs: 0, error: '', status: 'idle' }
        : current,
    );
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      recorderRef.current?.discard();
    },
    [clearTimers],
  );

  return {
    reset,
    start,
    state,
    stop,
    supported: pickRecorderMimeType() !== null,
  };
}
