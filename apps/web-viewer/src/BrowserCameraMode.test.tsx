import {
  act,
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
  static instances: CameraSocket[] = [];
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 1;
  constructor() {
    CameraSocket.instances.push(this);
  }
  close() {}
  send() {}
}

class FakeMediaRecorder {
  static supportedTypes = new Set<string>();
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.has(type);
  }

  mimeType: string;
  #listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(
    readonly stream: MediaStream,
    options: { mimeType: string },
  ) {
    this.mimeType = options.mimeType;
    FakeMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }

  start(): void {}

  stop(): void {
    this.#emit('dataavailable', {
      data: new Blob(['clip-bytes'], { type: this.mimeType }),
    });
    this.#emit('stop', {});
  }
}

afterEach(() => {
  cleanup();
  CameraSocket.instances = [];
  localStorage.clear();
  Reflect.deleteProperty(navigator, 'wakeLock');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BrowserCameraMode', () => {
  it('pairs a signed-out browser with a one-time code and then restores it without a code', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ id: 'track', contentHint: '' }],
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
          device: { id: 'local-device', name: 'Webcam host' },
          cameras: [
            { id: 'camera-one', name: 'Webcam', sourceKey: 'browser:built-in' },
          ],
        }),
      ok: true,
      status: 201,
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('WebSocket', CameraSocket);
    window.history.replaceState(null, '', '/camera-mode/setup?code=ABCDEFGH23');
    const view = render(
      <BrowserCameraMode standalone onBack={() => undefined} />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    expect(screen.getByRole('textbox', { name: 'Pairing code' })).toHaveValue(
      'ABCDEFGH23',
    );
    expect(window.location.search).toBe('');
    fireEvent.click(
      screen.getByRole('button', { name: 'Pair and start camera' }),
    );
    await screen.findByText('Camera Mode ready');
    expect(fetch.mock.calls[0]![0]).toBe('/api/browser-devices/pair');
    const pairedBody = JSON.parse(
      (fetch.mock.calls[0]![1] as RequestInit).body as string,
    ) as { pairingCode: string };
    expect(pairedBody.pairingCode).toBe('ABCDEFGH23');
    expect(localStorage.getItem('beacon_browser_camera_device_id')).toBe(
      'local-device',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop Camera Mode' }));
    view.unmount();

    render(<BrowserCameraMode standalone onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    fireEvent.click(screen.getByRole('button', { name: 'Resume camera' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1]![0]).toBe('/api/browser-devices/restore');
    window.history.replaceState(null, '', '/');
  });
  it('stops a camera stream that resolves after the page closes', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    const stopLateTrack = vi.fn();
    const permissionStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    const lateStream = {
      getTracks: () => [{ stop: stopLateTrack }],
      getVideoTracks: () => [{ id: 'track', contentHint: '' }],
    } as unknown as MediaStream;
    let resolveCapture!: (stream: MediaStream) => void;
    const capture = new Promise<MediaStream>((resolve) => {
      resolveCapture = resolve;
    });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(permissionStream)
      .mockReturnValueOnce(capture);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([
            { deviceId: 'built-in', kind: 'videoinput', label: 'Webcam' },
          ]),
        getUserMedia,
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
                name: 'Webcam',
                sourceKey: 'browser:built-in',
              },
            ],
          }),
        ok: true,
        status: 201,
      }),
    );
    vi.stubGlobal('WebSocket', CameraSocket);

    const view = render(<BrowserCameraMode onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    view.unmount();
    await act(async () => {
      resolveCapture(lateStream);
      await capture;
    });
    expect(stopLateTrack).toHaveBeenCalledOnce();
  });

  it('keeps the current camera active when a source switch cannot capture', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    const stopCurrentTrack = vi.fn();
    const permissionStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    const currentStream = {
      getTracks: () => [{ stop: stopCurrentTrack }],
      getVideoTracks: () => [{ id: 'track', contentHint: '' }],
    } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(permissionStream)
      .mockResolvedValueOnce(currentStream)
      .mockRejectedValueOnce(new Error('USB camera unavailable'));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'built-in', kind: 'videoinput', label: 'Webcam' },
          { deviceId: 'usb', kind: 'videoinput', label: 'USB camera' },
        ]),
        getUserMedia,
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
                name: 'Webcam',
                sourceKey: 'browser:built-in',
              },
              {
                id: 'camera-two',
                name: 'USB camera',
                sourceKey: 'browser:usb',
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
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('USB camera');
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByText('Camera Mode ready');
    fireEvent.click(screen.getByRole('button', { name: 'Camera settings' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Camera' }), {
      target: { value: 'usb' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'USB camera unavailable',
    );
    expect(screen.getByText('Camera Mode ready')).toBeVisible();
    expect(stopCurrentTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveValue(
      'built-in',
    );
  });

  it('renames the device and camera from the active settings panel, and Escape closes it', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    const permissionStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    const captureStream = {
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ id: 'track', contentHint: '' }],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([
            { deviceId: 'built-in', kind: 'videoinput', label: 'Webcam' },
          ]),
        getUserMedia: vi
          .fn()
          .mockResolvedValueOnce(permissionStream)
          .mockResolvedValue(captureStream),
      },
    });
    const fetchMock = vi.fn<
      (input: string | URL, init?: RequestInit) => Promise<Response>
    >(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            cameras: [
              {
                id: 'camera-one',
                name: 'Webcam',
                sourceKey: 'browser:built-in',
              },
            ],
            device: { id: 'device-one', name: 'Living room' },
          }),
          { status: 201 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', CameraSocket);

    render(<BrowserCameraMode onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByText('Camera Mode ready');

    fireEvent.click(screen.getByRole('button', { name: 'Camera settings' }));
    const nameField = screen.getByRole('textbox', { name: 'Device name' });
    expect(nameField).toHaveValue('Living room');
    fireEvent.change(nameField, { target: { value: 'Front porch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('/api/browser-devices');
      const body = lastCall?.[1]?.body;
      expect(typeof body).toBe('string');
      expect(body as string).toContain('"name":"Front porch"');
    });

    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { bubbles: false, cancelable: true }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Device name' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('stops local capture when signaling revokes camera access', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    const stopCapture = vi.fn();
    const permissionStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    const captureStream = {
      getTracks: () => [{ stop: stopCapture }],
      getVideoTracks: () => [{ id: 'track', contentHint: '' }],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([
            { deviceId: 'built-in', kind: 'videoinput', label: 'Webcam' },
          ]),
        getUserMedia: vi
          .fn()
          .mockResolvedValueOnce(permissionStream)
          .mockResolvedValueOnce(captureStream),
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
                name: 'Webcam',
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
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByText('Camera Mode ready');
    act(() => {
      CameraSocket.instances[0]!.onclose?.({ code: 4003 } as CloseEvent);
    });
    expect(stopCapture).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole('button', { name: 'Start camera' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /lost access to the camera/i,
    );
  });

  it('uses and persists a descriptive browser name', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: vi.fn().mockResolvedValue({ release: vi.fn() }),
      },
    });
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
          device: { name: 'Renamed in Cameras' },
          cameras: [
            {
              id: 'camera-one',
              name: 'Saved webcam name',
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
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    const name = screen.getByRole('textbox', { name: 'Device name' });
    expect(name).toHaveValue('Chrome on Windows');
    const keepAwake = screen.getByRole('checkbox', {
      name: 'Keep this device awake while Camera Mode is active',
    });
    fireEvent.click(keepAwake);
    expect(localStorage.getItem('beacon_browser_keep_awake')).toBe('true');
    fireEvent.change(name, { target: { value: '  Kitchen laptop  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = fetch.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      name: 'Kitchen laptop',
    });
    expect(localStorage.getItem('beacon_browser_camera_name')).toBe(
      'Renamed in Cameras',
    );

    rendered.unmount();
    render(<BrowserCameraMode onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    expect(screen.getByRole('textbox', { name: 'Device name' })).toHaveValue(
      'Renamed in Cameras',
    );
    expect(
      screen.getByRole('checkbox', {
        name: 'Keep this device awake while Camera Mode is active',
      }),
    ).toBeChecked();
  });

  it('keeps setup available when browser storage blocks stable registration', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
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
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'beacon_browser_device_id')
        throw new DOMException('Storage blocked', 'SecurityError');
      return null;
    });

    render(<BrowserCameraMode onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enable browser storage to keep this camera connected.',
    );
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
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
      screen.getByRole('button', { name: 'Allow camera access' }),
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
      screen.getByRole('button', { name: 'Allow camera access' }),
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

  it('keeps the desktop app’s live-capture indicator in step with the broadcast', async () => {
    const setCaptureActive = vi.fn();
    window.beaconDesktop = { setCaptureActive, version: 1 };
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
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
    try {
      const view = render(<BrowserCameraMode onBack={() => undefined} />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Allow camera access' }),
      );
      await screen.findByText('Built-in webcam');
      expect(setCaptureActive).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
      await waitFor(() =>
        expect(setCaptureActive.mock.calls).toEqual([[true]]),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Stop Camera Mode' }));
      await waitFor(() =>
        expect(setCaptureActive.mock.calls).toEqual([[true], [false]]),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
      await waitFor(() => expect(setCaptureActive).toHaveBeenCalledTimes(3));
      view.unmount();
      expect(setCaptureActive).toHaveBeenLastCalledWith(false);
    } finally {
      delete window.beaconDesktop;
    }
  });

  it('lets the owner capture and upload a clip of its own broadcast stream', async () => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ id: 'track', contentHint: '' }],
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
    const fetchMock = vi.fn<
      (input: string | URL, init?: RequestInit) => Promise<Response>
    >((input, init) => {
      const url = String(input);
      if (url === '/api/browser-devices')
        return Promise.resolve(
          new Response(
            JSON.stringify({
              cameras: [
                {
                  id: 'camera-one',
                  name: 'Built-in webcam',
                  sourceKey: 'browser:built-in',
                },
              ],
            }),
            { status: 201 },
          ),
        );
      if (url === '/api/recordings' && init?.method === 'POST')
        return Promise.resolve(
          new Response(
            JSON.stringify({ recording: { id: 'rec-1', status: 'requested' } }),
            { status: 202 },
          ),
        );
      if (url === '/api/recordings/rec-1/upload-session')
        return Promise.resolve(
          new Response(
            JSON.stringify({ uploadUrl: 'https://drive.example/upload' }),
            { status: 201 },
          ),
        );
      if (url === 'https://drive.example/upload')
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'drive-file-1' }), {
            status: 200,
          }),
        );
      if (url === '/api/recordings/rec-1/complete')
        return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', CameraSocket);

    render(<BrowserCameraMode canRecord onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Built-in webcam');
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByText('Camera Mode ready');

    const recordButton = screen.getByRole('button', {
      name: 'Record a short clip',
    });
    await waitFor(() => expect(recordButton).toBeEnabled());
    fireEvent.click(recordButton);

    const activeButton = await screen.findByRole('button', {
      name: /Recording,/,
    });
    expect(activeButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Camera settings' }));
    expect(screen.getByRole('combobox', { name: 'Camera' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(activeButton);
    FakeMediaRecorder.instances[0]!.stop();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Recording saved' }),
      ).toBeDisabled(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recordings/rec-1/complete',
      expect.objectContaining({
        body: JSON.stringify({ providerFileId: 'drive-file-1' }),
        method: 'POST',
      }),
    );
  });

  it('hides the record control for anyone who is not the household owner', async () => {
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ id: 'track', contentHint: '' }],
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
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Built-in webcam');
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByText('Camera Mode ready');

    expect(
      screen.queryByRole('button', { name: 'Record a short clip' }),
    ).not.toBeInTheDocument();
  });
});

