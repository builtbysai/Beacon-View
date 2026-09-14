export type TalkState =
  | 'idle'
  | 'permission'
  | 'connecting'
  | 'speaking'
  | 'busy'
  | 'unavailable'
  | 'recovering';

/** One explicit microphone consent belongs to one live connection only. */
export class TalkSession {
  private generation = 0;
  private stream: MediaStream | null = null;
  private sender: RTCRtpSender | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private requested = false;
  private disposed = false;
  private state: TalkState = 'idle';

  constructor(
    private readonly connectionId: string,
    private readonly peer: RTCPeerConnection,
    private readonly send: (message: {
      connectionId: string;
      type: 'talk-request' | 'talk-release';
    }) => void,
    private readonly onState: (state: TalkState) => void,
  ) {}

  private update(state: TalkState) {
    this.state = state;
    this.onState(state);
  }

  async start(): Promise<void> {
    if (
      this.disposed ||
      this.state === 'permission' ||
      this.state === 'connecting' ||
      this.state === 'speaking'
    )
      return;
    const transceiver = this.peer
      .getTransceivers()
      .find(
        (candidate) =>
          candidate.receiver.track.kind === 'audio' &&
          (candidate.currentDirection === 'sendonly' ||
            candidate.currentDirection === 'sendrecv'),
      );
    if (
      !transceiver ||
      this.peer.connectionState !== 'connected' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.update('unavailable');
      return;
    }
    const current = ++this.generation;
    this.update('permission');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (this.disposed || current !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === 'ended')
        throw new Error('Microphone unavailable');
      // No microphone audio leaves the viewer until the server grants ownership.
      stream.getTracks().forEach((item) => {
        item.enabled = false;
      });
      track.onended = () => this.stop('unavailable');
      this.sender = transceiver.sender;
      await this.sender.replaceTrack(track);
      if (this.disposed || current !== this.generation) return;
      this.requested = true;
      this.update('connecting');
      this.timer = setTimeout(() => this.stop('unavailable'), 10_000);
      this.send({ connectionId: this.connectionId, type: 'talk-request' });
    } catch {
      if (current === this.generation && !this.disposed)
        this.stop('unavailable');
    }
  }

  receive(message: {
    connectionId: string;
    active: boolean;
    reason?: 'busy' | 'not_allowed';
  }) {
    if (this.disposed || message.connectionId !== this.connectionId) return;
    if (message.active && this.requested && this.stream) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      this.update('speaking');
    } else if (!message.active && this.requested) {
      this.stop(
        message.reason === 'busy'
          ? 'busy'
          : message.reason === 'not_allowed'
            ? 'unavailable'
            : 'idle',
      );
    } else if (message.active) {
      // A grant can race with Stop or a dismissed permission request.
      this.send({ connectionId: this.connectionId, type: 'talk-release' });
    }
  }

  stop(state: TalkState = 'idle') {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.enabled = false;
      track.stop();
    });
    this.stream = null;
    void this.sender?.replaceTrack(null).catch(() => undefined);
    this.sender = null;
    const wasRequested = this.requested;
    this.requested = false;
    this.update(state);
    if (wasRequested) {
      try {
        this.send({ connectionId: this.connectionId, type: 'talk-release' });
      } catch {
        /* Disconnected transport; capture is already stopped. */
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.stop(
      this.state === 'permission' ||
        this.state === 'connecting' ||
        this.state === 'speaking'
        ? 'recovering'
        : this.state,
    );
  }
}
