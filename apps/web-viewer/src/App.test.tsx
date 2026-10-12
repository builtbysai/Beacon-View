import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  it('offers a retry instead of “Add your first device” when cameras fail to load', async () => {
    localStorage.setItem('beacon.splash.seen.v1', 'true');
    let camerasFail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        const body =
          path === '/api/auth/me'
            ? {
                household: { id: 'h', role: 'owner' },
                user: { email: 'owner@example.com', id: 'u' },
              }
            : path === '/api/cameras'
              ? camerasFail
                ? {
                    error:
                      'Something went wrong on Beacon’s side. Try again in a moment.',
                  }
                : { cameras: [] }
              : path === '/api/devices'
                ? { devices: [] }
                : {};
        const failed = path === '/api/cameras' && camerasFail;
        return Promise.resolve({
          json: () => Promise.resolve(body),
          ok: !failed,
          status: failed ? 500 : 200,
        });
      }),
    );
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /cameras couldn’t be loaded/i,
    );
    expect(screen.queryByText('Add your first device')).not.toBeInTheDocument();
    camerasFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Add your first device'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains an unreachable Beacon instead of showing sign-in, and retries', async () => {
    localStorage.setItem('beacon.splash.seen.v1', 'true');
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({
        json: () =>
          Promise.resolve({
            code: 'session_required',
            error: 'Authentication required',
          }),
        ok: false,
        status: 401,
      });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /can’t reach beacon/i,
    );
    expect(
      screen.queryByRole('button', { name: /sign in/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.queryByText(/can’t reach beacon/i)).not.toBeInTheDocument(),
    );
  });

  it('shows the one-time splash before sign-in, then remembers it was seen', async () => {
    localStorage.removeItem('beacon.splash.seen.v1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            code: 'session_required',
            error: 'Authentication required',
          }),
        ok: false,
        status: 401,
      }),
    );
    render(<App />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /Get started/ }))[0]!,
    );
    expect(localStorage.getItem('beacon.splash.seen.v1')).toBe('true');
    expect(
      await screen.findByRole('heading', {
        name: 'See what matters, from wherever you are.',
      }),
    ).toBeVisible();
  });

  it('shows the public trust page without requiring a session', async () => {
    window.history.replaceState({}, '', '/trust');
    vi.stubGlobal('fetch', vi.fn());
    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'Privacy is part of how Beacon works.',
      }),
    ).toBeVisible();
    expect(screen.getByText('Beacon does not keep')).toBeVisible();
    expect(
      screen.getAllByRole('link', { name: 'Return to Beacon' })[0],
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

    expect(await screen.findByText('Add your first device')).toBeVisible();
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
      screen.queryByRole('button', { name: /Add a device/i }),
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
    await screen.findByText('Add your first device');
    act(() => {
      window.history.pushState({}, '', '/trust');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(
      screen.getByRole('heading', {
        name: 'Privacy is part of how Beacon works.',
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
        json: () => Promise.resolve({ error: 'Invalid email or password' }),
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password don’t match',
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
    expect(screen.getByRole('heading', { name: 'Favorites' })).toBeVisible();
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
      // The page looks up the published downloads as it opens, then asks for a code.
      .mockResolvedValueOnce({ json: () => Promise.resolve({}), ok: false })
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

    await screen.findByText('Add your first device');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Add a device' })[0]!,
    );
    fireEvent.click(
      await screen.findByRole(
        'radio',
        { name: /Phone or tablet/i },
        { timeout: 8_000 },
      ),
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
    expect(screen.getByText(/A new camera is connected/)).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: 'Cameras' }));
    const catalog = screen.getByLabelText('Your cameras');
    const search = screen.getByRole('searchbox', { name: 'Search cameras' });
    fireEvent.change(search, { target: { value: 'Pixel' } });
    expect(
      screen.getByRole('button', { name: 'Pixel options' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View live: Pixel' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Camera settings' }));

    expect(screen.getByRole('dialog', { name: 'Pixel' })).toBeVisible();
    expect(screen.getByLabelText('Your cameras')).toBe(catalog);
    expect(screen.getByRole('searchbox', { name: 'Search cameras' })).toBe(
      search,
    );
    expect(search).toHaveValue('Pixel');
    expect(
      screen.getByRole('button', { name: 'View live: Pixel' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pixel' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close camera settings' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeVisible();
    const health = screen.getByLabelText('Device health');
    expect(within(health).getByText('Online')).toBeVisible();
    expect(within(health).getByText('2')).toBeVisible();
    expect(screen.getByText('82% · charging')).toBeVisible();
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
    expect(screen.getByText('Capabilities')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove camera' }));
    expect(
      await screen.findByRole('heading', { name: 'Remove Pixel?' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('heading', { name: 'Remove Pixel?' }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        const options = init as RequestInit | undefined;
        return url === '/api/devices/device-1' && options?.method === 'DELETE';
      }),
    ).toBe(false);
    expect(
      screen.getByRole('switch', { name: 'Device privacy' }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Close camera settings' }),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/cameras'));
    expect(screen.queryByRole('dialog', { name: 'Pixel' })).toBeNull();
    expect(screen.getByLabelText('Your cameras')).toBe(catalog);
    expect(search).toHaveValue('Pixel');
    fireEvent.click(screen.getByRole('button', { name: 'View live: Pixel' }));
    const liveView = screen.getByRole('main');
    fireEvent.click(screen.getByRole('button', { name: 'Camera settings' }));
    expect(screen.getByRole('dialog', { name: 'Pixel' })).toBeVisible();
    expect(screen.getByRole('main')).toBe(liveView);
    fireEvent.click(
      screen.getByRole('button', { name: 'Close camera settings' }),
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe('/cameras/rear-camera'),
    );
    expect(screen.getByRole('main')).toBe(liveView);
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
        name: /Remove Kitchen Pixel/,
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove camera' }));
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
                  id: 'event-0',
                  occurredAt: new Date(Date.now() - 60_000).toISOString(),
                },
              ],
            }),
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ events: [], total: 0 }),
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
          json: () => Promise.resolve({ events: [], total: 0 }),
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
    await screen.findByText('Add your first device');
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

    expect(
      await screen.findByText('Hallway phone', { selector: 'b' }),
    ).toBeVisible();
    fireEvent.click(screen.getByText('Hallway phone', { selector: 'b' }));
    expect(screen.getAllByText(/42%/)[0]).toBeVisible();
    expect(screen.getByText(/A motion event does not mean/i)).toBeVisible();
    // The household currently has no paired cameras (these events are
    // historical), so there is nothing to build a camera picker from.

    expect(screen.getByLabelText('Filter activity by time')).toBeVisible();
    await act(async () => {
      TestSocket.instance?.emit({
        cameraId: 'camera-2',
        type: 'motion-event-created',
      });
      await Promise.resolve();
    });
    expect(await screen.findByText('Kitchen phone')).toBeVisible();

    expect(window.localStorage.getItem('beacon_motion_filters_1_:time')).toBe(
      '24',
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
                    : url === '/api/recordings'
                      ? { recordings: [] }
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
                        : url.startsWith('/api/activity')
                          ? { events: [], total: 0 }
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
      await screen.findByText('Hallway phone', { selector: 'b' }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open Hallway phone',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Hallway phone' }),
    ).toBeVisible();
    expect(window.location.pathname).toBe('/cameras/camera-1');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect((await screen.findAllByText('Activity')).length).toBeGreaterThan(0);

    expect(window.location.pathname).toBe('/events');
  });

  it('tracks the active Settings section in the URL so browser back steps between them', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
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
                    : url === '/api/household/sharing'
                      ? { invitations: [], members: [] }
                      : url === '/api/household/guest-links'
                        ? { guestLinks: [] }
                        : url === '/api/notification-preferences'
                          ? { preferences: [] }
                          : url === '/api/motion-retention'
                            ? { days: 30 }
                            : url === '/api/drive/status'
                              ? {
                                  connected: false,
                                  configured: true,
                                  recordingsConnected: false,
                                  providerEmail: null,
                                  updatedAt: null,
                                }
                              : url === '/api/account/sessions'
                                ? { sessions: [] }
                                : url === '/api/access-history'
                                  ? { events: [] }
                                  : { cameras: [] },
            ),
          ok: true,
          status: 200,
        }),
      ),
    );
    render(<App />);
    await screen.findByText('Add your first device');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Household' },
        { timeout: 8_000 },
      ),
    ).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe('/settings');

    fireEvent.click(await screen.findByRole('link', { name: /^Account$/ }));
    expect(window.location.pathname + window.location.search).toBe(
      '/settings?section=account',
    );

    window.history.back();
    await waitFor(() =>
      expect(window.location.pathname + window.location.search).toBe(
        '/settings',
      ),
    );
  });

  it('reauthenticates in place before retrying account deletion', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    let deletionAttempts = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url === '/api/auth/me')
          return Promise.resolve({
            json: () =>
              Promise.resolve({
                user: { email: 'owner@example.com', id: '1' },
              }),
            ok: true,
            status: 200,
          });
        if (url === '/api/cameras')
          return Promise.resolve({
            json: () => Promise.resolve({ cameras: [] }),
            ok: true,
            status: 200,
          });
        if (url === '/api/devices')
          return Promise.resolve({
            json: () => Promise.resolve({ devices: [] }),
            ok: true,
            status: 200,
          });
        if (url === '/api/account' && init?.method === 'DELETE') {
          deletionAttempts += 1;
          return Promise.resolve(
            deletionAttempts === 1
              ? {
                  json: () =>
                    Promise.resolve({ error: 'Recent sign-in required' }),
                  ok: false,
                  status: 403,
                }
              : {
                  json: () => Promise.resolve(undefined),
                  ok: true,
                  status: 204,
                },
          );
        }
        if (url === '/api/account/reauth')
          return Promise.resolve({
            json: () => Promise.resolve(undefined),
            ok: true,
            status: 204,
          });
        const payload =
          url === '/api/account/households'
            ? { households: [] }
            : url === '/api/household/sharing'
              ? { invitations: [], members: [] }
              : url === '/api/household/guest-links'
                ? { guestLinks: [] }
                : url === '/api/notification-preferences'
                  ? { preferences: [] }
                  : url === '/api/motion-retention'
                    ? { days: 30 }
                    : url === '/api/drive/status'
                      ? {
                          connected: false,
                          configured: true,
                          recordingsConnected: false,
                        }
                      : url === '/api/account/sessions'
                        ? { sessions: [] }
                        : url === '/api/access-history'
                          ? { events: [] }
                          : url.startsWith('/api/motion-events')
                            ? { events: [], nextCursor: null }
                            : { events: [], total: 0 };
        return Promise.resolve({
          json: () => Promise.resolve(payload),
          ok: true,
          status: 200,
        });
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete account' }),
    );
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Delete account' }))[1]!,
    );
    expect(
      await screen.findByRole('heading', { name: 'Confirm it’s you' }),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(deletionAttempts).toBe(2));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/reauth',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
