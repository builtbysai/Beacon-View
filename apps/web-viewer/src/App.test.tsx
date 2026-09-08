import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

    expect(
      await screen.findByRole('heading', { name: 'Welcome to Beacon' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute('href', '/api/auth/google');
    expect(
      screen.getByText(
        'Camera and microphone capture stay visible on your Android device.',
      ),
    ).toBeVisible();
  });

  it('shows the public trust page without requiring a session', async () => {
    window.history.replaceState({}, '', '/trust');
    vi.stubGlobal('fetch', vi.fn());
    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'Your camera should stay under your control.',
      }),
    ).toBeVisible();
    expect(screen.getByText('No cloud recordings')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Return to Beacon' }),
    ).toHaveAttribute('href', '/');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a one-time pairing link public and readable without an account session', async () => {
    window.history.replaceState({}, '', '/pair?code=ABCD234567');
    vi.stubGlobal('fetch', vi.fn());
    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'Open this link on your camera phone.',
      }),
    ).toBeVisible();
    expect(screen.getByLabelText('Pairing code ABCD234567')).toHaveTextContent(
      'ABCD234567',
    );
    expect(fetch).not.toHaveBeenCalled();
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
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Skip to content' }),
    ).toHaveAttribute('href', '#main-content');
    fireEvent.click(screen.getByRole('button', { name: 'Cameras' }));
    expect(screen.getByRole('heading', { name: 'Cameras' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cameras' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(document.title).toBe('Cameras · Beacon SecureView');
  });

  it('keeps trust readable when reached with an active household session', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              url === '/api/auth/me'
                ? { user: { id: 'owner', email: 'owner@example.com' } }
                : url === '/api/cameras'
                  ? { cameras: [] }
                  : { devices: [] },
            ),
        }),
      ),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Home' });
    act(() => {
      window.history.pushState({}, '', '/trust');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(
      screen.getByRole('heading', {
        name: 'Your camera should stay under your control.',
      }),
    ).toBeVisible();
    expect(screen.queryByText('Welcome to Beacon')).not.toBeInTheDocument();
  });

  it('prevents duplicate password submissions and recovers after an error', async () => {
    let failLogin!: (value: unknown) => void;
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      url === '/api/auth/me'
        ? Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ error: 'Authentication required' }),
          })
        : new Promise((resolve) => {
            failLogin = resolve;
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('form', { name: 'Password sign in' });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'test-password-only' },
    });
    const form = screen.getByRole('form', { name: 'Password sign in' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter((call) => call[0] === '/api/auth/login'),
    ).toHaveLength(1);
    act(() =>
      failLogin({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid credentials',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('explains privacy and blocks camera-card activation even when stale presence is online', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              url === '/api/auth/me'
                ? { user: { id: 'owner', email: 'owner@example.com' } }
                : url === '/api/devices'
                  ? { devices: [] }
                  : {
                      cameras: [
                        {
                          id: 'private-camera',
                          deviceId: 'phone',
                          deviceName: 'Hallway phone',
                          name: 'Rear camera',
                          online: true,
                          enabled: true,
                          credentialRevoked: false,
                          privacyMode: true,
                          streaming: true,
                          viewerCount: 0,
                          lastSeenAt: null,
                        },
                      ],
                    },
            ),
        }),
      ),
    );
    render(<App />);
    const open = await screen.findByRole('button', {
      name: 'View live: Rear camera, Hallway phone',
    });
    expect(open).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('heading', { name: 'Your cameras are paused' }),
    ).toBeVisible();
    expect(screen.getByText(/Live viewing is blocked/)).toBeVisible();
    fireEvent.click(open);
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText('Connecting to camera')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Add camera' })[0]!);
    fireEvent.click(
      screen.getByRole('button', { name: 'Pair Android device' }),
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
                batteryCharging: true,
                batteryPercent: 82,
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
    expect(screen.getByText('Camera details')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View live: Rear camera, Pixel' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage devices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open device' }));

    expect(screen.getByRole('heading', { name: 'Pixel' })).toBeInTheDocument();
    const health = screen.getByLabelText('Device health');
    expect(within(health).getByText('Watching now')).toBeVisible();
    expect(within(health).getByText('2 viewers')).toBeVisible();
    expect(within(health).getByText('82% · charging')).toBeVisible();
    expect(screen.getByText('Rear camera')).toBeVisible();
    expect(window.location.pathname).toBe('/devices/device-1');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(
      screen.queryByRole('button', { name: 'Disable device' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Restart device session' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Revoke device' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Device settings'));
    expect(screen.getByText(/Capabilities:/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove device' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('Permanently delete Pixel?'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      screen.getByRole('button', { name: 'Turn privacy on' }),
    ).toBeVisible();
  });

  it('shows privacy-preserving motion metadata in the Events page', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal(
      'fetch',
      vi
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
          json: () =>
            Promise.resolve({
              events: [
                {
                  cameraId: 'camera-1',
                  cameraName: 'Rear camera',
                  confidence: 0.42,
                  deviceName: 'Hallway phone',
                  id: 'event-1',
                  occurredAt: new Date(Date.now() - 60_000).toISOString(),
                },
              ],
            }),
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              events: [
                {
                  cameraId: 'camera-2',
                  cameraName: 'Front camera',
                  confidence: 0.55,
                  deviceName: 'Kitchen phone',
                  id: 'event-2',
                  occurredAt: new Date().toISOString(),
                },
              ],
            }),
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({}),
          ok: true,
          status: 204,
        }),
    );
    render(<App />);
    await screen.findByText('No cameras are paired with this household.');
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('Motion detected')).toBeVisible();
    expect(screen.getByText('Hallway phone')).toBeVisible();
    fireEvent.click(screen.getByText('Detection details'));
    expect(screen.getByText('42% scene change')).toBeVisible();
    expect(screen.getByText(/never an image or recording/i)).toBeVisible();
    expect(
      screen.getByLabelText('Filter motion events by camera'),
    ).toBeVisible();
    await act(async () => {
      TestSocket.instance?.emit({
        cameraId: 'camera-2',
        type: 'motion-event-created',
      });
      await Promise.resolve();
    });
    fireEvent.click(
      screen.getByRole('button', { name: /New activity available/ }),
    );
    expect(await screen.findByText('Kitchen phone')).toBeVisible();
    expect(screen.queryByText('Hallway phone')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('beacon_motion_filters_1:time')).toBe(
      'day',
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear motion history' }),
    );
    expect(
      await screen.findByText('No activity matches these filters.'),
    ).toBeVisible();
  });
});
