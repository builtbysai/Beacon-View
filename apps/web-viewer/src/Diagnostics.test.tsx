import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Diagnostics } from './Diagnostics';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Diagnostics', () => {
  it('renders devices and camera sessions once loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            cameras: [
              {
                cameraId: 'camera-1',
                captureState: 'live',
                facing: 'rear',
                viewerConnectionIds: ['conn-1'],
                viewerCount: 1,
              },
            ],
            devices: [
              {
                connectionState: 'online',
                deviceId: 'device-1',
                lastHeartbeatAt: null,
                platform: 'android',
              },
            ],
          }),
      }),
    );
    render(<Diagnostics />);
    expect(await screen.findByText('android')).toBeVisible();
    expect(screen.getByText('Capture: live')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error instead of loading forever when diagnostics fail to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: 'unavailable' }),
      }),
    );
    render(<Diagnostics />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connection diagnostics are temporarily unavailable.',
    );
    expect(
      screen.queryByText('Loading sanitized connection diagnostics...'),
    ).not.toBeInTheDocument();
  });
});
