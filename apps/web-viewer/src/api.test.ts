import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('API request headers', () => {
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
