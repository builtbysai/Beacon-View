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
