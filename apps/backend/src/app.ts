import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAccountRoutes } from './account-routes.js';
import { registerActivityRoutes } from './activity-routes.js';
import { registerAuthenticationRoutes } from './authentication-routes.js';
import { registerCameraManagementRoutes } from './camera-management-routes.js';
import type { AppConfig } from './config.js';
import { registerDeviceRuntimeRoutes } from './device-runtime-routes.js';
import { registerEnrollmentRoutes } from './enrollment-routes.js';
import { RateLimiter } from './rate-limit.js';
import { registerHouseholdEvents } from './household-events.js';
import { createSessionAuth } from './session-auth.js';
import { registerSignaling } from './signaling-route.js';
import { registerServiceRoutes } from './service-routes.js';
import { PostgresStore, type MilestoneStore } from './store.js';

export { isCameraOnline } from './camera-presentation.js';

export function buildApp(
  config: AppConfig,
  suppliedStore?: MilestoneStore,
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.pairingCode',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
    },
    requestIdHeader: 'x-request-id',
  });
  const store = suppliedStore ?? new PostgresStore(config.DATABASE_URL);
  const sessionAuth = createSessionAuth(config, store);
  const limiter = new RateLimiter();

  void app.register(cookie);
  void app.register(websocket, { options: { maxPayload: 1_100_000 } });
  const householdEvents = registerHouseholdEvents(app, config, store);
  const signaling = registerSignaling(app, config, store, householdEvents);
  app.addHook('onClose', async () => store.close());
  registerServiceRoutes(app, config, store, limiter);
  registerAuthenticationRoutes(app, {
    auth: sessionAuth,
    config,
    limiter,
    store,
  });
  registerAccountRoutes(app, {
    auth: sessionAuth,
    householdEvents,
    signaling,
    store,
  });
  registerEnrollmentRoutes(app, {
    auth: sessionAuth,
    householdEvents,
    limiter,
    signaling,
    store,
  });
  registerCameraManagementRoutes(app, {
    auth: sessionAuth,
    householdEvents,
    signaling,
    store,
  });
  registerActivityRoutes(app, {
    auth: sessionAuth,
    householdEvents,
    signaling,
    store,
  });
  registerDeviceRuntimeRoutes(app, {
    auth: sessionAuth,
    householdEvents,
    signaling,
    store,
  });

  return app;
}
