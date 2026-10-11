import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserProducer } from './BrowserProducer';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = FakeSocket.OPEN;
  sent: object[] = [];

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }

  emit(message: object) {
    this.onmessage?.({
      data: JSON.stringify(message),
    } as MessageEvent);
  }

  open() {
    this.onopen?.();
  }

  send(raw: string) {
    this.sent.push(JSON.parse(raw) as object);
  }
}

class FakePeer {
  static instances: FakePeer[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  closed = false;

  constructor() {
    FakePeer.instances.push(this);
  }

  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  transceivers: Array<{ direction: string; kind: string }> = [];
  addTrack() {}
  addTransceiver(
    trackOrKind: MediaStreamTrack | string,
    init: { direction: string },
  ) {
    this.transceivers.push({
      direction: init.direction,
      kind: typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind,
    });
  }
  addIceCandidate() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }
  configurations: object[] = [];
  offerOptions: object[] = [];
  getConfiguration() {
    return {};
  }
  setConfiguration(configuration: object) {
    this.configurations.push(configuration);
  }
  createOffer(options?: object) {
    this.offerOptions.push(options ?? {});
    return Promise.resolve({ sdp: 'sanitized-offer', type: 'offer' as const });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription() {
    return Promise.resolve();
  }
}

const stream = {
  getAudioTracks: () => [],
  getVideoTracks: () => [{ id: 'shared-track' }],
} as unknown as MediaStream;

afterEach(() => {
  FakeSocket.instances = [];
  FakePeer.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BrowserProducer', () => {
  it('keeps independent peers for simultaneous viewers', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const states: Array<[string, number]> = [];
    const producer = new BrowserProducer(
      '00000000-0000-4000-8000-000000000001',
      stream,
      (state, viewers) => states.push([state, viewers]),
    );
    producer.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit({
      connectionId: '00000000-0000-4000-8000-000000000011',
      iceServers: [],
      iceTransportPolicy: 'all',
      type: 'viewer-ready',
    });
    socket.emit({
      connectionId: '00000000-0000-4000-8000-000000000012',
      iceServers: [],
      iceTransportPolicy: 'all',
      type: 'viewer-ready',
    });
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(2));

    FakePeer.instances[0]!.connectionState = 'connected';
    FakePeer.instances[0]!.onconnectionstatechange?.();
    FakePeer.instances[1]!.connectionState = 'connected';
    FakePeer.instances[1]!.onconnectionstatechange?.();
    socket.emit({
      code: 'viewer_disconnected',
      connectionId: '00000000-0000-4000-8000-000000000011',
      type: 'peer-left',
    });

    expect(FakePeer.instances[0]!.closed).toBe(true);
    expect(FakePeer.instances[1]!.closed).toBe(false);
    expect(states.at(-1)).toEqual(['streaming', 1]);
    producer.stop();
  });

