import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request, SESSION_ENDED_EVENT } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('API request headers', () => {
  it('does not reuse cached authenticated reads', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ configured: true }),
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', fetch);

    await request('/api/drive/status');

    expect(fetch).toHaveBeenCalledWith(
      '/api/drive/status',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('does not label an empty DELETE as JSON', async () => {
    document.cookie = 'beacon_csrf=test-csrf; path=/';
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetch);

    await request('/api/devices/device-id', { method: 'DELETE' });

    expect(fetch).toHaveBeenCalledWith(
      '/api/devices/device-id',
      expect.objectContaining({
        headers: { 'x-csrf-token': 'test-csrf' },
        method: 'DELETE',
      }),
    );
  });

  it('labels requests with JSON bodies correctly', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetch);

    await request('/api/cameras/camera-id/activate', {
      body: '{}',
      method: 'POST',
    });

    const options = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(options?.headers).get('content-type')).toBe(
      'application/json',
    );
  });
});

describe('API errors', () => {
  it('keeps the server code, message, and request ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            code: 'drive_reconnect_required',
            error: 'Reconnect Google Drive.',
            requestId: 'req-1',
          }),
        ok: false,
        status: 409,
      }),
    );
    await expect(request('/api/recordings')).rejects.toMatchObject({
      code: 'drive_reconnect_required',
      message: 'Reconnect Google Drive.',
      requestId: 'req-1',
      status: 409,
    });
  });

  it('explains an unreachable server instead of "Failed to fetch"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const error = (await request('/api/cameras').catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'network', network: true, status: 0 });
    expect(error.message).toMatch(/can’t reach beacon/i);
  });

  it('passes a caller’s own cancellation through untouched', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(
      request('/api/cameras', { signal: controller.signal }),
    ).rejects.toBe(abort);
  });

  it('gives a plain message when the server sent none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.reject(new SyntaxError('not json')),
        ok: false,
        status: 502,
      }),
    );
    const error = (await request('/api/cameras').catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/having trouble/i);
  });

  it('announces a lapsed session once, but not a wrong password', async () => {
    const ended = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              code: 'session_required',
              error: 'Authentication required',
            }),
          ok: false,
          status: 401,
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ error: 'Invalid email or password' }),
          ok: false,
          status: 401,
        }),
    );
    await request('/api/cameras').catch(() => undefined);
    await request('/api/auth/login', { method: 'POST' }).catch(() => undefined);
    window.removeEventListener(SESSION_ENDED_EVENT, ended);
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
