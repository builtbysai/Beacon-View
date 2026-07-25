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
  z.object({ connectionId: z.string().uuid(), type: z.literal('connected') }),
  z.object({ connectionId: z.string().uuid(), type: z.literal('disconnect') }),
]);

type SignalingMessage = z.infer<typeof messageSchema>;
type PeerRole = 'device' | 'viewer';

interface DevicePeer {
  householdId?: string | undefined;
  publicCameraId: string;
  socket: WebSocket;
}

interface ActiveSession {
  cameraId: string;
  connectionId: string;
  device: WebSocket;
  publicCameraId: string;
  startedAt: number;
  timeout: NodeJS.Timeout | null;
  viewer: WebSocket;
}

export interface SignalingDiagnostic {
  connectionId?: string;
  durationMs?: number;
  event:
    | 'connected'
    | 'device_ready'
    | 'session_ended'
    | 'stale_connection_replaced'
    | 'viewer_ready';
  publicCameraId: string;
  reasonCode?: string;
  role?: PeerRole;
}

/**
 * Signaling state is indexed by connection ID, not camera ID. A camera keeps one
 * authenticated device socket and may negotiate independent peer connections
 * for multiple viewers without replacing an existing viewer.
 */
export class SignalingHub {
  readonly #devices = new Map<string, DevicePeer>();
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #cameraSessions = new Map<string, Set<string>>();

  constructor(
    private readonly createViewerIceServers: () => IceServer[],
    private readonly createDeviceIceServers: () => IceServer[],
    private readonly negotiationTimeoutMs = 30_000,
    private readonly iceTransportPolicy: 'all' | 'relay' = 'all',
    private readonly onDiagnostic: (
      diagnostic: SignalingDiagnostic,
    ) => void = () => undefined,
    private readonly onProducerState: (
      householdId: string,
      publicCameraId: string,
      connected: boolean,
    ) => void = () => undefined,
  ) {}

  connectDevice(
    cameraId: string,
    publicCameraId: string,
    socket: WebSocket,
    householdId?: string,
  ): void {
    const existing = this.#devices.get(cameraId);
    if (existing) {
      this.#cleanupCamera(cameraId, 'device_replaced');
      this.onDiagnostic({
        event: 'stale_connection_replaced',
        publicCameraId,
        reasonCode: 'authenticated_reconnect',
        role: 'device',
      });
    }
    this.#devices.set(cameraId, { householdId, publicCameraId, socket });
    if (existing) existing.socket.close(4001, 'Device connection replaced');
    this.#listen(socket, 'device');
    socket.once('close', () => {
      if (this.#devices.get(cameraId)?.socket !== socket) return;
      this.#devices.delete(cameraId);
      this.#cleanupCamera(cameraId, 'camera_disconnected');
      if (householdId) this.onProducerState(householdId, publicCameraId, false);
    });
    this.#send(socket, { type: 'device-ready' });
    this.onDiagnostic({
      event: 'device_ready',
      publicCameraId,
      role: 'device',
    });
    if (householdId) this.onProducerState(householdId, publicCameraId, true);
  }

  connectViewer(
    cameraId: string,
    publicCameraId: string,
    socket: WebSocket,
  ): boolean {
    const device = this.#devices.get(cameraId);
    if (!device) {
      this.#reject(socket, 'camera_unavailable');
      return false;
    }
    const connectionId = randomUUID();
    const session: ActiveSession = {
      cameraId,
      connectionId,
      device: device.socket,
      publicCameraId,
      startedAt: Date.now(),
      timeout: null,
      viewer: socket,
    };
    session.timeout = setTimeout(
      () => this.#cleanup(connectionId, undefined, 'negotiation_timeout'),
      this.negotiationTimeoutMs,
    );
    session.timeout.unref();
    this.#sessions.set(connectionId, session);
    const cameraSessions = this.#cameraSessions.get(cameraId) ?? new Set();
    cameraSessions.add(connectionId);
    this.#cameraSessions.set(cameraId, cameraSessions);
    this.#listen(socket, 'viewer');
    socket.once('close', () =>
      this.#cleanup(connectionId, socket, 'viewer_disconnected'),
    );
    this.#send(device.socket, {
      connectionId,
      iceServers: this.createDeviceIceServers(),
      iceTransportPolicy: this.iceTransportPolicy,
      type: 'viewer-ready',
    });
    this.#send(socket, {
      connectionId,
      iceServers: this.createViewerIceServers(),
      iceTransportPolicy: this.iceTransportPolicy,
      type: 'ready',
    });
    this.onDiagnostic({
      connectionId,
      event: 'viewer_ready',
      publicCameraId,
      role: 'viewer',
    });
    return true;
  }

  close(): void {
    for (const connectionId of [...this.#sessions.keys()]) {
      this.#cleanup(connectionId, undefined, 'server_shutdown');
    }
    for (const peer of this.#devices.values()) {
      peer.socket.close(1001, 'Server shutdown');
    }
    this.#devices.clear();
  }

  get activeSessionCount(): number {
    return this.#sessions.size;
  }

  cameraStatus(publicCameraId: string): {
    producerConnected: boolean;
    viewerCount: number;
    connectionIds: string[];
  } {
    const sessions = [...this.#sessions.values()].filter(
      (session) => session.publicCameraId === publicCameraId,
    );
    return {
      connectionIds: sessions.map((session) => session.connectionId),
      producerConnected: [...this.#devices.values()].some(
        (device) => device.publicCameraId === publicCameraId,
      ),
      viewerCount: sessions.length,
    };
  }

  #listen(socket: WebSocket, role: PeerRole): void {
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
      this.#forward(role, socket, parsed.data);
    });
  }

  #forward(role: PeerRole, socket: WebSocket, message: SignalingMessage): void {
    const session = this.#sessions.get(message.connectionId);
    if (
      !session ||
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
      this.onDiagnostic({
        connectionId: session.connectionId,
        event: 'connected',
        publicCameraId: session.publicCameraId,
        role,
      });
    }
    if (message.type === 'disconnect') {
      this.#cleanup(message.connectionId, socket, 'peer_disconnected');
      return;
    }
    this.#send(role === 'device' ? session.viewer : session.device, message);
  }

  #cleanupCamera(cameraId: string, code: string): void {
    for (const connectionId of [
      ...(this.#cameraSessions.get(cameraId) ?? []),
    ]) {
      this.#cleanup(connectionId, undefined, code);
    }
  }

  #cleanup(
    connectionId: string,
    source: WebSocket | undefined,
    code: string,
  ): void {
    const session = this.#sessions.get(connectionId);
    if (!session) return;
    if (source && source !== session.viewer && source !== session.device)
      return;
    this.#sessions.delete(connectionId);
    const cameraSessions = this.#cameraSessions.get(session.cameraId);
    cameraSessions?.delete(connectionId);
    if (cameraSessions?.size === 0)
      this.#cameraSessions.delete(session.cameraId);
    if (session.timeout) clearTimeout(session.timeout);
    this.onDiagnostic({
      connectionId,
      durationMs: Date.now() - session.startedAt,
      event: 'session_ended',
      publicCameraId: session.publicCameraId,
      reasonCode: code,
    });
    for (const socket of [session.viewer, session.device]) {
      if (socket !== source)
        this.#send(socket, { code, connectionId, type: 'peer-left' });
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
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
