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
  z.object({
    connectionId: z.string().uuid(),
    type: z.literal('ice-restart'),
  }),
  z.object({
    connectionId: z.string().uuid(),
    type: z.literal('talk-request'),
  }),
  z.object({
    connectionId: z.string().uuid(),
    type: z.literal('talk-release'),
  }),
]);

type SignalingMessage = z.infer<typeof messageSchema>;
type PeerRole = 'device' | 'viewer';

/** Live-view limits (V20). A session description is a few kilobytes and
 * trickled ICE candidates arrive in tens, so these leave real use alone. */
const MAX_VIEWERS_PER_CAMERA = 8;
const MAX_MESSAGE_BYTES = 131_072;
const MESSAGE_WINDOW_MS = 10_000;
/** A viewer may ask for an ICE restart this often (V21, V65). */
const MIN_ICE_RESTART_INTERVAL_MS = 5_000;
const MAX_MESSAGES_PER_WINDOW = 200;

interface DevicePeer {
  householdId?: string | undefined;
  publicCameraId: string;
  socket: WebSocket;
}

interface ActiveSession {
  canListen: boolean;
  canTalk: boolean;
  cameraId: string;
  connected: boolean;
  connectionId: string;
  device: WebSocket;
  householdId?: string | undefined;
  publicCameraId: string;
  sessionId?: string | undefined;
  lastIceRestartAt: number;
  startedAt: number;
  timeout: NodeJS.Timeout | null;
  viewer: WebSocket;
}

