import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CAST_NAMESPACE, useCastToTv } from './cast-sender';

const token = 'T'.repeat(43);
const sendMessage = vi.fn().mockResolvedValue(undefined);
const endSession = vi.fn();
let requestSession = vi.fn();
let listeners: ((event: unknown) => void)[] = [];

function installFakeCast(): void {
  const session = { endSession, sendMessage };
  const context = {
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      listeners.push(listener),
    getCurrentSession: () => session,
    removeEventListener: (
      _type: string,
      listener: (event: unknown) => void,
    ) => {
      listeners = listeners.filter((item) => item !== listener);
    },
    requestSession: () => requestSession() as Promise<string | undefined>,
    setOptions: vi.fn(),
  };
  Object.assign(window, {
    cast: {
      framework: {
        CastContext: { getInstance: () => context },
        CastContextEventType: { SESSION_STATE_CHANGED: 'sessionstatechanged' },
        SessionState: { SESSION_ENDED: 'SESSION_ENDED' },
      },
    },
    chrome: { cast: { AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' } } },
  });
}

function respond(body: unknown, status = 200) {
  return {
    json: () => Promise.resolve(body),
    ok: status < 400,
    status,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listeners = [];
  sendMessage.mockClear();
  endSession.mockClear();
  requestSession = vi.fn().mockResolvedValue(undefined);
  installFakeCast();
  // The framework is already "loaded": skip the script tag.
  vi.spyOn(document.head, 'append').mockImplementation(((
    script: HTMLScriptElement,
  ) => {
    queueMicrotask(() =>
      (
        window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }
      ).__onGCastApiAvailable(true),
    );
    return script;
  }) as never);
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 Chrome/130.0 Safari/537.36',
  });
  fetchMock = vi.fn((url: string, init?: { method?: string }) => {
    if (url === '/api/cast-config')
      return Promise.resolve(respond({ appId: '0A1B2C3D' }));
    if (url === '/api/household/guest-links' && init?.method === 'POST')
      return Promise.resolve(respond({ id: 'link-1', token }, 201));
    if (url.startsWith('/api/household/guest-links/'))
      return Promise.resolve(respond(null, 204));
    return Promise.resolve(respond({}, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { cast?: unknown }).cast;
});

describe('useCastToTv', () => {
  it('stays hidden when no Cast application is configured', async () => {
    fetchMock.mockReturnValue(Promise.resolve(respond({ appId: null })));
    const { result } = renderHook(() => useCastToTv('camera-1', true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.available).toBe(false);
  });

  it('asks nothing of the server for people who cannot cast', () => {
    renderHook(() => useCastToTv('camera-1', false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a short-lived view-only link for one camera and sends it to the TV', async () => {
    const { result } = renderHook(() => useCastToTv('camera-1', true));
    await waitFor(() => expect(result.current.available).toBe(true));

    await act(async () => result.current.start());

    const created = fetchMock.mock.calls.find(
      ([url]) => url === '/api/household/guest-links',
    )!;
    expect(JSON.parse((created[1] as { body: string }).body)).toEqual({
      cameraIds: ['camera-1'],
      expiresInHours: 4,
      label: 'Cast to TV',
    });
    expect(sendMessage).toHaveBeenCalledWith(CAST_NAMESPACE, {
      path: `/g/${token}?cast=1`,
      type: 'watch',
    });
    expect(result.current.casting).toBe(true);
  });

  it('does not create a link when the device picker is dismissed', async () => {
    requestSession.mockResolvedValue('cancel');
    const { result } = renderHook(() => useCastToTv('camera-1', true));
    await waitFor(() => expect(result.current.available).toBe(true));
    await act(async () => result.current.start());
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === '/api/household/guest-links',
      ),
    ).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.casting).toBe(false);
  });

  it('revokes the link and ends the session when stopped', async () => {
    const { result } = renderHook(() => useCastToTv('camera-1', true));
    await waitFor(() => expect(result.current.available).toBe(true));
    await act(async () => result.current.start());
    await act(async () => result.current.stop());
    expect(endSession).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/household/guest-links/link-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(result.current.casting).toBe(false);
  });

  it('revokes the link when the TV session ends by itself', async () => {
    const { result } = renderHook(() => useCastToTv('camera-1', true));
    await waitFor(() => expect(result.current.available).toBe(true));
    await act(async () => result.current.start());
    act(() => {
      for (const listener of listeners)
        listener({ sessionState: 'SESSION_ENDED' });
    });
    await waitFor(() => expect(result.current.casting).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/household/guest-links/link-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('revokes the link when the person leaves the camera', async () => {
    const { result, unmount } = renderHook(() => useCastToTv('camera-1', true));
    await waitFor(() => expect(result.current.available).toBe(true));
    await act(async () => result.current.start());
    unmount();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/household/guest-links/link-1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
