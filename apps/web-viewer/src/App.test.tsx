import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

class TestSocket {
  static instance: TestSocket | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor() {
    TestSocket.instance = this;
  }

  close() {}

  emit(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

describe('App', () => {
  it('shows the authentication form when no session exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: 'Authentication required' }),
        ok: false,
      }),
    );
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible(),
    );
    expect(
      screen.getByRole('heading', { name: 'Beacon SecureView' }),
    ).toBeInTheDocument();
  });

  it('shows the empty camera state for an authenticated household', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              user: { email: 'owner@example.com', id: '1' },
            }),
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ cameras: [] }),
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ devices: [] }),
          ok: true,
          status: 200,
        }),
    );
    render(<App />);

    expect(
      await screen.findByText('No cameras are paired with this household.'),
    ).toBeVisible();
  });

  it('completes pairing, closes the wizard, and highlights the new camera', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({ user: { email: 'owner@example.com', id: '1' } }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ cameras: [] }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ devices: [] }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ code: 'ABCD2345' }),
        ok: true,
        status: 201,
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            cameras: [
              {
                credentialRevoked: false,
                id: 'camera-public-id',
                lastSeenAt: new Date().toISOString(),
                name: 'Android Camera',
                online: true,
              },
            ],
          }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ devices: [] }),
        ok: true,
        status: 200,
      });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    await screen.findByText('No cameras are paired with this household.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Pair Android device' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create pairing code' }),
    );
    expect(await screen.findByText('ABCD2345')).toBeVisible();
    vi.useFakeTimers();
    await act(async () => {
      TestSocket.instance?.emit({
        cameraId: 'camera-public-id',
        pairingState: 'completed',
        type: 'camera-paired',
      });
      await Promise.resolve();
    });
    expect(screen.getByText('Camera connected')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(screen.getByText('Android Camera')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('opens a device detail with its child camera sources', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            user: { email: 'owner@example.com', id: 'owner' },
          }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            cameras: [
              {
                credentialRevoked: false,
                deviceId: 'device-1',
                deviceName: 'Pixel',
                enabled: true,
                facing: 'rear',
                id: 'rear-camera',
                lastSeenAt: new Date().toISOString(),
                name: 'Rear camera',
                online: true,
                platform: 'android',
                streaming: false,
                viewerCount: 2,
              },
            ],
          }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            devices: [
              {
                deviceType: 'phone',
                enabled: true,
                id: 'device-1',
                lastSeenAt: new Date().toISOString(),
                name: 'Pixel',
                online: true,
                platform: 'android',
                revoked: false,
                softwareVersion: '0.0.0',
              },
            ],
          }),
        ok: true,
        status: 200,
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByText('Rear camera');
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open device' }));

    expect(screen.getByRole('heading', { name: 'Pixel' })).toBeInTheDocument();
    expect(screen.getByText(/Total viewers: 2/)).toBeVisible();
    expect(screen.getByText('Rear camera')).toBeVisible();
    expect(window.location.pathname).toBe('/devices/device-1');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete device' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('Permanently delete Pixel?'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