  it('offers again with fresh servers and an ICE restart when the viewer asks (V21, V65)', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const producer = new BrowserProducer(
      '00000000-0000-4000-8000-000000000001',
      stream,
      () => undefined,
    );
    producer.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    const connectionId = '00000000-0000-4000-8000-000000000011';
    socket.emit({
      connectionId,
      iceServers: [],
      iceTransportPolicy: 'all',
      type: 'viewer-ready',
    });
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    socket.emit({
      connectionId,
      iceServers: [{ urls: 'turn:fresh' }],
      type: 'ice-restart',
    });
    const peer = FakePeer.instances[0]!;
    await vi.waitFor(() => expect(peer.offerOptions).toHaveLength(2));
    expect(peer.offerOptions[1]).toEqual({ iceRestart: true });
    expect(peer.configurations).toEqual([
      { iceServers: [{ urls: 'turn:fresh' }] },
    ]);
    expect(socket.sent.at(-1)).toMatchObject({ connectionId, type: 'offer' });
    producer.stop();
  });

  it('cancels a stale reconnect when stopped', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const producer = new BrowserProducer('camera', stream, () => undefined);
    producer.start();
    FakeSocket.instances[0]!.onerror?.();
    producer.stop();
    vi.runAllTimers();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('forwards a managed source switch without creating a reconnect loop', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const switchSource = vi.fn();
    const producer = new BrowserProducer(
      'rear-camera',
      stream,
      () => undefined,
      switchSource,
    );
    producer.start();
    FakeSocket.instances[0]!.emit({
      cameraId: 'front-camera',
      type: 'switch-source',
    });

    expect(switchSource).toHaveBeenCalledWith('front-camera');
    expect(FakeSocket.instances).toHaveLength(1);
    producer.stop();
  });

  it('closes active peers and does not reconnect after authorization is lost', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const states: Array<[string, number]> = [];
    const producer = new BrowserProducer('camera', stream, (state, viewers) =>
      states.push([state, viewers]),
    );
    producer.start();
    const socket = FakeSocket.instances[0]!;
    socket.emit({
      connectionId: 'connection-one',
      iceServers: [],
      iceTransportPolicy: 'all',
      type: 'viewer-ready',
    });
    await Promise.resolve();
    socket.close(4003);
    expect(FakePeer.instances[0]?.closed).toBe(true);
    expect(states.at(-1)).toEqual(['error', 0]);
    vi.runAllTimers();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('turns a standby camera on only when a viewer arrives', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const wake = vi.fn().mockResolvedValue(stream);
    const producer = new BrowserProducer('camera', wake, () => undefined);
    producer.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    expect(wake).not.toHaveBeenCalled();
    socket.emit({
      connectionId: 'viewer-one',
      iceServers: [],
      iceTransportPolicy: 'all',
      type: 'viewer-ready',
    });
    await vi.waitFor(() =>
      expect(socket.sent).toContainEqual(
        expect.objectContaining({ connectionId: 'viewer-one', type: 'offer' }),
      ),
    );
    expect(wake).toHaveBeenCalledTimes(1);
    producer.stop();
  });

  it('ends only that viewer when the camera cannot wake', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const failure = new DOMException('busy', 'NotReadableError');
    const onWakeError = vi.fn();
    const producer = new BrowserProducer(
      'camera',
      () => Promise.reject(failure),
      () => undefined,
      undefined,
      onWakeError,
    );
    producer.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit({
      connectionId: 'viewer-one',
      iceServers: [],
      iceTransportPolicy: 'all',
      type: 'viewer-ready',
    });
    await vi.waitFor(() => expect(onWakeError).toHaveBeenCalledWith(failure));
    expect(socket.sent).toContainEqual({
      connectionId: 'viewer-one',
      type: 'disconnect',
    });
    expect(FakePeer.instances).toHaveLength(0);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    producer.stop();
  });

  it('drops a wake that finishes after the socket reconnected', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    let finishWake: (value: MediaStream) => void = () => undefined;
    const producer = new BrowserProducer(
      'camera',
      () => new Promise<MediaStream>((resolve) => (finishWake = resolve)),
      () => undefined,
    );
    producer.start();
    const first = FakeSocket.instances[0]!;
    first.emit({
      connectionId: 'stale-viewer',
      iceServers: [],
      iceTransportPolicy: 'all',
      type: 'viewer-ready',
    });
    first.onerror?.();
    finishWake(stream);
    await Promise.resolve();
    await Promise.resolve();
    expect(FakePeer.instances).toHaveLength(0);
    producer.stop();
  });

  it('always offers an audio section so a viewer can Talk, sending sound only when shared', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const withSound = {
      getAudioTracks: () => [{ kind: 'audio' }],
      getVideoTracks: () => [{ id: 'video' }],
    } as unknown as MediaStream;
    for (const [source, canListen, direction] of [
      [stream, true, 'recvonly'],
      [withSound, true, 'sendrecv'],
      [withSound, false, 'recvonly'],
    ] as const) {
      FakePeer.instances = [];
      FakeSocket.instances = [];
      const producer = new BrowserProducer('camera', source, () => undefined);
      producer.start();
      FakeSocket.instances[0]!.emit({
        canListen,
        connectionId: 'viewer',
        iceServers: [],
        iceTransportPolicy: 'all',
        type: 'viewer-ready',
      });
      await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
      expect(FakePeer.instances[0]!.transceivers).toEqual([
        { direction, kind: 'audio' },
      ]);
      producer.stop();
    }
  });

  it('plays Talk audio only while the server grants that viewer the floor', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    vi.stubGlobal(
      'MediaStream',
      class {
        constructor(readonly tracks: unknown[]) {}
      },
    );
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const talking: boolean[] = [];
    const producer = new BrowserProducer(
      'camera',
      stream,
      () => undefined,
      undefined,
      undefined,
      (active) => talking.push(active),
    );
    producer.start();
    const socket = FakeSocket.instances[0]!;
    socket.emit({
      canListen: true,
      connectionId: 'viewer',
      iceServers: [],
      iceTransportPolicy: 'all',
      type: 'viewer-ready',
    });
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    const created: HTMLAudioElement[] = [];
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = original(tag);
      if (tag === 'audio') created.push(element as HTMLAudioElement);
      return element;
    });
    FakePeer.instances[0]!.ontrack?.({
      track: { kind: 'audio' },
    } as unknown as RTCTrackEvent);
    expect(created[0]!.muted).toBe(true);
    socket.emit({ active: true, connectionId: 'viewer', type: 'talk-state' });
    await vi.waitFor(() => expect(created[0]!.muted).toBe(false));
    socket.emit({ active: false, connectionId: 'viewer', type: 'talk-state' });
    await vi.waitFor(() => expect(created[0]!.muted).toBe(true));
    expect(talking).toEqual([true, false]);
    producer.stop();
  });
});
