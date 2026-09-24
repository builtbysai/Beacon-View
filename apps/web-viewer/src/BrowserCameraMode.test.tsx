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
    fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'USB camera unavailable',
    );
    expect(screen.getByText('Camera Mode ready')).toBeVisible();
    expect(stopCurrentTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveValue(
      'built-in',
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
      'Camera access was denied or revoked.',
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
    expect(
      screen.getByRole('button', { name: 'Switch camera' }),
    ).toBeDisabled();
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
