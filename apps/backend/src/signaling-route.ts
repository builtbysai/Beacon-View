import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import { hashSecret } from './security.js';
import { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const querySchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('device') }),
  z.object({ cameraId: z.string().uuid(), role: z.literal('viewer') }),
]);

export function registerSignaling(
  app: FastifyInstance,
  config: AppConfig,
  store: MilestoneStore,
): void {
  const hub = new SignalingHub(
    [
      { urls: [config.VIEWER_STUN_URL] },
      {
        credential: config.TURN_CREDENTIAL,
        urls: [config.VIEWER_TURN_URL],
        username: config.TURN_USERNAME,
      },
    ],
    [
      { urls: [config.DEVICE_STUN_URL] },
      {
        credential: config.TURN_CREDENTIAL,
        urls: [config.DEVICE_TURN_URL],
        username: config.TURN_USERNAME,
      },
    ],
  );
  void app.register(async (signalingApp) => {
    await signalingApp.register(websocket, {
      options: { maxPayload: 1_100_000 },
    });
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
            ? await store.findDeviceByCredential(hashSecret(token))
            : null;
          if (!camera) {
            socket.close(4003, 'Connection rejected');
            return;
          }
          hub.connectDevice(camera.cameraId, socket);
          return;
        }

        if (request.headers.origin !== config.WEB_ORIGIN) {
          socket.close(4003, 'Connection rejected');
          return;
        }
        const session = await authenticateViewer(request, config, store);
        const camera = session
          ? await store.findOwnedCamera(
              session.householdId,
              query.data.cameraId,
            )
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
        const admitted = hub.connectViewer(camera.cameraId, socket);
        await store.audit({
          cameraId: camera.cameraId,
          eventType: admitted ? 'live_view_started' : 'live_view_rejected',
          householdId: session.householdId,
          ipAddress: request.ip,
          success: admitted,
          userId: session.userId,
        });
      },
    );
  });
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