describe('BrowserCameraMode standby (wake on view)', () => {
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  class FakePeer {
    connectionState = 'new';
    onconnectionstatechange: (() => void) | null = null;
    onicecandidate: (() => void) | null = null;
    ontrack: (() => void) | null = null;
    addTrack() {}
    addTransceiver() {}
    close() {}
    createOffer() {
      return Promise.resolve({ sdp: 'offer', type: 'offer' as const });
    }
    setLocalDescription() {
      return Promise.resolve();
    }
  }

  function setup(search = '') {
    const trackStop = vi.fn();
    const stream = {
      getAudioTracks: () => [],
      getTracks: () => [{ stop: trackStop }],
      getVideoTracks: () => [{ id: 'track' }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([
            { deviceId: 'built-in', kind: 'videoinput', label: 'Webcam' },
          ]),
        getUserMedia,
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
                name: 'Webcam',
                sourceKey: 'browser:built-in',
              },
            ],
          }),
        ok: true,
        status: 201,
      }),
    );
    vi.stubGlobal('WebSocket', CameraSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    window.history.replaceState(null, '', `/camera-mode${search}`);
    return { getUserMedia, trackStop };
  }

  /** getUserMedia calls that actually open a camera for streaming (the
   * discovery permission probe asks for `video: true`). */
  function streamingOpens(getUserMedia: ReturnType<typeof vi.fn>) {
    return getUserMedia.mock.calls.filter(
      ([constraints]) =>
        typeof (constraints as MediaStreamConstraints).video === 'object',
    ).length;
  }

  function viewerArrives(connectionId: string) {
    CameraSocket.instances[0]!.onmessage?.({
      data: JSON.stringify({
        canListen: true,
        connectionId,
        iceServers: [],
        iceTransportPolicy: 'all',
        type: 'viewer-ready',
      }),
    } as MessageEvent);
  }

  it('stays connected with the camera off until a viewer opens it', async () => {
    const { getUserMedia, trackStop } = setup();
    render(<BrowserCameraMode onBack={() => undefined} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow camera access' }),
    );
    await screen.findByText('Webcam');
    fireEvent.click(screen.getByRole('radio', { name: /Standby/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    expect(
      await screen.findByText('Standby · camera off', undefined, {
        timeout: 5_000,
      }),
    ).toBeVisible();
    expect(screen.getByText('Camera is off')).toBeVisible();
    expect(streamingOpens(getUserMedia)).toBe(0);
    expect(localStorage.getItem('beacon_browser_camera_power')).toBe('standby');

    viewerArrives('viewer-one');
    await waitFor(() => expect(streamingOpens(getUserMedia)).toBe(1));
    await waitFor(() =>
      expect(screen.queryByText('Camera is off')).not.toBeInTheDocument(),
    );

    // A second viewer shares the already-open camera.
    viewerArrives('viewer-two');
    await act(() => Promise.resolve());
    expect(streamingOpens(getUserMedia)).toBe(1);

    // The discovery permission probe already stopped its own tracks.
    const stopsBeforeRelease = trackStop.mock.calls.length;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    for (const connectionId of ['viewer-one', 'viewer-two'])
      CameraSocket.instances[0]!.onmessage?.({
        data: JSON.stringify({ code: 'x', connectionId, type: 'peer-left' }),
      } as MessageEvent);
    await act(() => vi.advanceTimersByTimeAsync(19_000));
    expect(trackStop).toHaveBeenCalledTimes(stopsBeforeRelease);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(trackStop.mock.calls.length).toBeGreaterThan(stopsBeforeRelease);
    expect(await screen.findByText('Camera is off')).toBeVisible();
  });

  it('starts without clicks from an autostart link and tells the desktop app to resume it', async () => {
    const { getUserMedia } = setup('?autostart=1&power=standby&mic=1');
    const setCameraResume = vi.fn();
    const setCameraActivity = vi.fn();
    window.beaconDesktop = {
      setCameraActivity,
      setCameraResume,
      setCaptureActive: vi.fn(),
      version: 1,
    };
    try {
      const view = render(<BrowserCameraMode onBack={() => undefined} />);
      expect(
        await screen.findByText('Standby · camera off', undefined, {
          timeout: 5_000,
        }),
      ).toBeVisible();
      expect(streamingOpens(getUserMedia)).toBe(0);
      await waitFor(() => {
        expect(setCameraResume).toHaveBeenLastCalledWith(
          '/camera-mode?autostart=1&mic=1&power=standby',
        );
        expect(setCameraActivity).toHaveBeenLastCalledWith('standby');
      });
      expect(screen.getByText(/Runs in the background/)).toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: 'Stop Camera Mode' }));
      await waitFor(() =>
        expect(setCameraResume).toHaveBeenLastCalledWith(null),
      );
      expect(setCameraActivity).toHaveBeenLastCalledWith('off');
      view.unmount();
    } finally {
      delete window.beaconDesktop;
    }
  });

  it('does not enroll from a link with a pairing code unless the desktop app has already asked (V19)', async () => {
    const { getUserMedia } = setup(
      '?autostart=1&code=ABCDEFGHJK&power=standby&mic=1',
    );
    render(<BrowserCameraMode onBack={() => undefined} standalone />);
    // The normal setup screen waits for the person; nothing was registered.
    expect(
      await screen.findByRole('button', { name: 'Allow camera access' }),
    ).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(streamingOpens(getUserMedia)).toBe(0);
    const calls = vi
      .mocked(fetch)
      .mock.calls.map((call) => String(call[0] as string));
    expect(calls.some((url) => url.includes('/api/browser-devices'))).toBe(
      false,
    );
  });

  /** A camera whose video tracks can end by themselves, like a real one being unplugged. */
  function endableCamera() {
    const listeners: Array<() => void> = [];
    const stop = vi.fn();
    const stream = {
      getAudioTracks: () => [],
      getTracks: () => [{ stop }],
      getVideoTracks: () => [
        {
          addEventListener: (_type: string, listener: () => void) =>
            listeners.push(listener),
          id: 'track',
          readyState: 'live',
        },
      ],
    } as unknown as MediaStream;
    return {
      end: () => listeners.forEach((listener) => listener()),
      stop,
      stream,
    };
  }

  it('opens a fresh camera for the next viewer when the open one ended by itself', async () => {
    const { getUserMedia } = setup('?autostart=1&power=standby');
    const first = endableCamera();
    getUserMedia.mockImplementation((constraints: MediaStreamConstraints) =>
      Promise.resolve(
        typeof constraints.video === 'object'
          ? first.stream
          : { getTracks: () => [{ stop: vi.fn() }] },
      ),
    );
    render(<BrowserCameraMode onBack={() => undefined} />);
    await screen.findByText('Standby · camera off', undefined, {
      timeout: 5_000,
    });
    viewerArrives('viewer-one');
    await waitFor(() => expect(streamingOpens(getUserMedia)).toBe(1));

    // The system takes the camera away. It lets go instead of keeping a dead stream.
    act(() => first.end());
    await waitFor(() => expect(first.stop).toHaveBeenCalled());
    expect(await screen.findByText('Camera is off')).toBeVisible();

    getUserMedia.mockImplementation(() =>
      Promise.resolve(endableCamera().stream),
    );
    viewerArrives('viewer-two');
    await waitFor(() => expect(streamingOpens(getUserMedia)).toBe(2));
  });

  it('tries the camera again once when another app has it for a moment', async () => {
    const { getUserMedia } = setup('?autostart=1&power=standby');
    render(<BrowserCameraMode onBack={() => undefined} />);
    await screen.findByText('Standby · camera off', undefined, {
      timeout: 5_000,
    });
    getUserMedia.mockRejectedValueOnce(
      new DOMException('busy', 'NotReadableError'),
    );
    viewerArrives('viewer-one');
    await waitFor(() => expect(streamingOpens(getUserMedia)).toBe(2), {
      timeout: 5_000,
    });
    expect(screen.queryByText(/couldn’t turn on/)).not.toBeInTheDocument();
  });

  it('starts an always-on camera again after it ended by itself', async () => {
    const { getUserMedia } = setup('?autostart=1&power=always');
    const first = endableCamera();
    getUserMedia.mockImplementation((constraints: MediaStreamConstraints) =>
      Promise.resolve(
        typeof constraints.video === 'object'
          ? first.stream
          : { getTracks: () => [{ stop: vi.fn() }] },
      ),
    );
    render(<BrowserCameraMode onBack={() => undefined} />);
    await waitFor(() => expect(streamingOpens(getUserMedia)).toBe(1), {
      timeout: 5_000,
    });
    getUserMedia.mockImplementation(() =>
      Promise.resolve(endableCamera().stream),
    );
    act(() => first.end());
    await waitFor(() => expect(streamingOpens(getUserMedia)).toBe(2), {
      timeout: 8_000,
    });
  });

  it('reports a camera that cannot wake without dropping standby', async () => {
    const { getUserMedia } = setup('?autostart=1&power=standby');
    render(<BrowserCameraMode onBack={() => undefined} />);
    await screen.findByText('Standby · camera off', undefined, {
      timeout: 5_000,
    });
    getUserMedia.mockRejectedValue(
      new DOMException('busy', 'NotReadableError'),
    );
    viewerArrives('viewer-one');
    expect(
      await screen.findByText(/couldn’t turn on/, undefined, {
        timeout: 5_000,
      }),
    ).toBeVisible();
    expect(screen.getByText('Standby · camera off')).toBeVisible();
  });
});
