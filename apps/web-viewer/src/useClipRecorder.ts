import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, request } from './api';
import {
  captureFrameAsJpeg,
  ClipRecorder,
  DriveUploadError,
  encryptClip,
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

async function reportRecordingFailure(
  recordingId: string,
  reason: 'abandoned' | 'capture_failed' | 'upload_failed',
): Promise<boolean> {
  try {
    await request(`/api/recordings/${recordingId}/fail`, {
      body: JSON.stringify({ reason }),
      method: 'POST',
    });
    return true;
  } catch {
    // Recovery sweeps eventually release the recording if this best-effort
    // report cannot reach Beacon.
    return false;
  }
}

/** Best-effort thumbnail for a clip that just started recording -- never
 * awaited by the caller, never reported as a recording failure, and never
 * retried. See ADR 0078. */
async function uploadThumbnail(
  recordingId: string,
  stream: MediaStream,
): Promise<void> {
  try {
    const frame = await captureFrameAsJpeg(stream);
    const encrypted = await encryptClip(frame);
    const session = await request<{ uploadUrl: string }>(
      `/api/recordings/${recordingId}/thumbnail-upload-session`,
      {
        body: JSON.stringify({
          byteSize: encrypted.blob.size,
          checksumSha256: await sha256Hex(encrypted.blob),
          mimeType: 'image/jpeg',
          encryption: {
            dataKey: encrypted.dataKey,
            iv: encrypted.iv,
            version: 1,
          },
        }),
        method: 'POST',
      },
    );
    const providerFileId = await uploadClipToDrive(
      session.uploadUrl,
      encrypted.blob,
    );
    await request(`/api/recordings/${recordingId}/thumbnail-complete`, {
      body: JSON.stringify({ providerFileId }),
      method: 'POST',
    });
  } catch {
    // A clip without a thumbnail is still a complete, usable clip.
  }
}

interface PendingUpload {
  blob: Blob;
  checksumSha256: string;
  dataKey: string;
  durationMs: number;
  encryptionIv: string;
  mimeType: 'video/mp4' | 'video/webm';
  providerFileId?: string;
  recordingId: string;
  restartSession: boolean;
  uploadUrl?: string;
}

/** Captures a short clip locally and uploads it straight to the Drive
 * session Beacon opens for it -- used both by the live viewer (recording
 * the stream it's receiving) and by browser camera mode (recording its own
 * local getUserMedia stream). Beacon's server never sees the media. */
export function useClipRecorder(cameraId: string): {
  state: ClipRecorderState;
  start: (stream: MediaStream) => void;
  stop: () => void;
  /** Ends a recording in progress without uploading it -- for a capture
   * that can no longer be trusted (the source stream itself ended: a
   * dropped connection, a revoked permission, the camera closing) rather
   * than a normal stop. Reports `capture_failed` and surfaces `message` as
   * the failure reason instead of silently discarding the attempt. */
  abort: (message: string) => void;
  /** Clears a finished ('available' or 'failed') state back to 'idle' so
   * the control returns to "Record a short clip" -- a no-op while a
   * recording is actually in progress. */
  reset: () => void;
  retry: () => void;
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
  const pendingRef = useRef<PendingUpload | null>(null);
  const attemptingRef = useRef(false);
  // The recording's own video track, watched for an unexpected 'ended'
  // event (permission revoked, camera closed by the OS, connection torn
  // down) -- see abort() below. Paired handler so it can be detached
  // without accidentally removing a listener meant for a later recording.
  const trackWatchRef = useRef<{
    track: MediaStreamTrack;
    onEnded: () => void;
  } | null>(null);

  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
    tickRef.current = null;
    autoStopRef.current = null;
  }, []);

  const detachTrackWatch = useCallback(() => {
    const watch = trackWatchRef.current;
    if (watch) watch.track.removeEventListener('ended', watch.onEnded);
    trackWatchRef.current = null;
  }, []);

  const attemptUpload = useCallback(async (pending: PendingUpload) => {
    attemptingRef.current = true;
    setState({ elapsedMs: 0, error: '', status: 'uploading' });
    try {
      if (pending.restartSession) {
        const released = await reportRecordingFailure(
          pending.recordingId,
          'upload_failed',
        );
        if (!released)
          throw new Error(
            'Beacon could not restart the upload. Check your connection and retry.',
          );
        delete pending.uploadUrl;
        delete pending.providerFileId;
        pending.restartSession = false;
      }
      if (!pending.uploadUrl) {
        const session = await request<{ uploadUrl: string }>(
          `/api/recordings/${pending.recordingId}/upload-session`,
          {
            body: JSON.stringify({
              byteSize: pending.blob.size,
              checksumSha256: pending.checksumSha256,
              durationMs: pending.durationMs,
              mimeType: pending.mimeType,
              encryption: {
                dataKey: pending.dataKey,
                iv: pending.encryptionIv,
                version: 1,
              },
            }),
            method: 'POST',
          },
        );
        pending.uploadUrl = session.uploadUrl;
      }
      if (!pending.providerFileId)
        pending.providerFileId = await uploadClipToDrive(
          pending.uploadUrl,
          pending.blob,
        );
      await request(`/api/recordings/${pending.recordingId}/complete`, {
        body: JSON.stringify({ providerFileId: pending.providerFileId }),
        method: 'POST',
      });
      pendingRef.current = null;
      setState({ elapsedMs: 0, error: '', status: 'available' });
    } catch (error) {
      if (
        !pending.uploadUrl ||
        (error instanceof DriveUploadError &&
          (error.kind === 'authorization' || error.kind === 'session_expired'))
      )
        pending.restartSession = true;
      setState({
        elapsedMs: 0,
        error: errorMessage(error, 'Recording could not be uploaded.'),
        status: 'failed',
      });
    } finally {
      attemptingRef.current = false;
    }
  }, []);

  /** Ends a recording whose source can no longer be trusted -- the stream
   * itself ended, not a normal stop. Discards rather than uploads: a clip
   * finalized from a torn-down stream would just be broken. Always
   * surfaces `message` as the failure reason instead of failing quietly. */
  const abort = useCallback(
    (message: string) => {
      const recorder = recorderRef.current;
      const recordingId = recordingIdRef.current;
      if (!recorder) return;
      clearTimers();
      detachTrackWatch();
      recorder.discard();
      recorderRef.current = null;
      recordingIdRef.current = null;
      if (recordingId)
        void reportRecordingFailure(recordingId, 'capture_failed');
      setState({ elapsedMs: 0, error: message, status: 'failed' });
    },
    [clearTimers, detachTrackWatch],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    const recordingId = recordingIdRef.current;
    if (!recorder || !recordingId) return;
    clearTimers();
    detachTrackWatch();
    setState((current) => ({ ...current, status: 'uploading' }));
    void (async () => {
      try {
        const { blob, durationMs } = await recorder.stop();
        const encrypted = await encryptClip(blob);
        const pending: PendingUpload = {
          blob: encrypted.blob,
          checksumSha256: await sha256Hex(encrypted.blob),
          dataKey: encrypted.dataKey,
          durationMs: Math.min(Math.max(durationMs, 1_000), 600_000),
          encryptionIv: encrypted.iv,
          mimeType: recordingContainerType(recorder.mimeType),
          recordingId,
          restartSession: false,
        };
        pendingRef.current = pending;
        await attemptUpload(pending);
      } catch (error) {
        await reportRecordingFailure(recordingId, 'upload_failed');
        setState({
          elapsedMs: 0,
          error: errorMessage(error, 'Recording could not be prepared.'),
          status: 'failed',
        });
      } finally {
        recorderRef.current = null;
        recordingIdRef.current = null;
      }
    })();
  }, [attemptUpload, clearTimers]);

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
          void uploadThumbnail(created.recording.id, stream);
          const recorder = new ClipRecorder(stream, mimeType);
          recorderRef.current = recorder;
          recorder.start();
          const track =
            typeof stream.getVideoTracks === 'function'
              ? stream.getVideoTracks()[0]
              : undefined;
          if (track && typeof track.addEventListener === 'function') {
            const onEnded = () =>
              abort(
                'Recording stopped because the camera stream ended unexpectedly.',
              );
            track.addEventListener('ended', onEnded);
            trackWatchRef.current = { onEnded, track };
          }
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
          const recordingId = recordingIdRef.current;
          if (recordingId)
            await reportRecordingFailure(recordingId, 'capture_failed');
          detachTrackWatch();
          recorderRef.current = null;
          recordingIdRef.current = null;
          setState({
            elapsedMs: 0,
            error: errorMessage(error, 'Recording could not be started.'),
            status: 'failed',
          });
        }
      })();
    },
    [abort, cameraId, detachTrackWatch, state.status, stop],
  );

  const reset = useCallback(() => {
    const pending = pendingRef.current;
    if (pending && !attemptingRef.current) {
      pendingRef.current = null;
      void reportRecordingFailure(pending.recordingId, 'abandoned');
    }
    setState((current) =>
      current.status === 'available' || current.status === 'failed'
        ? { elapsedMs: 0, error: '', status: 'idle' }
        : current,
    );
  }, []);

  const retry = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending || attemptingRef.current) return;
    void attemptUpload(pending);
  }, [attemptUpload]);

  useEffect(
    () => () => {
      clearTimers();
      detachTrackWatch();
      recorderRef.current?.discard();
      const pending = pendingRef.current;
      if (pending && !attemptingRef.current)
        void reportRecordingFailure(pending.recordingId, 'abandoned');
    },
    [clearTimers, detachTrackWatch],
  );

  return {
    abort,
    reset,
    retry,
    start,
    state,
    stop,
    supported: pickRecorderMimeType() !== null,
  };
}
