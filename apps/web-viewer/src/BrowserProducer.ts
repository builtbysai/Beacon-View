type ProducerState =
  'offline' | 'reconnecting' | 'waiting' | 'streaming' | 'error';

interface ViewerReady {
  connectionId: string;
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
  type: 'viewer-ready';
}

type ProducerMessage =
  | ViewerReady
  | { connectionId: string; sdp: string; type: 'answer' }
  | {
      candidate: RTCIceCandidateInit;
      connectionId: string;
      type: 'ice';
    }
  | { code: string; connectionId?: string; type: 'peer-left' | 'error' }
  | { cameraId: string; type: 'switch-source' }
  | { type: 'device-ready' };

function producerUrl(cameraId: string): string {
  const url = new URL('/api/signaling', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'producer');
  url.searchParams.set('cameraId', cameraId);
  return url.toString();
}

export class BrowserProducer {
  readonly #peers = new Map<string, RTCPeerConnection>();
  #socket: WebSocket | null = null;
  #stopped = true;
  #retry = 0;
  #timer: number | null = null;
  #generation = 0;

  constructor(
    private readonly cameraId: string,
    private readonly stream: MediaStream,
    private readonly onState: (
      state: ProducerState,
      viewerCount: number,
      retryCount: number,
    ) => void,
    private readonly onSourceSwitch: (cameraId: string) => void = () =>
      undefined,
  ) {}

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#generation += 1;
    if (this.#timer !== null) window.clearTimeout(this.#timer);
    this.#timer = null;
    for (const [connectionId, peer] of this.#peers) {
      this.#send({ connectionId, type: 'disconnect' });
      peer.close();
    }
    this.#peers.clear();
    this.#socket?.close(1000, 'Camera mode stopped');
    this.#socket = null;
    this.onState('offline', 0, this.#retry);
  }

  #connect(): void {
    if (this.#stopped || this.#socket) return;
    const generation = ++this.#generation;
    this.onState(
      this.#retry === 0 ? 'waiting' : 'reconnecting',
      this.#peers.size,
      this.#retry,
    );
    const socket = new WebSocket(producerUrl(this.cameraId));
    this.#socket = socket;
    socket.onopen = () => {
      if (generation !== this.#generation) return;
      this.#retry = 0;
      this.onState('waiting', this.#peers.size, 0);
    };
    socket.onmessage = (event) => {
      if (generation !== this.#generation || typeof event.data !== 'string')
        return;
      void this.#handle(JSON.parse(event.data) as ProducerMessage).catch(() => {
        this.#reconnect('error');
      });
    };
    socket.onerror = () => this.#reconnect('reconnecting');
    socket.onclose = (event) => {
      if (event.code === 4003) {
        this.#stopped = true;
        this.onState('error', this.#peers.size, this.#retry);
        return;
      }
      this.#reconnect('reconnecting');
    };
  }

  async #handle(message: ProducerMessage): Promise<void> {
    if (message.type === 'viewer-ready') {
      const peer = new RTCPeerConnection({
        iceServers: message.iceServers,
        iceTransportPolicy: message.iceTransportPolicy,
      });
      this.#peers.set(message.connectionId, peer);
      for (const track of this.stream.getVideoTracks()) {
        peer.addTrack(track, this.stream);
      }
      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        this.#send({
          candidate: event.candidate.toJSON(),
          connectionId: message.connectionId,
          type: 'ice',
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          this.#send({
            connectionId: message.connectionId,
            type: 'connected',
          });
          this.onState('streaming', this.#peers.size, this.#retry);
        } else if (
          peer.connectionState === 'failed' ||
          peer.connectionState === 'closed'
        ) {
          this.#closePeer(message.connectionId);
        }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      this.#send({
        connectionId: message.connectionId,
        sdp: offer.sdp,
        type: 'offer',
      });
      return;
    }
    if (message.type === 'answer') {
      await this.#peers.get(message.connectionId)?.setRemoteDescription({
        sdp: message.sdp,
        type: 'answer',
      });
      return;
    }
    if (message.type === 'ice') {
      await this.#peers
        .get(message.connectionId)
        ?.addIceCandidate(message.candidate);
      return;
    }
    if (message.type === 'peer-left' && message.connectionId) {
      this.#closePeer(message.connectionId);
      return;
    }
    if (message.type === 'switch-source') {
      this.onSourceSwitch(message.cameraId);
    }
  }

  #closePeer(connectionId: string): void {
    this.#peers.get(connectionId)?.close();
    this.#peers.delete(connectionId);
    this.onState(
      this.#peers.size > 0 ? 'streaming' : 'waiting',
      this.#peers.size,
      this.#retry,
    );
  }

  #reconnect(state: ProducerState): void {
    if (this.#stopped || this.#timer !== null) return;
    this.#generation += 1;
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    for (const peer of this.#peers.values()) peer.close();
    this.#peers.clear();
    const attempt = this.#retry++;
    const delay = Math.min(1_000 * 2 ** Math.min(attempt, 4), 16_000);
    this.onState(state, 0, this.#retry);
    this.#timer = window.setTimeout(() => {
      this.#timer = null;
      this.#connect();
    }, delay);
  }

  #send(message: object): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message));
    }
  }
}
