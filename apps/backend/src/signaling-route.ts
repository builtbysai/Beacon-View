import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import { hashSecret } from './security.js';
import type { HouseholdEventHub } from './household-events.js';
import type { IceServer } from './signaling.js';
import { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';
import { createTurnCredential } from './turn-credentials.js';

const querySchema = z.discriminatedUnion('role', [
  z.object({ cameraId: z.string().uuid(), role: z.literal('device') }),
  z.object({ cameraId: z.string().uuid(), role: z.literal('producer') }),
  z.object({ cameraId: z.string().uuid(), role: z.literal('viewer') }),
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

        if (request.headers.origin !== config.WEB_ORIGIN) {
          socket.close(4003, 'Connection rejected');
          return;
        }
        const publicCameraId = query.data.cameraId;
        const session = await authenticateViewer(request, config, store);
        const camera = session
          ? await store.findOwnedCamera(session.householdId, publicCameraId)
          : null;
        if (!session || !camera) {
          if (session) {
            await store.audit({
              eventType: 'live_view_rejected',
              householdId: session.householdId,
              ipAddress: request.ip,
              success: false,
              userId: session.userId,
            });
          }
          socket.close(4003, 'Connection rejected');
          return;
        }
        if (query.data.role === 'producer') {
          hub.connectDevice(
            camera.cameraId,
            camera.publicCameraId,
            socket,
            camera.householdId,
          );
          const sessionToken =
            request.cookies[config.SESSION_COOKIE_NAME] ?? '';
          const sessionHash = hashSecret(sessionToken);
          monitorAuthorization(socket, async () => {
            const current = await store.findSession(sessionHash, new Date());
            return Boolean(
              current &&
              (await store.findOwnedCamera(
                current.householdId,
                publicCameraId,
              )),
            );
          });
          return;
        }
        const admitted = hub.connectViewer(
          camera.cameraId,
          camera.publicCameraId,
          socket,
        );
        const sessionToken = request.cookies[config.SESSION_COOKIE_NAME];
        const sessionHash = sessionToken ? hashSecret(sessionToken) : '';
        if (admitted) {
          monitorAuthorization(socket, async () => {
            const currentSession = sessionHash
              ? await store.findSession(sessionHash, new Date())
              : null;
            if (!currentSession) return false;
            return Boolean(
              await store.findOwnedCamera(
                currentSession.householdId,
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

async function authenticateViewer(
  request: FastifyRequest,
  config: AppConfig,
  store: MilestoneStore,
) {
  const token = request.cookies[config.SESSION_COOKIE_NAME];
  return token
    ? store.findSession(hashSecret(token), new Date())
    : Promise.resolve(null);
}
