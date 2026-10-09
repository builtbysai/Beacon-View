import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import { quietHoursSchema } from './motion-settings.js';
import type { RateLimiter } from './rate-limit.js';
import type { SessionAuth } from './session-auth.js';
import type { MilestoneStore } from './store.js';

const subscriptionSchema = z.discriminatedUnion('channel', [
  z
    .object({
      channel: z.literal('fcm'),
      installationId: z.string().uuid(),
      deviceLabel: z.string().trim().min(1).max(80),
      // `token` is the FCM registration token required by the HTTP v1 API.
      // Keep accepting `fid` for one client rollout so existing installations
      // can re-enrol without an outage; it is stored as the provider token.
      token: z.string().trim().min(10).max(4096).optional(),
      fid: z.string().trim().min(10).max(512).optional(),
    })
    .strict(),
  z
    .object({
      channel: z.literal('web_push'),
      installationId: z.string().uuid(),
      deviceLabel: z.string().trim().min(1).max(80),
      subscription: z
        .object({
          endpoint: z
            .string()
            .url()
            .refine((value) => new URL(value).protocol === 'https:'),
          expirationTime: z.number().nullable().optional(),
          keys: z
            .object({
              p256dh: z.string().min(20).max(512),
              auth: z.string().min(8).max(256),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
  // The desktop app (ADR 0083): alerts arrive over this session's own
  // authenticated realtime connection, so there is no provider token.
  z
    .object({
      channel: z.literal('desktop'),
      installationId: z.string().uuid(),
      deviceLabel: z.string().trim().min(1).max(80),
    })
    .strict(),
]);
const subscriptionParameterSchema = z.object({
  subscriptionId: z.string().uuid(),
});
const preferenceParameterSchema = z.object({ deviceId: z.string().uuid() });
const preferenceSchema = z
  .object({
    motionEnabled: z.boolean(),
    offlineEnabled: z.boolean(),
    quietHours: quietHoursSchema.nullable(),
  })
  .strict();

export function registerNotificationRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: SessionAuth;
    config: AppConfig;
    limiter: RateLimiter;
    store: MilestoneStore;
  },
): void {
  const { auth, config, limiter, store } = dependencies;
  const { authenticateHouseholdAdmin, authenticateHouseholdAdminStateChange } =
    auth;

  app.get('/api/notification-config/web-push-key', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    if (!config.WEB_PUSH_VAPID_PUBLIC_KEY)
      return reply.code(404).send({ error: 'Web Push is unavailable' });
    return { publicKey: config.WEB_PUSH_VAPID_PUBLIC_KEY };
  });

  app.post('/api/notification-subscriptions', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (!store.notificationsConfigured())
      return reply
        .code(503)
        .send({ error: 'Notifications are not configured' });
    if (
      !limiter.take(
        `notification-subscribe:${session.userId}:${request.ip}`,
        20,
        60 * 60 * 1_000,
      )
    ) {
      return reply.code(429).send({ error: 'Too many notification changes' });
    }
    const parsed = subscriptionSchema.safeParse(request.body);
    if (
      !parsed.success ||
      (parsed.data.channel === 'fcm' && !parsed.data.token && !parsed.data.fid)
    )
      return reply
        .code(400)
        .send({ error: 'Invalid notification subscription' });
    if (parsed.data.channel === 'fcm' && !config.FIREBASE_PROJECT_ID) {
      return reply
        .code(503)
        .send({ error: 'Android notifications are unavailable' });
    }
    if (
      parsed.data.channel === 'web_push' &&
      !config.WEB_PUSH_VAPID_PUBLIC_KEY
    ) {
      return reply
        .code(503)
        .send({ error: 'Web notifications are unavailable' });
    }
    const providerMaterial =
      parsed.data.channel === 'fcm'
        ? (parsed.data.token ?? parsed.data.fid!)
        : parsed.data.channel === 'desktop'
          ? session.id
          : JSON.stringify(parsed.data.subscription);
    const id = await store.upsertNotificationSubscription({
      channel: parsed.data.channel,
      consentedAt: new Date(),
      deviceLabel: parsed.data.deviceLabel,
      installationId: parsed.data.installationId,
      providerMaterial,
      sessionId: session.id,
      userId: session.userId,
    });
    await store.audit({
      eventType: 'notification_subscription_created',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { channel: parsed.data.channel },
      success: true,
      userId: session.userId,
    });
    return reply.code(201).send({ id });
  });

  app.delete(
    '/api/notification-subscriptions/:subscriptionId',
    async (request, reply) => {
      const session = await auth.authenticateStateChange(request, reply);
      if (!session) return;
      const parameters = subscriptionParameterSchema.safeParse(request.params);
      if (!parameters.success)
        return reply.code(404).send({ error: 'Subscription not found' });
      const revoked = await store.revokeNotificationSubscription(
        session.userId,
        session.id,
        parameters.data.subscriptionId,
      );
      if (!revoked)
        return reply.code(404).send({ error: 'Subscription not found' });
      await store.audit({
        eventType: 'notification_subscription_revoked',
        householdId: session.householdId,
        ipAddress: request.ip,
        success: true,
        userId: session.userId,
      });
      return reply.code(204).send();
    },
  );

  // Opening an alert (ADR 0090): the push itself stays generic (ADR 0044),
  // so the app asks which camera it was about after the person taps it.
  // Answers only for this user's own events, and only names a camera they
  // can still access.
  app.get('/api/notification-events/:eventId', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const parameters = z
      .object({ eventId: z.string().uuid() })
      .safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Alert unavailable' });
    reply.header('Cache-Control', 'no-store');
    const event = await store.findNotificationEvent(
      session.userId,
      parameters.data.eventId,
    );
    if (!event) return reply.code(404).send({ error: 'Alert unavailable' });
    const camera = event.publicCameraId
      ? await store.findAccessibleCamera(
          session.householdId,
          session.userId,
          session.role,
          event.publicCameraId,
        )
      : null;
    return {
      cameraId: camera ? event.publicCameraId : null,
      category: event.category,
    };
  });

  app.get('/api/notification-preferences', async (request, reply) => {
    const session = await authenticateHouseholdAdmin(request, reply);
    if (!session) return;
    return {
      preferences: await store.listNotificationPreferences(
        session.userId,
        session.householdId,
      ),
    };
  });

  app.put(
    '/api/notification-preferences/:deviceId/motion-snooze',
    async (request, reply) => {
      const session = await authenticateHouseholdAdminStateChange(
        request,
        reply,
      );
      if (!session) return;
      const parameters = preferenceParameterSchema.safeParse(request.params);
      const body = z
        .object({
          minutes: z.union([
            z.literal(0),
            z.literal(15),
            z.literal(30),
            z.literal(60),
          ]),
        })
        .strict()
        .safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply
          .code(400)
          .send({ error: 'Invalid notification preference' });
      if (
        !limiter.take(
          `motion-snooze:${session.userId}:${request.ip}`,
          60,
          60 * 60 * 1_000,
        )
      )
        return reply.code(429).send({ error: 'Too many notification changes' });
      const preference = await store.snoozeMotionAlerts({
        userId: session.userId,
        householdId: session.householdId,
        publicDeviceId: parameters.data.deviceId,
        minutes: body.data.minutes,
        now: new Date(),
      });
      if (!preference)
        return reply.code(404).send({ error: 'Camera not found' });
      await store.audit({
        eventType: 'notification_preference_changed',
        householdId: session.householdId,
        ipAddress: request.ip,
        success: true,
        userId: session.userId,
        metadata: { motionSnoozeMinutes: String(body.data.minutes) },
      });
      return { preference };
    },
  );

  app.put('/api/notification-preferences/:deviceId', async (request, reply) => {
    const session = await authenticateHouseholdAdminStateChange(request, reply);
    if (!session) return;
    const parameters = preferenceParameterSchema.safeParse(request.params);
    const body = preferenceSchema.safeParse(request.body);
    if (!parameters.success || !body.success)
      return reply.code(400).send({ error: 'Invalid notification preference' });
    const preference = await store.updateNotificationPreference({
      userId: session.userId,
      householdId: session.householdId,
      publicDeviceId: parameters.data.deviceId,
      ...body.data,
    });
    if (!preference) return reply.code(404).send({ error: 'Camera not found' });
    await store.audit({
      eventType: 'notification_preference_changed',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    return { preference };
  });
}
