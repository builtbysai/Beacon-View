type ProducerState =
  'offline' | 'reconnecting' | 'waiting' | 'streaming' | 'error';

interface ViewerReady {
  canListen: boolean;
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
  | {
      connectionId: string;
      iceServers: RTCIceServer[];
      type: 'ice-restart';
    }
  | { cameraId: string; type: 'switch-source' }
  | { active: boolean; connectionId: string; type: 'talk-state' }
  | { type: 'device-ready' };

/** A ready stream (always-on camera), or a function that turns the camera on
 * when the first viewer arrives (standby camera). The function is called for
 * every new viewer, so it must return the already-open stream if there is
 * one. */
export type StreamSource = MediaStream | (() => Promise<MediaStream>);

function producerUrl(cameraId: string): string {
  const url = new URL('/api/signaling', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'producer');
  url.searchParams.set('cameraId', cameraId);
  return url.toString();
}

export class BrowserProducer {
  readonly #peers = new Map<string, RTCPeerConnection>();
  /** Talk audio from each viewer, muted until the server grants that viewer
   * the single talk floor (ADR 0015). */
  readonly #talkAudio = new Map<string, HTMLAudioElement>();
  readonly #talking = new Set<string>();
  #socket: WebSocket | null = null;
  #stopped = true;
  #retry = 0;
  #timer: number | null = null;
  #generation = 0;

  constructor(
    private readonly cameraId: string,
    private readonly source: StreamSource,
    private readonly onState: (
      state: ProducerState,
      viewerCount: number,
      retryCount: number,
    ) => void,
    private readonly onSourceSwitch: (cameraId: string) => void = () =>
      undefined,
    private readonly onWakeError: (error: unknown) => void = () => undefined,
    /** Someone is (or stopped) talking through this camera. Camera Mode
     * shows it, so incoming audio is never silent to the person here. */
    private readonly onTalking: (talking: boolean) => void = () => undefined,
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
      this.#dropTalk(connectionId);
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
        this.#generation += 1;
        this.#socket = null;
        for (const peer of this.#peers.values()) peer.close();
        this.#peers.clear();
        this.onState('error', 0, this.#retry);
        return;
      }
      this.#reconnect('reconnecting');
    };
  }

  async #handle(message: ProducerMessage): Promise<void> {
    if (message.type === 'viewer-ready') {
      const generation = this.#generation;
      let stream: MediaStream;
      try {
        stream =
          typeof this.source === 'function' ? await this.source() : this.source;
      } catch (error) {
        // The camera could not turn on (busy, unplugged, or permission
        // revoked). End just this viewer's attempt; the camera stays
        // connected and on standby for the next one.
        this.#send({ connectionId: message.connectionId, type: 'disconnect' });
        this.onWakeError(error);
        return;
      }
      // Turning the camera on takes a moment; the socket may have closed or
      // reconnected meanwhile, which makes this connection ID stale.
      if (this.#stopped || generation !== this.#generation) return;
      const peer = new RTCPeerConnection({
        iceServers: message.iceServers,
        iceTransportPolicy: message.iceTransportPolicy,
      });
      this.#peers.set(message.connectionId, peer);
      for (const track of stream.getVideoTracks()) {
        peer.addTrack(track, stream);
      }
      // Always negotiate one audio section so the viewer can Talk. It carries
      // this camera's sound only when the camera shares it and the viewer
      // may Listen; otherwise it only receives.
      const audioTrack = message.canListen
        ? stream.getAudioTracks()[0]
        : undefined;
      if (audioTrack)
        peer.addTransceiver(audioTrack, {
          direction: 'sendrecv',
          streams: [stream],
        });
      else peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.ontrack = (event) => {
        if (event.track.kind === 'audio')
          this.#playTalk(message.connectionId, event.track);
      };
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
    if (message.type === 'ice-restart') {
      // The viewer's network changed or its relay credentials ran out: use the
      // fresh servers and offer again with new ICE credentials (V21, V65).
      const peer = this.#peers.get(message.connectionId);
      if (!peer) return;
      peer.setConfiguration({
        ...peer.getConfiguration(),
        iceServers: message.iceServers,
      });
      const offer = await peer.createOffer({ iceRestart: true });
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
      return;
    }
    if (message.type === 'talk-state') {
      this.#setTalking(message.connectionId, message.active);
    }
  }

  #playTalk(connectionId: string, track: MediaStreamTrack): void {
    this.#talkAudio.get(connectionId)?.remove();
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = !this.#talking.has(connectionId);
    audio.srcObject = new MediaStream([track]);
    this.#talkAudio.set(connectionId, audio);
    void Promise.resolve(audio.play()).catch(() => undefined);
  }

  #setTalking(connectionId: string, active: boolean): void {
    const wasTalking = this.#talking.size > 0;
    if (active) this.#talking.add(connectionId);
    else this.#talking.delete(connectionId);
    const audio = this.#talkAudio.get(connectionId);
    if (audio) {
      audio.muted = !active;
      if (active) void Promise.resolve(audio.play()).catch(() => undefined);
    }
    if (wasTalking !== this.#talking.size > 0)
      this.onTalking(this.#talking.size > 0);
  }

  #dropTalk(connectionId: string): void {
    this.#setTalking(connectionId, false);
    const audio = this.#talkAudio.get(connectionId);
    if (audio) {
      audio.muted = true;
      audio.srcObject = null;
    }
    this.#talkAudio.delete(connectionId);
  }

  #closePeer(connectionId: string): void {
    this.#peers.get(connectionId)?.close();
    this.#peers.delete(connectionId);
    this.#dropTalk(connectionId);
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
    for (const [connectionId, peer] of this.#peers) {
      peer.close();
      this.#dropTalk(connectionId);
    }
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
