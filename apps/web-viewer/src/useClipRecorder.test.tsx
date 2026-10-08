import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useClipRecorder } from './useClipRecorder';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  request: mocks.request,
}));

vi.mock('./recording-capture', () => ({
  ClipRecorder: class ClipRecorder {
    mimeType = 'video/webm';
    start = vi.fn();
    stop = vi.fn().mockResolvedValue({
      blob: new Blob(['clip']),
      durationMs: 2_000,
    });
    discard = vi.fn();
  },
  DriveUploadError: class DriveUploadError extends Error {
    kind = 'temporary';
  },
  MAX_CLIP_DURATION_MS: 600_000,
  encryptClip: vi.fn().mockResolvedValue({
    blob: new Blob(['encrypted']),
    dataKey: 'data-key',
    iv: 'encryption-iv',
  }),
  pickRecorderMimeType: vi.fn().mockReturnValue('video/webm'),
  recordingContainerType: vi.fn().mockReturnValue('video/webm'),
  sha256Hex: vi.fn().mockResolvedValue('a'.repeat(64)),
  uploadClipToDrive: mocks.upload,
}));

afterEach(() => {
  vi.clearAllMocks();
});

it('retries a failed Drive upload without recording the clip again', async () => {
  mocks.request
    .mockResolvedValueOnce({ recording: { id: 'recording-1' } })
    .mockResolvedValueOnce({ uploadUrl: 'https://drive.example/upload' })
    .mockResolvedValueOnce(undefined);
  mocks.upload
    .mockRejectedValueOnce(new Error('Drive temporarily unavailable'))
    .mockResolvedValueOnce('provider-file-1');
  const { result } = renderHook(() => useClipRecorder('camera-1'));

  act(() => result.current.start({} as MediaStream));
  await waitFor(() => expect(result.current.state.status).toBe('recording'));
  act(() => result.current.stop());
  await waitFor(() => expect(result.current.state.status).toBe('failed'));

  act(() => result.current.retry());
  await waitFor(() => expect(result.current.state.status).toBe('available'));

  expect(mocks.upload).toHaveBeenCalledTimes(2);
  expect(mocks.request).toHaveBeenLastCalledWith(
    '/api/recordings/recording-1/complete',
    expect.objectContaining({ method: 'POST' }),
  );
  expect(
    mocks.request.mock.calls.filter(
      ([path]) => path === '/api/recordings/recording-1/upload-session',
    ),
  ).toHaveLength(1);
});

/** A minimal fake MediaStreamTrack/MediaStream good enough to exercise the
 * 'ended' watcher without a real getUserMedia/RTCPeerConnection stream. */
function fakeStreamWithTrack() {
  const listeners = new Map<string, () => void>();
  const track = {
    addEventListener: vi.fn((type: string, handler: () => void) => {
      listeners.set(type, handler);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
  };
  return {
    stream: { getVideoTracks: () => [track] } as unknown as MediaStream,
    track,
    fireEnded: () => listeners.get('ended')?.(),
  };
}

it('aborts (without uploading) when the source stream ends unexpectedly', async () => {
  mocks.request.mockResolvedValueOnce({ recording: { id: 'recording-2' } });
  mocks.request.mockResolvedValueOnce(undefined); // best-effort /fail report
  const { result } = renderHook(() => useClipRecorder('camera-1'));
  const { stream, fireEnded } = fakeStreamWithTrack();

  act(() => result.current.start(stream));
  await waitFor(() => expect(result.current.state.status).toBe('recording'));

  act(() => fireEnded());

  expect(result.current.state.status).toBe('failed');
  expect(result.current.state.error).toMatch(/stream ended/i);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/recordings/recording-2/fail',
    expect.objectContaining({
      body: JSON.stringify({ reason: 'capture_failed' }),
    }),
  );
  // A second 'ended' after the stream is already discarded is a no-op --
  // nothing left to abort twice.
  mocks.request.mockClear();
  act(() => fireEnded());
  expect(mocks.request).not.toHaveBeenCalled();
});
