import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveVideo } from './LiveVideo';

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

class FakePeer {
  static instances: FakePeer[] = [];
  connectionState = 'new';
  onconnectionstatechange: (() => void) | null = null;
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LiveVideo', () => {
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
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn privacy off' }));
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Front' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Front' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Front' }));
    expect(onSelectCamera).toHaveBeenCalledOnce();
    await act(async () => {
      reject(new Error('Offline'));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your current view remains selected',
    );
    expect(screen.getByRole('heading', { name: 'Rear' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Front' })).toBeEnabled();
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
    expect(screen.queryByText(/record/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
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
      'Your microphone is off',
    );
    unmount();
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
    expect(screen.getByRole('button', { name: /TURN relay/ })).toBeVisible();
    expect(screen.getByText('Starting secure video')).toBeVisible();
    fireEvent.loadedData(container.querySelector('video')!);
    expect(screen.queryByText('Starting secure video')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /TURN relay/ }));
    expect(screen.getByLabelText('Live stream quality')).toBeVisible();
    getStats.mockRejectedValueOnce(new Error('Peer closed'));
    await act(async () => {
      peer.onconnectionstatechange?.();
      await Promise.resolve();
    });
    expect(screen.getByText('Connection: connected')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /TURN relay/ }),
    ).not.toBeInTheDocument();
  });
});
