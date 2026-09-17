import type { HealthResponse } from '@beacon/shared-types';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { deliverContactMessage } from './contact.js';
import { contactSchema } from './http-schemas.js';
import type { RateLimiter } from './rate-limit.js';
import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;

export function registerServiceRoutes(
  app: FastifyInstance,
  config: AppConfig,
  store: MilestoneStore,
  limiter: RateLimiter,
): void {
  app.get('/health', (): HealthResponse => ({
    service: 'backend',
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));


  app.get('/api/capabilities', () => ({
    auth: {
      google: Boolean(
        config.GOOGLE_OAUTH_CLIENT_ID &&
          config.GOOGLE_OAUTH_CLIENT_SECRET &&
          config.GOOGLE_OAUTH_REDIRECT_URI,
      ),
    },
    contact: Boolean(
      config.CONTACT_EMAIL_TO && config.RESEND_API_KEY && config.RESEND_FROM,
    ),
    googleDrive: Boolean(
      config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY &&
        config.GOOGLE_OAUTH_CLIENT_ID &&
        config.GOOGLE_OAUTH_CLIENT_SECRET &&
        config.GOOGLE_OAUTH_REDIRECT_URI,
    ),
    notifications: {
      firebase: Boolean(
        config.NOTIFICATION_ENCRYPTION_KEY &&
          config.NOTIFICATION_FINGERPRINT_KEY &&
          config.FIREBASE_PROJECT_ID &&
          config.GOOGLE_APPLICATION_CREDENTIALS,
      ),
      webPush: Boolean(
        config.NOTIFICATION_ENCRYPTION_KEY &&
          config.NOTIFICATION_FINGERPRINT_KEY &&
          config.WEB_PUSH_VAPID_PUBLIC_KEY &&
          config.WEB_PUSH_VAPID_PRIVATE_KEY &&
          config.WEB_PUSH_VAPID_SUBJECT,
      ),
    },
    realtime: true,
    recordings: Boolean(
      config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY &&
        config.GOOGLE_OAUTH_CLIENT_ID &&
        config.GOOGLE_OAUTH_CLIENT_SECRET &&
        config.GOOGLE_OAUTH_REDIRECT_URI,
    ),
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      await store.isReady();
      return { service: 'backend', status: 'ok' };
    } catch {
      return reply
        .code(503)
        .send({ service: 'backend', status: 'unavailable' });
    }
  });

  app.post('/api/contact', async (request, reply) => {
    if (!limiter.take(`contact:${request.ip}`, 3, HOUR)) {
      return reply.code(429).send({ error: 'Please try again later' });
    }
    const body = contactSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid contact message' });
    }
    if (body.data.website) return reply.code(204).send();
    try {
      await deliverContactMessage(config, body.data);
      return reply.code(204).send();
    } catch {
      return reply.code(503).send({ error: 'Contact delivery is unavailable' });
    }
  });
}
