import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import { GUEST_LINK_COOKIE } from './guest-routes.js';
import { hashSecret } from './security.js';
import type { HouseholdEventHub } from './household-events.js';
import type { IceServer } from './signaling.js';
import { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';
import { createTurnCredential } from './turn-credentials.js';

const querySchema = z.discriminatedUnion('role', [
  z.object({ cameraId: z.string().uuid(), role: z.literal('device') }),
  z.object({ cameraId: z.string().uuid(), role: z.literal('producer') }),
  z.object({
    cameraId: z.string().uuid(),
    role: z.literal('viewer'),
    // Client-generated id shared across one continuous live-view attempt
    // (including its own automatic reconnects); optional so older clients
    // and non-browser callers still work. Validated as a UUID here so a
    // malformed value can never reach the database.
    viewerSessionId: z.string().uuid().optional(),
  }),
]);

export function registerSignaling(
  app: FastifyInstance,
  config: AppConfig,
  store: MilestoneStore,
  householdEvents?: HouseholdEventHub,
): SignalingHub {
  const hub = new SignalingHub(
    () => createIceServers(config, 'viewer'),
    () => createIceServers(config, 'device'),
    30_000,
    config.ICE_TRANSPORT_POLICY,
    (diagnostic) => {
      app.log.info({ signaling: diagnostic }, 'signaling lifecycle');
    },
    (householdId, cameraId) => {
      householdEvents?.publish(householdId, {
        cameraId,
        type: 'camera-presence-changed',
      });
    },
    (householdId, cameraId) => {
      householdEvents?.publish(householdId, {
        cameraId,
        type: 'camera-presence-changed',
      });
    },
  );
  void app.register((signalingApp) => {
    signalingApp.addHook('onClose', () => hub.close());
    signalingApp.get(
      '/api/signaling',
      { websocket: true },
      async (socket, request) => {
        const query = querySchema.safeParse(request.query);
        if (!query.success) {
          socket.close(4003, 'Connection rejected');
          return;
        }
        if (query.data.role === 'device') {
          const authorization = request.headers.authorization;
          const token = authorization?.startsWith('Bearer ')
            ? authorization.slice('Bearer '.length)
            : '';
          const camera = token
            ? await store.findCameraForDeviceCredential(
                hashSecret(token),
                query.data.cameraId,
              )
            : null;
          if (!camera) {
            socket.close(4003, 'Connection rejected');
            return;
          }
          hub.connectDevice(
            camera.cameraId,
            camera.publicCameraId,
            socket,
            camera.householdId,
          );
          const credentialHash = hashSecret(token);
          monitorAuthorization(socket, async () =>
            Boolean(
              await store.findCameraForDeviceCredential(
                credentialHash,
                query.data.cameraId,
              ),
            ),
          );
          return;
        }

        const bearerToken = bearerSessionToken(request);
        if (!bearerToken && request.headers.origin !== config.WEB_ORIGIN) {
          socket.close(4003, 'Connection rejected');
          return;
        }
        const publicCameraId = query.data.cameraId;
        const sessionToken =
          bearerToken || request.cookies[config.SESSION_COOKIE_NAME] || '';
        const session = sessionToken
          ? await store.findSession(hashSecret(sessionToken), new Date())
          : null;
        if (!session) {
          const guestToken = request.cookies[GUEST_LINK_COOKIE];
          if (query.data.role === 'viewer' && guestToken) {
            await connectGuestViewer(
              hub,
              store,
              socket,
              request,
              guestToken,
              publicCameraId,
              query.data.viewerSessionId,
            );
            return;
          }
          socket.close(4003, 'Connection rejected');
          return;
        }
        if (query.data.role === 'producer') {
          if (
            bearerToken ||
            request.headers.origin !== config.WEB_ORIGIN ||
            (session.role !== 'owner' && session.role !== 'admin')
          ) {
            socket.close(4003, 'Connection rejected');
            return;
          }
          const managedCamera = await store.findManagedCamera(
            session.householdId,
            publicCameraId,
          );
          if (!managedCamera) {
            socket.close(4003, 'Connection rejected');
            return;
          }
          hub.connectDevice(
            managedCamera.cameraId,
            managedCamera.publicCameraId,
            socket,
            managedCamera.householdId,
          );
          const producerSessionToken =
            request.cookies[config.SESSION_COOKIE_NAME] ?? '';
          const sessionHash = hashSecret(producerSessionToken);
          monitorAuthorization(socket, async () => {
            const current = await store.findSession(sessionHash, new Date());
            return Boolean(
              current &&
              (current.role === 'owner' || current.role === 'admin') &&
              (await store.findManagedCamera(
                current.householdId,
                publicCameraId,
              )),
            );
          });
          return;
        }
        const camera = await store.findAccessibleCamera(
          session.householdId,
          session.userId,
          session.role,
          publicCameraId,
        );
        if (!camera) {
          await store.audit({
            eventType: 'live_view_rejected',
            householdId: session.householdId,
            ipAddress: request.ip,
            metadata: { reason: 'not_authorized' },
            success: false,
            userId: session.userId,
            ...(query.data.viewerSessionId
              ? { viewerSessionId: query.data.viewerSessionId }
              : {}),
          });
          socket.close(4003, 'Connection rejected');
          return;
        }
        const admitted = hub.connectViewer(
          camera.cameraId,
          camera.publicCameraId,
          socket,
          camera.canTalk,
          session.id,
          camera.canListen,
        );
        const sessionHash = hashSecret(sessionToken);
        if (admitted) {
          monitorAuthorization(socket, async () => {
            const currentSession = await store.findSession(
              sessionHash,
              new Date(),
            );
            if (!currentSession) return false;
            return Boolean(
              await store.findAccessibleCamera(
                currentSession.householdId,
                currentSession.userId,
                currentSession.role,
                publicCameraId,
              ),
            );
          });
        }
        await store.audit({
          cameraId: camera.deviceId,
          eventType: admitted ? 'live_view_started' : 'live_view_rejected',
          householdId: session.householdId,
          ipAddress: request.ip,
          success: admitted,
          userId: session.userId,
          ...(admitted ? {} : { metadata: { reason: 'camera_offline' } }),
          ...(query.data.viewerSessionId
            ? { viewerSessionId: query.data.viewerSessionId }
            : {}),
        });
      },
    );
  });
  return hub;
}

function createIceServers(
  config: AppConfig,
  role: 'device' | 'viewer',
): IceServer[] {
  const turn = createTurnCredential(
    config.TURN_SHARED_SECRET,
    config.TURN_CREDENTIAL_TTL_SECONDS,
  );
  const stunUrl =
    role === 'viewer' ? config.VIEWER_STUN_URL : config.DEVICE_STUN_URL;
  const turnUrls =
    role === 'viewer'
      ? [config.VIEWER_TURN_URL, config.VIEWER_TURN_TCP_URL]
      : [config.DEVICE_TURN_URL, config.DEVICE_TURN_TCP_URL];
  return [
    { urls: [stunUrl] },
    {
      credential: turn.credential,
      urls: turnUrls,
      username: turn.username,
    },
  ];
}

// A guest-link viewer connects the same way a signed-in viewer does, just
// authorized by a token hash instead of a session -- there's no sessionId
// to key an immediate forced-disconnect on, so a revoked or expired link
// is caught by monitorAuthorization's periodic re-check instead.
async function connectGuestViewer(
  hub: SignalingHub,
  store: MilestoneStore,
  socket: import('ws').WebSocket,
  request: FastifyRequest,
  guestToken: string,
  publicCameraId: string,
  viewerSessionId?: string,
): Promise<void> {
  const tokenHash = hashSecret(guestToken);
  const camera = await store.findGuestAccessibleCamera(
    tokenHash,
    publicCameraId,
    new Date(),
  );
  if (!camera) {
    await store.audit({
      eventType: 'live_view_rejected',
      ipAddress: request.ip,
      metadata: { guest: 'true', reason: 'not_authorized' },
      success: false,
      ...(viewerSessionId ? { viewerSessionId } : {}),
    });
    socket.close(4003, 'Connection rejected');
    return;
  }
  const admitted = hub.connectViewer(
    camera.cameraId,
    camera.publicCameraId,
    socket,
    camera.canTalk,
    undefined,
    camera.canListen,
  );
  if (admitted) {
    monitorAuthorization(socket, async () =>
      Boolean(
        await store.findGuestAccessibleCamera(
          tokenHash,
          publicCameraId,
          new Date(),
        ),
      ),
    );
  }
  await store.audit({
    cameraId: camera.deviceId,
    eventType: admitted ? 'live_view_started' : 'live_view_rejected',
    householdId: camera.householdId,
    ipAddress: request.ip,
    metadata: admitted ? { guest: 'true' } : { guest: 'true', reason: 'camera_offline' },
    success: admitted,
    ...(viewerSessionId ? { viewerSessionId } : {}),
  });
}

export function monitorAuthorization(
  socket: import('ws').WebSocket,
  validate: () => Promise<boolean>,
  intervalMs = 15_000,
): void {
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void validate()
      .then((authorized) => {
        if (!authorized) socket.close(4003, 'Authorization lost');
      })
      .catch(() => socket.close(1011, 'Authorization check failed'))
      .finally(() => {
        checking = false;
      });
  }, intervalMs);
  timer.unref();
  socket.once('close', () => clearInterval(timer));
}

function bearerSessionToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  return authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
}
