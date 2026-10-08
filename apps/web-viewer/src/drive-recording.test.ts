import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DRIVE_CONNECT_MESSAGE,
  DRIVE_CONNECT_URL,
  driveRecordingState,
  finishDriveConnectPopup,
  useDriveRecording,
} from './drive-recording';

function statusResponse(body: object) {
  return {
    json: () => Promise.resolve(body),
    ok: true,
    status: 200,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Drive readiness for recordings', () => {
  it('reads the status the server reports', () => {
    expect(
      driveRecordingState({ configured: true, recordingsConnected: true }),
    ).toBe('ready');
    expect(
      driveRecordingState({
        configured: true,
        expired: true,
        recordingsConnected: false,
      }),
    ).toBe('expired');
    expect(
      driveRecordingState({ configured: true, recordingsConnected: false }),
    ).toBe('not_connected');
    expect(
      driveRecordingState({ configured: false, recordingsConnected: false }),
    ).toBe('unavailable');
  });

  it('connects in a small window and notices when Drive is ready', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        statusResponse({
          configured: true,
          expired: true,
          recordingsConnected: false,
        }),
      )
      .mockResolvedValue(
        statusResponse({ configured: true, recordingsConnected: true }),
      );
    vi.stubGlobal('fetch', fetch);
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { result } = renderHook(() => useDriveRecording(true));
    await waitFor(() => expect(result.current.state).toBe('expired'));

    act(() => result.current.connect());
    expect(open).toHaveBeenCalledWith(
      DRIVE_CONNECT_URL,
      'beacon-drive-connect',
      expect.stringContaining('popup'),
    );
    expect(result.current.connecting).toBe(true);

    // The popup reports success; the page re-checks at once.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { result: 'connected', type: DRIVE_CONNECT_MESSAGE },
          origin: window.location.origin,
        }),
      );
    });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.connecting).toBe(false);
  });

  it('explains a blocked pop-up instead of doing nothing', () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          statusResponse({ configured: true, recordingsConnected: false }),
        ),
    );
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useDriveRecording(true));
    act(() => result.current.connect());
    expect(result.current.connecting).toBe(false);
    expect(result.current.connectError).toMatch(/blocked/i);
  });

  it('reports a declined consent', () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          statusResponse({ configured: true, recordingsConnected: false }),
        ),
    );
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { result } = renderHook(() => useDriveRecording(true));
    act(() => result.current.connect());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { result: 'denied', type: DRIVE_CONNECT_MESSAGE },
          origin: window.location.origin,
        }),
      );
    });
    expect(result.current.connecting).toBe(false);
    expect(result.current.connectError).toMatch(/wasn’t granted/i);
  });

  it('ignores messages from other sites', () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          statusResponse({ configured: true, recordingsConnected: false }),
        ),
    );
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { result } = renderHook(() => useDriveRecording(true));
    act(() => result.current.connect());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { result: 'denied', type: DRIVE_CONNECT_MESSAGE },
          origin: 'https://evil.example',
        }),
      );
    });
    expect(result.current.connecting).toBe(true);
    expect(result.current.connectError).toBe('');
  });

  it('closes the consent popup after telling the page that opened it', () => {
    const postMessage = vi.fn();
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: { postMessage },
    });
    window.history.replaceState(
      {},
      '',
      '/settings?section=storage&drive=connected',
    );
    expect(finishDriveConnectPopup()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { result: 'connected', type: DRIVE_CONNECT_MESSAGE },
      window.location.origin,
    );
    expect(close).toHaveBeenCalled();
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: null,
    });
  });
});
