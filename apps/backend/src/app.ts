import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAccountRecoveryRoutes } from './account-recovery-routes.js';
import { registerAccountRoutes } from './account-routes.js';
import { registerActivityRoutes } from './activity-routes.js';
import { registerAuthenticationRoutes } from './authentication-routes.js';
import { registerCameraManagementRoutes } from './camera-management-routes.js';
import type { AppConfig } from './config.js';
import { registerDeviceRuntimeRoutes } from './device-runtime-routes.js';
import { registerDriveRoutes } from './drive-routes.js';
import { registerEnrollmentRoutes } from './enrollment-routes.js';
import { registerGuestRoutes } from './guest-routes.js';
import { RateLimiter } from './rate-limit.js';
import {
  HouseholdEventHub,
  registerHouseholdEvents,
} from './household-events.js';
import { createSessionAuth } from './session-auth.js';
import { registerSignaling } from './signaling-route.js';
import { registerServiceRoutes } from './service-routes.js';
import { registerNotificationRoutes } from './notification-routes.js';
import { registerRecordingRoutes } from './recording-routes.js';
import { registerSharingRoutes } from './sharing-routes.js';
import { PostgresStore, type MilestoneStore } from './store.js';

export { isCameraOnline } from './camera-presentation.js';

export function createPostgresStore(config: AppConfig): PostgresStore {
  const notificationKeys =
    config.NOTIFICATION_ENCRYPTION_KEY && config.NOTIFICATION_FINGERPRINT_KEY
      ? {
          encryptionKey: config.NOTIFICATION_ENCRYPTION_KEY,
          fingerprintKey: config.NOTIFICATION_FINGERPRINT_KEY,
        }
      : undefined;
  return new PostgresStore(
    config.DATABASE_URL,
    notificationKeys,
    config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY,
  );
}

export function buildApp(
  config: AppConfig,
  suppliedStore?: MilestoneStore,
  suppliedHouseholdEvents?: HouseholdEventHub,
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
          'req.body.token',
          'req.body.fid',
          'req.body.subscription',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
    },
    requestIdHeader: 'x-request-id',
  });
  const store = suppliedStore ?? createPostgresStore(config);
  const sessionAuth = createSessionAuth(config, store);
  const limiter = new RateLimiter();

  void app.register(cookie);
  void app.register(websocket, { options: { maxPayload: 1_100_000 } });
  const householdEvents = registerHouseholdEvents(
    app,
    config,
    store,
    suppliedHouseholdEvents,
  );
  const signaling = registerSignaling(app, config, store, householdEvents);
  app.addHook('onClose', async () => store.close());
  app.addHook('onClose', () => limiter.close());
  registerServiceRoutes(app, config, store, limiter);
  registerAuthenticationRoutes(app, {
    auth: sessionAuth,
    config,
    limiter,
    store,
  });
  registerAccountRoutes(app, {
    auth: sessionAuth,
    config,
    householdEvents,
    signaling,
    store,
  });
  registerAccountRecoveryRoutes(app, {
    auth: sessionAuth,
    config,
    householdEvents,
    limiter,
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
  registerNotificationRoutes(app, {
    auth: sessionAuth,
    config,
    limiter,
    store,
  });
  registerDriveRoutes(app, { auth: sessionAuth, config, store });
  registerRecordingRoutes(app, {
    auth: sessionAuth,
    config,
    signaling,
    store,
  });
  registerSharingRoutes(app, {
    auth: sessionAuth,
    config,
    householdEvents,
    limiter,
    signaling,
    store,
  });
  registerGuestRoutes(app, {
    auth: sessionAuth,
    config,
    householdEvents,
    limiter,
    signaling,
    store,
  });

  return app;
}
