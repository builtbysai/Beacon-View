import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

beforeEach(() => {
  // Most tests exercise post-splash behavior; the splash itself has its own
  // dedicated test below, which clears this first.
  localStorage.setItem('beacon.splash.seen.v1', 'true');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
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
  it('shows the one-time splash before sign-in, then remembers it was seen', async () => {
    localStorage.removeItem('beacon.splash.seen.v1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: 'Authentication required' }),
        ok: false,
      }),
    );
    const view = render(<App />);

    expect(
      await screen.findByRole('button', { name: 'Get started' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Welcome to Beacon' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(
      await screen.findByRole('heading', { name: 'Welcome to Beacon' }),
    ).toBeVisible();
    expect(localStorage.getItem('beacon.splash.seen.v1')).toBe('true');

    view.unmount();
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Welcome to Beacon' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Get started' }),
    ).not.toBeInTheDocument();
  });

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
        'Camera and microphone capture stays visible on the camera device.',
      ),
    ).toBeVisible();
  });

  it('shows the public trust page without requiring a session', async () => {
    window.history.replaceState({}, '', '/trust');
    vi.stubGlobal('fetch', vi.fn());
    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'Your camera stays under your control.',
      }),
    ).toBeVisible();
    expect(screen.getByText('What Beacon never keeps')).toBeVisible();
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

    expect(await screen.findByText('Add your first camera')).toBeVisible();
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
    expect(document.title).toBe('Cameras · Beacon');
  });

  it('tells a viewer with no camera grants to ask for access, not to add a camera', async () => {
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
                ? {
                    household: { id: 'household-1', role: 'viewer' },
                    user: { id: 'member', email: 'member@example.com' },
                  }
                : url === '/api/cameras'
                  ? { cameras: [] }
                  : { devices: [] },
            ),
        }),
      ),
    );
    render(<App />);
    expect(
      await screen.findByText('No cameras shared with you yet'),
    ).toBeVisible();
    expect(
      screen.getByText(/Ask the household owner or an admin/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Add camera/i }),
    ).not.toBeInTheDocument();
  });

  it("applies a /join link's stashed invitation once signed in, then clears it", async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    window.sessionStorage.setItem('beacon_pending_invite', 'invite-token-abc');
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<unknown>>()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url === '/api/household/invitations/accept') {
          expect(init?.body).toBe(
            JSON.stringify({ token: 'invite-token-abc' }),
          );
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ householdId: 'household-2' }),
          });
        }
        if (url === '/api/account/household')
          return Promise.resolve({
            ok: true,
            status: 204,
            json: () => Promise.resolve({}),
          });
        if (url === '/api/auth/me')
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                household: { id: 'household-2', role: 'viewer' },
                user: { id: 'member', email: 'member@example.com' },
              }),
          });
        if (url === '/api/cameras')
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ cameras: [] }),
          });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ devices: [] }),
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('You joined the household.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/household/invitations/accept',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/household',
      expect.objectContaining({
        body: JSON.stringify({ householdId: 'household-2' }),
        method: 'PUT',
      }),
    );
    expect(window.sessionStorage.getItem('beacon_pending_invite')).toBeNull();
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
    await screen.findByText('Add your first camera');
    act(() => {
      window.history.pushState({}, '', '/trust');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(
      screen.getByRole('heading', {
        name: 'Your camera stays under your control.',
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
      name: 'View live: Hallway phone',
    });
    expect(open).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('heading', { name: 'Your cameras are paused' }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Hallway phone options' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Open live view' }),
    ).toBeDisabled();
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
                deviceId: 'device-1',
                deviceName: 'Android Camera',
                id: 'camera-public-id',
                lastSeenAt: new Date().toISOString(),
                name: 'Rear camera',
                online: true,
                platform: 'android',
                enabled: true,
                streaming: false,
                viewerCount: 0,
                facing: 'rear',
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

    await screen.findByText('Add your first camera');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add camera' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Pair Android' }));
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
                canRemove: true,
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
                canRemove: true,
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

    await screen.findByText('Pixel');
    expect(
      screen.getByRole('button', { name: 'Pixel options' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View live: Pixel' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Camera settings' }));

    expect(screen.getByRole('heading', { name: 'Pixel' })).toBeInTheDocument();
    expect(screen.getByText('Keep this camera ready')).toBeVisible();
    expect(
      screen.getByText('Keep this camera ready').closest('details'),
    ).not.toHaveAttribute('open');
    expect(screen.getByText('Readiness tips')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Back to cameras' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Device privacy' }),
    ).toBeVisible();
    const health = screen.getByLabelText('Device health');
    expect(within(health).getByText('Watching now')).toBeVisible();
    expect(within(health).getByText('2 viewers')).toBeVisible();
    expect(within(health).getByText('82% · charging')).toBeVisible();
    expect(screen.getByText('Rear camera')).toBeVisible();
    expect(window.location.pathname).toBe('/cameras/device-1/settings');
    expect(
      screen.queryByRole('button', { name: 'Disable device' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Restart device session' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Revoke device' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText(/Capabilities:/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove camera' }));
    expect(
      await screen.findByRole('heading', { name: 'Permanently delete Pixel?' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('heading', { name: 'Permanently delete Pixel?' }),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  it('renames and removes a camera from the Cameras grid', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    let cameras = [
      {
        canRemove: true,
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
        viewerCount: 0,
      },
    ];
    let devices = [
      {
        canRemove: true,
        deviceType: 'phone',
        enabled: true,
        id: 'device-1',
        lastSeenAt: new Date().toISOString(),
        name: 'Pixel',
        online: true,
        platform: 'android',
        revoked: false,
      },
    ];
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url === '/api/auth/me') {
          return Promise.resolve({
            json: () =>
              Promise.resolve({
                user: { email: 'owner@example.com', id: 'owner' },
              }),
            ok: true,
            status: 200,
          });
        }
        if (url === '/api/devices' && (!init || init.method === undefined)) {
          return Promise.resolve({
            json: () => Promise.resolve({ devices }),
            ok: true,
            status: 200,
          });
        }
        if (url === '/api/devices/device-1' && init?.method === 'PATCH') {
          devices = [{ ...devices[0]!, name: 'Kitchen Pixel' }];
          cameras = cameras.map((camera) =>
            camera.deviceId === 'device-1'
              ? { ...camera, deviceName: 'Kitchen Pixel' }
              : camera,
          );
          return Promise.resolve({
            json: () => Promise.resolve(undefined),
            ok: true,
            status: 204,
          });
        }
        if (url === '/api/devices/device-1' && init?.method === 'DELETE') {
          devices = [];
          cameras = [];
          return Promise.resolve({
            json: () => Promise.resolve(undefined),
            ok: true,
            status: 204,
          });
        }
        if (url === '/api/cameras') {
          return Promise.resolve({
            json: () => Promise.resolve({ cameras }),
            ok: true,
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cameras' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pixel options' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename Pixel' });
    fireEvent.change(input, { target: { value: 'Kitchen Pixel' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Kitchen Pixel');

    fireEvent.click(
      screen.getByRole('button', { name: 'Kitchen Pixel options' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove camera' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Permanently delete Kitchen Pixel?',
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Delete device' }));
    expect(await screen.findByText('No cameras yet.')).toBeVisible();
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
    await screen.findByText('Add your first camera');
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('Motion detected')).toBeVisible();
    expect(screen.getByText('Hallway phone')).toBeVisible();
    fireEvent.click(screen.getByText('Detection details'));
    expect(screen.getByText('42% motion intensity')).toBeVisible();
    expect(screen.getByText(/never an image or recording/i)).toBeVisible();
    // The household currently has no paired cameras (these events are
    // historical), so there is nothing to build a camera picker from.
    expect(
      screen.queryByLabelText('Filter motion events by camera'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter motion events by time')).toBeVisible();
    await act(async () => {
      TestSocket.instance?.emit({
        cameraId: 'camera-2',
        type: 'motion-event-created',
      });
      await Promise.resolve();
    });
    expect(await screen.findByText('Kitchen phone')).toBeVisible();
    expect(screen.queryByText('Hallway phone')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('beacon_motion_filters_1:time')).toBe(
      'day',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear motion history' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear history' }),
    );
    expect(await screen.findByText('No activity yet.')).toBeVisible();
  });

  it('returns to Events, not Cameras, when Back is pressed after opening a camera from a motion event', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          json: () =>
            Promise.resolve(
              url === '/api/auth/me'
                ? { user: { email: 'owner@example.com', id: '1' } }
                : url === '/api/devices'
                  ? { devices: [] }
                  : url === '/api/drive/status'
                    ? { recordingsConnected: false }
                    : url.startsWith('/api/motion-events')
                      ? {
                          events: [
                            {
                              cameraId: 'camera-1',
                              cameraName: 'Rear camera',
                              confidence: 0.5,
                              deviceName: 'Hallway phone',
                              id: 'event-1',
                              occurredAt: new Date().toISOString(),
                            },
                          ],
                          nextCursor: null,
                        }
                      : {
                          cameras: [
                            {
                              credentialRevoked: false,
                              deviceId: 'phone-1',
                              deviceName: 'Hallway phone',
                              enabled: true,
                              id: 'camera-1',
                              lastSeenAt: null,
                              name: 'Rear camera',
                              online: true,
                              privacyMode: false,
                              streaming: false,
                              viewerCount: 0,
                            },
                          ],
                        },
            ),
          ok: true,
          status: 200,
        }),
      ),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open camera: Hallway phone, Rear camera',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Hallway phone' }),
    ).toBeVisible();
    expect(window.location.pathname).toBe('/cameras/camera-1');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(
      await screen.findByRole('heading', { name: 'Activity' }),
    ).toBeVisible();
    expect(await screen.findByText('Motion detected')).toBeVisible();
    expect(window.location.pathname).toBe('/events');
  });

  it('tracks the active Settings section in the URL so browser back steps between them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          json: () =>
            Promise.resolve(
              url === '/api/auth/me'
                ? { user: { email: 'owner@example.com', id: '1' } }
                : url === '/api/devices'
                  ? { devices: [] }
                  : url === '/api/account/households'
                    ? { households: [] }
                    : { cameras: [] },
            ),
          ok: true,
          status: 200,
        }),
      ),
    );
    render(<App />);
    await screen.findByText('Add your first camera');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      await screen.findByText('The household this account belongs to.'),
    ).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe(
      '/settings',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(
      await screen.findByText(
        'Sign-in methods, verification, and account deletion.',
      ),
    ).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe(
      '/settings?section=account',
    );

    window.history.back();
    expect(
      await screen.findByText('The household this account belongs to.'),
    ).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe(
      '/settings',
    );
  });
});