interface SignalingDiagnostic {
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
  readonly #talkOwners = new Map<string, string>();

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
    private readonly onViewerState: (
      householdId: string,
      publicCameraId: string,
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
    canTalk = true,
    sessionId?: string,
    canListen = true,
  ): boolean {
    const device = this.#devices.get(cameraId);
    if (!device) {
      // Not 4003: the apps read that as "your authorization was lost" and sign
      // the person out, but this camera is simply offline or paused (V67).
      this.#reject(socket, 'camera_unavailable', 4004);
      return false;
    }
    // One camera phone can encode and upload only so many streams (V20).
    if (
      (this.#cameraSessions.get(cameraId)?.size ?? 0) >= MAX_VIEWERS_PER_CAMERA
    ) {
      this.#reject(socket, 'camera_busy', 4008);
      return false;
    }
    const connectionId = randomUUID();
    const session: ActiveSession = {
      canListen,
      canTalk,
      cameraId,
      connected: false,
      connectionId,
      device: device.socket,
      householdId: device.householdId,
      publicCameraId,
      sessionId,
      lastIceRestartAt: 0,
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
      canListen: session.canListen,
      connectionId,
      iceServers: this.createDeviceIceServers(),
      iceTransportPolicy: this.iceTransportPolicy,
      type: 'viewer-ready',
    });
    this.#send(socket, {
      canListen: session.canListen,
      canTalk: session.canTalk,
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
      (session) =>
        session.publicCameraId === publicCameraId && session.connected,
    );
    return {
      connectionIds: sessions.map((session) => session.connectionId),
      producerConnected: [...this.#devices.values()].some(
        (device) => device.publicCameraId === publicCameraId,
      ),
      viewerCount: sessions.length,
    };
  }

  disconnectCamera(
    publicCameraId: string,
    reasonCode:
      | 'camera_disabled'
      | 'camera_removed'
      | 'device_disabled'
      | 'device_deleted'
      | 'device_restart'
      | 'device_revoked'
      | 'source_restart',
  ): void {
    const deviceEntries = [...this.#devices.entries()].filter(
      ([, device]) => device.publicCameraId === publicCameraId,
    );
    for (const [cameraId, device] of deviceEntries) {
      this.#cleanupCamera(cameraId, reasonCode);
      this.#devices.delete(cameraId);
      device.socket.close(4002, reasonCode);
    }
  }

  /** End every live-view negotiation authenticated by one browser session.
   * This is used for logout, session revocation, and household switching so
   * authorization loss does not wait for the periodic database check. */
  disconnectSession(sessionId: string, reasonCode = 'session_revoked'): void {
    for (const session of [...this.#sessions.values()]) {
      if (session.sessionId !== sessionId) continue;
      this.#cleanup(session.connectionId, undefined, reasonCode);
      session.viewer.close(4001, 'Authorization lost');
    }
  }

  setPrivacyMode(publicCameraId: string, enabled: boolean): void {
    const device = [...this.#devices.values()].find(
      (candidate) => candidate.publicCameraId === publicCameraId,
    );
    if (!device) return;
    const camera = [...this.#devices.entries()].find(
      ([, candidate]) => candidate === device,
    );
    if (!camera) return;
    if (enabled) this.#cleanupCamera(camera[0], 'privacy_enabled');
    this.#send(device.socket, { enabled, type: 'privacy-mode' });
  }

  requestSourceSwitch(
    siblingCameraIds: string[],
    targetPublicCameraId: string,
  ): boolean {
    const sibling = [...this.#devices.values()].find((device) =>
      siblingCameraIds.includes(device.publicCameraId),
    );
    if (!sibling) return false;
    this.#send(sibling.socket, {
      cameraId: targetPublicCameraId,
      type: 'switch-source',
    });
    return true;
  }

  notifySourcesChanged(siblingCameraIds: string[]): boolean {
    const sibling = [...this.#devices.values()].find((device) =>
      siblingCameraIds.includes(device.publicCameraId),
    );
    if (!sibling) return false;
    this.#send(sibling.socket, { type: 'sources-changed' });
    return true;
  }

  /** Sends a server-authorized recording request directly to the camera
   * device. Viewer sockets cannot originate this message; callers must first
   * pass the recording route's owner, Drive, camera-access, and online checks. */
  requestRecording(publicCameraId: string, recordingId: string): boolean {
    const device = [...this.#devices.values()].find(
      (candidate) => candidate.publicCameraId === publicCameraId,
    );
    if (!device) return false;
    this.#send(device.socket, { recordingId, type: 'recording-request' });
    return device.socket.readyState === device.socket.OPEN;
  }

  #listen(socket: WebSocket, role: PeerRole): void {
    const arrivals: number[] = [];
    socket.on('message', (data) => {
      if (typeof data !== 'string' && !Buffer.isBuffer(data)) return;
      const now = Date.now();
      while (arrivals.length > 0 && arrivals[0]! <= now - MESSAGE_WINDOW_MS)
        arrivals.shift();
      arrivals.push(now);
      if (arrivals.length > MAX_MESSAGES_PER_WINDOW) {
        socket.close(1008, 'Too many messages');
        return;
      }
      const raw = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      if (Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES) {
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
    if (message.type === 'ice-restart') {
      // The viewer's network changed or its relay credentials are running
      // out. Hand both ends fresh ICE servers; the camera answers by sending a
      // new offer with ICE restart, which the viewer treats like any offer.
      if (role !== 'viewer') {
        this.#send(socket, { code: 'invalid_message', type: 'error' });
        return;
      }
      // A flapping network may ask repeatedly; extra requests are dropped
      // quietly because an error would end the session.
      const now = Date.now();
      if (now - session.lastIceRestartAt < MIN_ICE_RESTART_INTERVAL_MS) return;
      session.lastIceRestartAt = now;
      this.#send(session.viewer, {
        connectionId: session.connectionId,
        iceServers: this.createViewerIceServers(),
        type: 'ice-config',
      });
      this.#send(session.device, {
        connectionId: session.connectionId,
        iceServers: this.createDeviceIceServers(),
        type: 'ice-restart',
      });
      return;
    }
    if (message.type === 'talk-request' || message.type === 'talk-release') {
      if (role !== 'viewer') {
        this.#send(socket, { code: 'invalid_message', type: 'error' });
        return;
      }
      if (message.type === 'talk-request') {
        if (!session.canTalk) {
          this.#send(session.viewer, {
            active: false,
            connectionId: session.connectionId,
            reason: 'not_allowed',
            type: 'talk-state',
          });
          return;
        }
        const owner = this.#talkOwners.get(session.cameraId);
        const granted = !owner || owner === session.connectionId;
        if (granted)
          this.#talkOwners.set(session.cameraId, session.connectionId);
        const state = {
          active: granted,
          connectionId: session.connectionId,
          reason: granted ? undefined : 'busy',
          type: 'talk-state',
        };
        this.#send(session.viewer, state);
        this.#send(session.device, state);
      } else {
        this.#releaseTalk(session);
      }
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
    if (message.type === 'connected' && role === 'device') {
      if (session.timeout) {
        clearTimeout(session.timeout);
        session.timeout = null;
      }
      if (!session.connected) {
        session.connected = true;
        this.onDiagnostic({
          connectionId: session.connectionId,
          event: 'connected',
          publicCameraId: session.publicCameraId,
          role,
        });
        if (session.householdId)
          this.onViewerState(session.householdId, session.publicCameraId);
      }
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
    this.#releaseTalk(session);
    const cameraSessions = this.#cameraSessions.get(session.cameraId);
    cameraSessions?.delete(connectionId);
    if (cameraSessions?.size === 0)
      this.#cameraSessions.delete(session.cameraId);
    if (session.timeout) clearTimeout(session.timeout);
    if (session.connected && session.householdId)
      this.onViewerState(session.householdId, session.publicCameraId);
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

  #releaseTalk(session: ActiveSession): void {
    if (this.#talkOwners.get(session.cameraId) !== session.connectionId) return;
    this.#talkOwners.delete(session.cameraId);
    const state = {
      active: false,
      connectionId: session.connectionId,
      type: 'talk-state',
    };
    this.#send(session.viewer, state);
    this.#send(session.device, state);
  }

  #reject(socket: WebSocket, code: string, closeCode = 4003): void {
    this.#send(socket, { code, type: 'error' });
    socket.close(closeCode, 'Connection rejected');
  }

  #send(socket: WebSocket, message: object): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
