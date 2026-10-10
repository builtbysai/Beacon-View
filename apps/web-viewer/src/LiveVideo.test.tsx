import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveVideo } from './LiveVideo';
import { DRIVE_READY } from './drive-recording';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 1;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }
  close = vi.fn();
  send = vi.fn();
  message(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
}

class FakeMediaStream {}

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

class FakePeer {
  static instances: FakePeer[] = [];
  connectionState = 'new';
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  sender = { replaceTrack: vi.fn().mockResolvedValue(undefined) };
  transceiver = {
    receiver: { track: { kind: 'audio' } },
    currentDirection: 'sendonly',
    direction: 'recvonly',
    sender: this.sender,
  };
  constructor() {
    FakePeer.instances.push(this);
  }
  getTransceivers = () => [this.transceiver];
  getStats = () => Promise.resolve(new Map());
  setRemoteDescription = () => Promise.resolve();
  createAnswer = () => Promise.resolve({ type: 'answer', sdp: 'answer' });
  setLocalDescription = () => Promise.resolve();
  close = vi.fn();
}

/** Secondary controls live in the "More" menu; open it before using one. */
function openMore() {
  const trigger = screen.getByRole('button', { name: 'More' });
  if (trigger.getAttribute('aria-expanded') !== 'true')
    fireEvent.click(trigger);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LiveVideo', () => {
  it('ends the live peer and signaling on sleep expiry, and only resumes on request', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const view = render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />,
    );
    try {
      const socket = FakeWebSocket.instances[0]!;
      await act(async () => {
        socket.message({
          type: 'ready',
          connectionId: 'connection-sleep',
          iceServers: [],
          iceTransportPolicy: 'all',
        });
        await Promise.resolve();
      });
      const peer = FakePeer.instances[0]!;
      act(() => {
        peer.connectionState = 'connected';
        peer.onconnectionstatechange?.();
      });
      openMore();
      fireEvent.click(screen.getByRole('menuitem', { name: /Sleep timer/ }));
      await act(async () => {
        vi.advanceTimersByTime(15 * 60_000);
        await Promise.resolve();
      });
      expect(socket.close).toHaveBeenCalled();
      expect(peer.close).toHaveBeenCalled();
      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({
          connectionId: 'connection-sleep',
          type: 'disconnect',
        }),
      );
      expect(screen.getByText('Sleep timer finished')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Talk' })).toBeNull();
      const count = FakeWebSocket.instances.length;
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(FakeWebSocket.instances).toHaveLength(count);
      fireEvent.click(screen.getByRole('button', { name: 'Resume viewing' }));
      expect(FakeWebSocket.instances).toHaveLength(count + 1);
      openMore();
      expect(
        screen.getByRole('menuitem', { name: /Sleep timer: off/ }),
      ).toBeVisible();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
  it('requests fullscreen for the surface containing all controls and explains rejection', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const { container } = render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />,
    );
    const surface = container.querySelector('main')!;
    const requestFullscreen = vi.fn().mockRejectedValue(new Error('Denied'));
    Object.defineProperty(surface, 'requestFullscreen', {
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn(),
    });
    try {
      openMore();
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: 'Full screen' }));
        await Promise.resolve();
      });
      expect(requestFullscreen).toHaveBeenCalledOnce();
      expect(surface).toContainElement(
        screen.getByRole('button', { name: 'Talk' }),
      );
      expect(surface).toContainElement(
        screen.getByRole('button', { name: 'Listen' }),
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Full screen could not open',
      );
    } finally {
      Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });

  it('returns to muted playback when the browser rejects Listen', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const { container } = render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />,
    );
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'play', {
      value: vi.fn().mockRejectedValue(new Error('Playback blocked')),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
      await Promise.resolve();
    });
    expect(video.muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Listen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sound could not start',
    );
  });

  it('does not connect while privacy is on and keeps privacy recovery available', async () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onPrivacy = vi.fn().mockRejectedValue(new Error('Offline'));
    render(
      <LiveVideo
        camera={{ id: 'camera', name: 'Kitchen' }}
        privacyMode
        onPrivacy={onPrivacy}
      />,
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(screen.getByText('Privacy is on')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Reconnect' }),
    ).not.toBeInTheDocument();
    openMore();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Resume camera' }));
      await Promise.resolve();
    });
    expect(onPrivacy).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Privacy could not be changed',
    );
  });

  it('serializes source switches and preserves the current view on failure', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    let reject!: (error: Error) => void;
    const onSelectCamera = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    render(
      <LiveVideo
        camera={{ id: 'rear', name: 'Rear' }}
        siblingCameras={[
          { id: 'rear', name: 'Rear' },
          { id: 'front', name: 'Front' },
        ]}
        onSelectCamera={onSelectCamera}
      />,
    );
    openMore();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Switch camera/ }));
      await Promise.resolve();
    });
    openMore();
    expect(
      screen.getByRole('menuitem', { name: /Switch camera/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: /Switch camera/ }));
    expect(onSelectCamera).toHaveBeenCalledOnce();
    await act(async () => {
      reject(new Error('Offline'));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your current view remains selected',
    );
    expect(screen.getByRole('heading', { name: 'Rear' })).toBeVisible();
    openMore();
    expect(
      screen.getByRole('menuitem', { name: /Switch camera/ }),
    ).toBeEnabled();
  });

  it('starts muted and requires an explicit Listen action', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const { container } = render(
      <LiveVideo
        camera={{ id: 'camera-id', name: 'Kitchen camera' }}
        onBack={() => undefined}
      />,
    );

    expect(screen.getByText('Connection: connecting')).toHaveTextContent(
      'Connection: connecting',
    );
    expect(screen.getByText('Kitchen camera')).toBeVisible();
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveProperty('muted', true);
    const listen = screen.getByRole('button', { name: 'Listen' });
    expect(listen).toHaveAttribute('aria-pressed', 'false');
    Object.defineProperty(video, 'play', { value: vi.fn() });
    fireEvent.click(listen);
    expect(video).toHaveProperty('muted', false);
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
    expect(screen.queryByText('How this view works')).not.toBeInTheDocument();
  });

  it('hides Listen and Talk entirely when the camera grant excludes audio', async () => {
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    render(<LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />);

    await act(async () => {
      FakeWebSocket.instances[0]!.message({
        canListen: false,
        canTalk: false,
        connectionId: 'connection-a',
        iceServers: [],
        iceTransportPolicy: 'all',
        type: 'ready',
      });
      await Promise.resolve();
    });

    expect(
      screen.queryByRole('button', { name: 'Listen' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Mute' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Talk' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the same video connection for Talk and stops capture immediately on transport failure', async () => {
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const track = {
      enabled: true,
      readyState: 'live',
      onended: null,
      stop: vi.fn(),
    };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const { unmount } = render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />,
    );
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      await Promise.resolve();
      socket.message({
        type: 'ready',
        connectionId: 'connection-a',
        iceServers: [],
        iceTransportPolicy: 'all',
      });
      socket.message({
        type: 'offer',
        connectionId: 'connection-a',
        sdp: 'offer',
      });
    });
    const peer = FakePeer.instances[0]!;
    await act(async () => {
      await Promise.resolve();
      peer.connectionState = 'connected';
      peer.onconnectionstatechange?.();
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(screen.getByRole('button', { name: 'Talk' }));
    });
    act(() =>
      socket.message({
        type: 'talk-state',
        connectionId: 'connection-a',
        active: true,
      }),
    );
    expect(track.enabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop talking' })).toBeEnabled();
    expect(FakePeer.instances).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(peer.close).not.toHaveBeenCalled();
    act(() => socket.onerror?.());
    expect(track.stop).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Talk status')).toHaveTextContent(
      'Microphone off',
    );
    unmount();
  });

  it('lets the owner capture a short clip and upload it straight to Drive, but hides the control otherwise', async () => {
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    vi.stubGlobal('MediaStream', FakeMediaStream);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const fetchMock = vi.fn<
      (input: string | URL, init?: RequestInit) => Promise<Response>
    >((input, init) => {
      const url = String(input);
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

    const { unmount } = render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} canRecord />,
    );
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      socket.message({
        type: 'ready',
        connectionId: 'connection-a',
        iceServers: [],
        iceTransportPolicy: 'all',
      });
      await Promise.resolve();
    });
    const peer = FakePeer.instances[0]!;
    await act(async () => {
      peer.connectionState = 'connected';
      peer.onconnectionstatechange?.();
      peer.ontrack?.({
        receiver: {},
        streams: [new FakeMediaStream()],
      } as unknown as RTCTrackEvent);
      await Promise.resolve();
    });

    const recordButton = screen.getByRole('button', {
      name: 'Record a short clip',
    });
    expect(recordButton).toBeEnabled();
    await act(async () => {
      fireEvent.click(recordButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recordings',
      expect.objectContaining({
        body: JSON.stringify({ cameraId: 'camera' }),
        method: 'POST',
      }),
    );
    const activeButton = screen.getByRole('button', { name: /Recording,/ });
    expect(activeButton).toBeEnabled();
    expect(activeButton).toHaveAttribute('aria-pressed', 'true');

    // Stop: the same button now finishes the capture and drives it through
    // upload-session, the direct-to-Drive PUT, and complete.
    act(() => {
      fireEvent.click(activeButton);
      const recorder = FakeMediaRecorder.instances[0]!;
      recorder.stop();
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Recording saved' }),
      ).toBeDisabled(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recordings/rec-1/upload-session',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://drive.example/upload',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recordings/rec-1/complete',
      expect.objectContaining({
        body: JSON.stringify({ providerFileId: 'drive-file-1' }),
        method: 'POST',
      }),
    );
    unmount();
  });

  it('aborts an in-progress recording instead of uploading a broken clip when the connection drops', async () => {
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    vi.stubGlobal('MediaStream', FakeMediaStream);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const fetchMock = vi.fn<
      (input: string | URL, init?: RequestInit) => Promise<Response>
    >((input, init) => {
      const url = String(input);
      if (url === '/api/recordings' && init?.method === 'POST')
        return Promise.resolve(
          new Response(
            JSON.stringify({ recording: { id: 'rec-2', status: 'requested' } }),
            { status: 202 },
          ),
        );
      if (url === '/api/recordings/rec-2/fail')
        return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} canRecord />);
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      socket.message({
        type: 'ready',
        connectionId: 'connection-a',
        iceServers: [],
        iceTransportPolicy: 'all',
      });
      await Promise.resolve();
    });
    const peer = FakePeer.instances[0]!;
    await act(async () => {
      peer.connectionState = 'connected';
      peer.onconnectionstatechange?.();
      peer.ontrack?.({
        receiver: {},
        streams: [new FakeMediaStream()],
      } as unknown as RTCTrackEvent);
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Record a short clip' }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: /Recording,/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The connection drops mid-recording -- ICE failure, no retry grace
    // period, unlike a brief 'disconnected' blip.
    await act(async () => {
      peer.connectionState = 'failed';
      peer.onconnectionstatechange?.();
      await Promise.resolve();
    });

    // Nothing was kept to upload, so the control offers a fresh recording
    // rather than a retry that could do nothing.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/connection.*lost/i),
    );
    expect(
      screen.getByRole('button', { name: 'Record a short clip' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Retry encrypted recording upload',
      }),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recordings/rec-2/fail',
      expect.objectContaining({
        body: JSON.stringify({ reason: 'capture_failed' }),
        method: 'POST',
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/recordings/rec-2/upload-session',
      expect.anything(),
    );
  });

  it('offers to connect Google Drive instead of a dead-end error when recording is not ready', () => {
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const connect = vi.fn();
    render(
      <LiveVideo
        camera={{ id: 'camera', name: 'Kitchen' }}
        canRecord
        drive={{ ...DRIVE_READY, connect, state: 'not_connected' }}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Record a short clip' }),
    ).not.toBeInTheDocument();
    const connectButton = screen.getByRole('button', {
      name: 'Connect Google Drive to record',
    });
    fireEvent.click(connectButton);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('asks to reconnect, not connect, when Google stopped accepting Drive', () => {
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    render(
      <LiveVideo
        camera={{ id: 'camera', name: 'Kitchen' }}
        canRecord
        drive={{ ...DRIVE_READY, state: 'expired' }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Reconnect Google Drive to record' }),
    ).toBeInTheDocument();
  });

  it('hides flip and pause when the grant excludes them, even with siblings and onPrivacy present', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    render(
      <LiveVideo
        camera={{ id: 'rear', name: 'Rear' }}
        siblingCameras={[
          { id: 'rear', name: 'Rear' },
          { id: 'front', name: 'Front' },
        ]}
        onPrivacy={() => Promise.resolve()}
        canFlip={false}
        canPause={false}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /Switch camera/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Resume|Pause/ }),
    ).not.toBeInTheDocument();
  });

  it('hides the recording control for a non-owner viewer', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    render(<LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />);
    expect(
      screen.queryByRole('button', { name: /record/i }),
    ).not.toBeInTheDocument();
  });

  it('excludes this session itself from the "watching now" viewer count', async () => {
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} viewerCount={1} />,
    );

    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      socket.message({
        type: 'ready',
        connectionId: 'connection-a',
        iceServers: [],
        iceTransportPolicy: 'all',
      });
      await Promise.resolve();
    });
    const peer = FakePeer.instances[0]!;
    await act(async () => {
      peer.connectionState = 'connected';
      peer.onconnectionstatechange?.();
      await Promise.resolve();
    });

    // Now connected: the backend's count of 1 is just this session, so
    // "others watching" is 0 -- the badge should stay hidden, not show 1.
    expect(
      screen.queryByRole('button', { name: /Stream details/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the count of other viewers once someone besides this session is watching', async () => {
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} viewerCount={2} />,
    );
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      socket.message({
        type: 'ready',
        connectionId: 'connection-a',
        iceServers: [],
        iceTransportPolicy: 'all',
      });
      await Promise.resolve();
    });
    const peer = FakePeer.instances[0]!;
    await act(async () => {
      peer.connectionState = 'connected';
      peer.onconnectionstatechange?.();
      await Promise.resolve();
    });

    openMore();
    const statsToggle = screen.getByRole('menuitem', {
      name: /Stream details/,
    });
    expect(statsToggle).toHaveAccessibleName('Stream details: 1 other viewer');
    expect(statsToggle).toHaveTextContent('1 viewer');
    fireEvent.click(statsToggle);
    expect(screen.getByText('Watching now')).toBeVisible();
    expect(screen.getByText('You')).toBeVisible();
    expect(screen.getByText('Household viewer 1')).toBeVisible();
  });

  it('clears the stale "Microphone off · reconnecting" status once a full reconnect completes', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const track = {
      enabled: true,
      readyState: 'live',
      onended: null,
      stop: vi.fn(),
    };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    try {
      render(<LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />);
      const socket = FakeWebSocket.instances[0]!;
      await act(async () => {
        socket.message({
          type: 'ready',
          connectionId: 'connection-a',
          iceServers: [],
          iceTransportPolicy: 'all',
        });
        await Promise.resolve();
      });
      const peer = FakePeer.instances[0]!;
      await act(async () => {
        peer.connectionState = 'connected';
        peer.onconnectionstatechange?.();
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Talk' }));
        await Promise.resolve();
      });
      act(() =>
        socket.message({
          type: 'talk-state',
          connectionId: 'connection-a',
          active: true,
        }),
      );
      expect(
        screen.getByRole('button', { name: 'Stop talking' }),
      ).toBeEnabled();

      // A hard failure (not the in-place 8-second grace) tears the whole
      // connection down and schedules a full reconnect.
      act(() => socket.onerror?.());
      expect(screen.getByLabelText('Talk status')).toHaveTextContent(
        'Microphone off',
      );

      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
      expect(FakeWebSocket.instances).toHaveLength(2);
      const reconnectedSocket = FakeWebSocket.instances[1]!;
      await act(async () => {
        reconnectedSocket.message({
          type: 'ready',
          connectionId: 'connection-b',
          iceServers: [],
          iceTransportPolicy: 'all',
        });
        await Promise.resolve();
      });
      const reconnectedPeer = FakePeer.instances[1]!;
      await act(async () => {
        reconnectedPeer.connectionState = 'connected';
        reconnectedPeer.onconnectionstatechange?.();
        await Promise.resolve();
      });

      expect(screen.queryByLabelText('Talk status')).toBeNull();
      expect(screen.getByRole('button', { name: 'Talk' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows a transient disconnected state to recover without replacing the session', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    try {
      render(<LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />);
      const socket = FakeWebSocket.instances[0]!;
      await act(async () => {
        socket.message({
          type: 'ready',
          connectionId: 'connection-a',
          iceServers: [],
          iceTransportPolicy: 'all',
        });
        await Promise.resolve();
      });
      const peer = FakePeer.instances[0]!;
      act(() => {
        peer.connectionState = 'connected';
        peer.onconnectionstatechange?.();
        peer.connectionState = 'disconnected';
        peer.onconnectionstatechange?.();
        vi.advanceTimersByTime(7_999);
      });
      expect(socket.close).not.toHaveBeenCalled();
      expect(FakeWebSocket.instances).toHaveLength(1);

      act(() => {
        peer.connectionState = 'connected';
        peer.onconnectionstatechange?.();
        vi.advanceTimersByTime(10_000);
      });
      expect(socket.close).not.toHaveBeenCalled();
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(screen.getByText('Connection: connected')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('recognizes a local relay and tolerates unavailable connection statistics', async () => {
    FakeWebSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const { container } = render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />,
    );
    await act(async () => {
      FakeWebSocket.instances[0]!.message({
        type: 'ready',
        connectionId: 'connection-a',
        iceServers: [],
        iceTransportPolicy: 'all',
      });
      await Promise.resolve();
    });
    const peer = FakePeer.instances[0]!;
    const getStats = vi.spyOn(peer, 'getStats').mockResolvedValue(
      new Map([
        [
          'inbound',
          {
            type: 'inbound-rtp',
            kind: 'video',
            bytesReceived: 1000,
            timestamp: 1000,
          },
        ],
        [
          'pair',
          {
            type: 'candidate-pair',
            state: 'succeeded',
            nominated: true,
            localCandidateId: 'local',
            remoteCandidateId: 'remote',
          },
        ],
        ['local', { type: 'local-candidate', candidateType: 'relay' }],
        ['remote', { type: 'remote-candidate', candidateType: 'host' }],
      ]),
    );
    await act(async () => {
      peer.connectionState = 'connected';
      peer.onconnectionstatechange?.();
      await Promise.resolve();
    });
    openMore();
    expect(screen.getByRole('menuitem', { name: /TURN relay/ })).toBeVisible();
    expect(screen.getByText('Starting secure video')).toBeVisible();
    fireEvent.loadedData(container.querySelector('video')!);
    expect(screen.queryByText('Starting secure video')).not.toBeInTheDocument();
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: /TURN relay/ }));
    expect(screen.getByLabelText('Live stream quality')).toBeVisible();
    getStats.mockRejectedValueOnce(new Error('Peer closed'));
    await act(async () => {
      peer.onconnectionstatechange?.();
      await Promise.resolve();
    });
    expect(screen.getByText('Connection: connected')).toBeInTheDocument();
    openMore();
    expect(
      screen.queryByRole('menuitem', { name: /TURN relay/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps only the frequent controls on the bar and everything else in More', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    render(
      <LiveVideo
        camera={{ id: 'camera', deviceId: 'device', name: 'Kitchen' }}
        canEditZones
        siblingCameras={[
          { id: 'camera', name: 'Kitchen' },
          { id: 'other', name: 'Porch' },
        ]}
      />,
    );
    const bar = screen.getByLabelText('Live view controls');
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Listen', 'Talk', 'More']);
    expect(
      screen.queryByRole('menuitem', { name: 'Full screen' }),
    ).not.toBeInTheDocument();
    openMore();
    for (const name of [
      'Save snapshot',
      'Full screen',
      'Picture fit',
      'Sleep timer',
      'Ignore areas',
    ])
      expect(
        screen.getByRole('menuitem', { name: new RegExp(name) }),
      ).toBeVisible();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('switches the picture between fit and fill and remembers the choice', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const { container } = render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />,
    );
    const frame = container.querySelector('.video-frame')!;
    expect(frame).not.toHaveClass('is-fill');
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: /Picture fit/ }));
    expect(frame).toHaveClass('is-fill');
    expect(screen.getByRole('menu')).toBeVisible();
    expect(window.localStorage.getItem('beacon.live.fill')).toBe('1');
    cleanup();
    const again = render(
      <LiveVideo camera={{ id: 'camera', name: 'Kitchen' }} />,
    );
    expect(again.container.querySelector('.video-frame')).toHaveClass(
      'is-fill',
    );
    window.localStorage.removeItem('beacon.live.fill');
  });
});
