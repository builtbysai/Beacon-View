import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserCameraMode } from './BrowserCameraMode';

class CameraSocket {
  static OPEN = 1;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 1;
  close() {}
  send() {}
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('BrowserCameraMode', () => {
  it('uses and persists a descriptive browser name', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
    });
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ id: 'track' }],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([
            { deviceId: 'built-in', kind: 'videoinput', label: 'Webcam' },
          ]),
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });
    const fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          cameras: [
            {
              id: 'camera-one',
              name: 'Webcam',
              sourceKey: 'browser:built-in',
            },
          ],
        }),
      ok: true,
      status: 201,
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('WebSocket', CameraSocket);

    const rendered = render(<BrowserCameraMode onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow and find cameras' }),
    );
    await screen.findByText('Webcam');
    const name = screen.getByRole('textbox', { name: 'Device name' });
    expect(name).toHaveValue('Chrome on Windows');
    fireEvent.change(name, { target: { value: '  Kitchen laptop  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = fetch.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      name: 'Kitchen laptop',
    });
    expect(localStorage.getItem('beacon_browser_camera_name')).toBe(
      'Kitchen laptop',
    );

    rendered.unmount();
    render(<BrowserCameraMode onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow and find cameras' }),
    );
    await screen.findByText('Webcam');
    expect(screen.getByRole('textbox', { name: 'Device name' })).toHaveValue(
      'Kitchen laptop',
    );
  });

  it('requires explicit permission and registers all discovered sources', async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
      getVideoTracks: () => [{ id: 'track' }],
    } as unknown as MediaStream;
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          {
            deviceId: 'built-in',
            kind: 'videoinput',
            label: 'Built-in webcam',
          },
          { deviceId: 'usb', kind: 'videoinput', label: 'USB webcam' },
        ]),
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });
    const fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          cameras: [
            {
              id: 'camera-one',
              name: 'Built-in webcam',
              sourceKey: 'browser:built-in',
            },
            {
              id: 'camera-two',
              name: 'USB webcam',
              sourceKey: 'browser:usb',
            },
          ],
        }),
      ok: true,
      status: 201,
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('WebSocket', CameraSocket);
    render(<BrowserCameraMode onBack={() => undefined} />);

    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow and find cameras' }),
    );
    expect(await screen.findByText('USB webcam')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = fetch.mock.calls[0]![1] as RequestInit;
    expect(typeof request.body).toBe('string');
    const body = JSON.parse(request.body as string) as { sources: unknown[] };
    expect(body.sources).toHaveLength(2);
    expect(body).not.toHaveProperty('credential');
  });

  it('shows the full-bleed broadcast stage once streaming and returns to setup on stop', async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
      getVideoTracks: () => [{ id: 'track' }],
    } as unknown as MediaStream;
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          {
            deviceId: 'built-in',
            kind: 'videoinput',
            label: 'Built-in webcam',
          },
        ]),
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            cameras: [
              {
                id: 'camera-one',
                name: 'Built-in webcam',
                sourceKey: 'browser:built-in',
              },
            ],
          }),
        ok: true,
        status: 201,
      }),
    );
    vi.stubGlobal('WebSocket', CameraSocket);
    render(<BrowserCameraMode onBack={() => undefined} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Allow and find cameras' }),
    );
    await screen.findByText('Built-in webcam');
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    expect(await screen.findByText('Camera Mode ready')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Stop Camera Mode' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Start camera' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop Camera Mode' }));
    expect(
      await screen.findByRole('button', { name: 'Start camera' }),
    ).toBeVisible();
    expect(stop).toHaveBeenCalled();
  });
});
