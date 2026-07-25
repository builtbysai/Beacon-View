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

  addTrack() {}
  addIceCandidate() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }
  createOffer() {
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
});
