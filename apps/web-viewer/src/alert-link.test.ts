import { afterEach, describe, expect, it, vi } from 'vitest';

import { alertDestination, resolveAlert, takeAlertId } from './alert-link';

const ID = '3f1c2b4e-5d6a-4b7c-8d9e-0a1b2c3d4e5f';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('opening an alert', () => {
  it('reads the alert ID and removes it from the address', () => {
    window.history.replaceState({}, '', `/activity?alert=${ID}&view=clips#top`);
    expect(takeAlertId()).toBe(ID);
    expect(window.location.search).toBe('?view=clips');
    expect(window.location.hash).toBe('#top');
  });

  it('ignores a malformed ID but still cleans the address', () => {
    window.history.replaceState({}, '', '/activity?alert=../../etc/passwd');
    expect(takeAlertId()).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('returns null when there is no alert', () => {
    window.history.replaceState({}, '', '/activity');
    expect(takeAlertId()).toBeNull();
  });

  it('asks the server which camera an alert was about', async () => {
    const fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ cameraId: 'cam-1', category: 'motion' }),
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', fetch);
    expect(await resolveAlert(ID)).toEqual({
      cameraId: 'cam-1',
      category: 'motion',
    });
    expect(fetch).toHaveBeenCalledWith(
      `/api/notification-events/${ID}`,
      expect.anything(),
    );
  });

  it('treats an expired or foreign alert as unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: 'Alert unavailable' }),
        ok: false,
        status: 404,
      }),
    );
    expect(await resolveAlert(ID)).toBeNull();
  });

  it('opens the camera when it is visible, otherwise Activity', () => {
    const target = { cameraId: 'cam-1', category: 'motion' };
    expect(alertDestination(target, ['cam-0', 'cam-1'])).toEqual({
      cameraId: 'cam-1',
    });
    expect(alertDestination(target, ['cam-0'])).toBe('activity');
    expect(
      alertDestination({ cameraId: null, category: 'security' }, ['cam-1']),
    ).toBe('activity');
    expect(alertDestination(null, ['cam-1'])).toBe('activity');
  });
});
