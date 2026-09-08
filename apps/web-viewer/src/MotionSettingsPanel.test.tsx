import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MotionSettingsPanel } from './MotionSettingsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = 'beacon_csrf=; Max-Age=0; path=/';
});

const rear = {
  cameraId: 'rear-camera',
  enabled: true,
  sensitivity: 'medium' as const,
  cooldownSeconds: 30 as const,
  quietHours: null,
};
const front = {
  cameraId: 'front-camera',
  enabled: true,
  sensitivity: 'low' as const,
  cooldownSeconds: 60 as const,
  quietHours: null,
};
const cameras = [
  { id: rear.cameraId, name: 'Rear camera' },
  { id: front.cameraId, name: 'Front camera' },
];
const response = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: () => Promise.resolve(body),
});

describe('MotionSettingsPanel', () => {
  it('loads only when opened, chooses a camera, and saves an explicit per-camera change', async () => {
    document.cookie = 'beacon_csrf=test-csrf; path=/';
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ cameras: [rear, front] }))
      .mockResolvedValueOnce(
        response({
          settings: {
            ...front,
            enabled: false,
            sensitivity: 'high',
            cooldownSeconds: 120,
          },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    render(<MotionSettingsPanel deviceId="phone-1" cameras={cameras} />);

    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Motion settings'));
    await screen.findByRole('form', { name: 'Camera motion settings' });
    expect(fetch.mock.calls[0]![0]).toBe(
      '/api/devices/phone-1/motion-settings',
    );
    fireEvent.change(screen.getByLabelText('Motion settings camera'), {
      target: { value: front.cameraId },
    });
    fireEvent.click(screen.getByLabelText('Detect motion on this camera'));
    fireEvent.change(screen.getByLabelText('Sensitivity'), {
      target: { value: 'high' },
    });
    fireEvent.change(screen.getByLabelText('Time between events'), {
      target: { value: '120' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save motion settings' }),
    );

    await screen.findByText(
      'Saved. Your phone applies the settings on its next connection check.',
    );
    expect(fetch.mock.calls[1]![0]).toBe(
      '/api/cameras/front-camera/motion-settings',
    );
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({
        enabled: false,
        sensitivity: 'high',
        cooldownSeconds: 120,
        quietHours: null,
      }),
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'test-csrf',
      },
    });
  });

  it('keeps edits after a failed save and lets the owner retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ cameras: [rear] }))
      .mockResolvedValueOnce(response({ error: 'offline' }, false))
      .mockResolvedValueOnce(
        response({ settings: { ...rear, sensitivity: 'high' } }),
      );
    vi.stubGlobal('fetch', fetch);
    render(<MotionSettingsPanel deviceId="phone-1" cameras={cameras} />);
    fireEvent.click(screen.getByText('Motion settings'));
    await screen.findByRole('form', { name: 'Camera motion settings' });
    fireEvent.change(screen.getByLabelText('Sensitivity'), {
      target: { value: 'high' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save motion settings' }),
    );
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Sensitivity')).toHaveValue('high');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save motion settings' }),
    );
    await screen.findByText(
      'Saved. Your phone applies the settings on its next connection check.',
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('offers a retry when the settings list cannot be loaded', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response({ cameras: [rear] }));
    vi.stubGlobal('fetch', fetch);
    render(<MotionSettingsPanel deviceId="phone-1" cameras={cameras} />);
    fireEvent.click(screen.getByText('Motion settings'));
    await screen.findByRole('alert');
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry motion settings' }),
    );
    await screen.findByRole('form', { name: 'Camera motion settings' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('disables sensitivity and cooldown while detection is off and ignores a stale device response', async () => {
    let resolveFirst!: (value: ReturnType<typeof response>) => void;
    const fetch = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<ReturnType<typeof response>>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(
        response({ cameras: [{ ...rear, enabled: false }] }),
      );
    vi.stubGlobal('fetch', fetch);
    const view = render(
      <MotionSettingsPanel deviceId="old-phone" cameras={cameras} />,
    );
    fireEvent.click(screen.getByText('Motion settings'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender(
      <MotionSettingsPanel deviceId="new-phone" cameras={cameras} />,
    );
    await screen.findByRole('form', { name: 'Camera motion settings' });
    expect(screen.getByLabelText('Sensitivity')).toBeDisabled();
    expect(screen.getByLabelText('Time between events')).toBeDisabled();
    resolveFirst(response({ cameras: [front] }));
    await waitFor(() =>
      expect(screen.getByLabelText('Motion settings camera')).toHaveValue(
        rear.cameraId,
      ),
    );
    const firstRequest = fetch.mock.calls[0]![1] as RequestInit;
    expect(firstRequest.signal?.aborted).toBe(true);
  });
});
