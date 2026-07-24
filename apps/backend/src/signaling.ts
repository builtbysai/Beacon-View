import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { z } from 'zod';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

const candidateSchema = z.object({
  candidate: z.string().max(16_384),
  sdpMid: z.string().max(256).nullable(),
  sdpMLineIndex: z.number().int().min(0).max(128).nullable(),
});

const messageSchema = z.discriminatedUnion('type', [
  z.object({
    connectionId: z.string().uuid(),
    sdp: z.string().min(1).max(1_048_576),
    type: z.literal('offer'),
  }),
  z.object({
    connectionId: z.string().uuid(),
    sdp: z.string().min(1).max(1_048_576),
    type: z.literal('answer'),
  }),
  z.object({
    candidate: candidateSchema,
    connectionId: z.string().uuid(),
    type: z.literal('ice'),
  }),
  z.object({
    connectionId: z.string().uuid(),
    type: z.literal('connected'),
  }),
  z.object({
    connectionId: z.string().uuid(),
    type: z.literal('disconnect'),
  }),
]);

type SignalingMessage = z.infer<typeof messageSchema>;
type PeerRole = 'device' | 'viewer';

interface DevicePeer {
  cameraId: string;
  socket: WebSocket;
}

interface ActiveSession {
  cameraId: string;
  connectionId: string;
  device: WebSocket;
  viewer: WebSocket;
  timeout: NodeJS.Timeout | null;
}

export class SignalingHub {
  readonly #devices = new Map<string, DevicePeer>();
  readonly #sessions = new Map<string, ActiveSession>();

  constructor(
    private readonly viewerIceServers: IceServer[],
    private readonly deviceIceServers: IceServer[],
    private readonly negotiationTimeoutMs = 30_000,
  ) {}

  connectDevice(cameraId: string, socket: WebSocket): void {
    const existing = this.#devices.get(cameraId);
    if (existing) existing.socket.close(4001, 'Device connection replaced');
    this.#devices.set(cameraId, { cameraId, socket });
    this.#listen(socket, 'device', cameraId);
    socket.once('close', () => {
      if (this.#devices.get(cameraId)?.socket === socket) {
        this.#devices.delete(cameraId);
      }
      this.#cleanup(cameraId, socket, 'camera_disconnected');
    });
    this.#send(socket, { type: 'device-ready' });
  }

  connectViewer(cameraId: string, socket: WebSocket): boolean {
    const device = this.#devices.get(cameraId);
    if (!device) {
      this.#reject(socket, 'camera_unavailable');
      return false;
    }
    const existing = this.#sessions.get(cameraId);
    if (existing) {
      existing.viewer.close(4001, 'Viewer connection replaced');
      this.#cleanup(cameraId, existing.viewer, 'viewer_replaced');
    }
    const connectionId = randomUUID();
    const session: ActiveSession = {
      cameraId,
      connectionId,
      device: device.socket,
      timeout: null,
      viewer: socket,
    };
    session.timeout = setTimeout(() => {
      this.#cleanup(cameraId, undefined, 'negotiation_timeout');
    }, this.negotiationTimeoutMs);
    session.timeout.unref();
    this.#sessions.set(cameraId, session);
    this.#listen(socket, 'viewer', cameraId);
    socket.once('close', () => {
      this.#cleanup(cameraId, socket, 'viewer_disconnected');
    });
    this.#send(device.socket, {
      connectionId,
      iceServers: this.deviceIceServers,
      type: 'viewer-ready',
    });
    this.#send(socket, {
      connectionId,
      iceServers: this.viewerIceServers,
      type: 'ready',
    });
    return true;
  }

  close(): void {
    for (const cameraId of this.#sessions.keys()) {
      this.#cleanup(cameraId, undefined, 'server_shutdown');
    }
    for (const peer of this.#devices.values()) {
      peer.socket.close(1001, 'Server shutdown');
    }
    this.#devices.clear();
  }

  get activeSessionCount(): number {
    return this.#sessions.size;
  }

  #listen(socket: WebSocket, role: PeerRole, cameraId: string): void {
    socket.on('message', (data) => {
      if (typeof data !== 'string' && !Buffer.isBuffer(data)) return;
      const raw = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      if (Buffer.byteLength(raw, 'utf8') > 1_100_000) {
        socket.close(1009, 'Message too large');
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        this.#send(socket, { code: 'invalid_message', type: 'error' });
        return;
      }
      const parsed = messageSchema.safeParse(decoded);
      if (!parsed.success) {
        this.#send(socket, { code: 'invalid_message', type: 'error' });
        return;
      }
      this.#forward(role, cameraId, socket, parsed.data);
    });
  }

  #forward(
    role: PeerRole,
    cameraId: string,
    socket: WebSocket,
    message: SignalingMessage,
  ): void {
    const session = this.#sessions.get(cameraId);
    if (
      !session ||
      message.connectionId !== session.connectionId ||
      (role === 'device' && session.device !== socket) ||
      (role === 'viewer' && session.viewer !== socket)
    ) {
      this.#send(socket, { code: 'invalid_connection', type: 'error' });
      return;
    }
    const allowed =
      role === 'device'
        ? ['offer', 'ice', 'connected', 'disconnect']
        : ['answer', 'ice', 'connected', 'disconnect'];
    if (!allowed.includes(message.type)) {
      this.#send(socket, { code: 'invalid_message', type: 'error' });
      return;
    }
    if (message.type === 'connected' && role === 'device' && session.timeout) {
      clearTimeout(session.timeout);
      session.timeout = null;
    }
    if (message.type === 'disconnect') {
      this.#cleanup(cameraId, socket, 'peer_disconnected');
      return;
    }
    this.#send(role === 'device' ? session.viewer : session.device, message);
  }

  #cleanup(
    cameraId: string,
    source: WebSocket | undefined,
    code: string,
  ): void {
    const session = this.#sessions.get(cameraId);
    if (!session) return;
    if (source && source !== session.viewer && source !== session.device) {
      return;
    }
    this.#sessions.delete(cameraId);
    if (session.timeout) clearTimeout(session.timeout);
    for (const socket of [session.viewer, session.device]) {
      if (socket !== source) this.#send(socket, { code, type: 'peer-left' });
    }
    if (code === 'negotiation_timeout' || code === 'server_shutdown') {
      session.viewer.close(4000, 'Signaling session ended');
    }
  }

  #reject(socket: WebSocket, code: string): void {
    this.#send(socket, { code, type: 'error' });
    socket.close(4003, 'Connection rejected');
  }

  #send(socket: WebSocket, message: object): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
