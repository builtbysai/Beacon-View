import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { presentCamera } from './camera-presentation.js';
import type { AppConfig } from './config.js';
import type { HouseholdEventHub } from './household-events.js';
import type { RateLimiter } from './rate-limit.js';
import { generateToken, hashSecret } from './security.js';
import type { SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
export const GUEST_LINK_COOKIE = 'beacon_guest_link';

const createGuestLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    cameraIds: z.array(z.string().uuid()).min(1).max(24),
    canListen: z.boolean().default(false),
    canTalk: z.boolean().default(false),
    canFlip: z.boolean().default(false),
    canPause: z.boolean().default(false),
    expiresInHours: z.number().int().min(1).max(720).optional(),
  })
  .strict();
const guestLinkParameterSchema = z.object({ guestLinkId: z.string().uuid() });
const guestEnterSchema = z
  .object({ token: z.string().min(32).max(512) })
  .strict();

export function registerGuestRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: SessionAuth;
    config: AppConfig;
    householdEvents: HouseholdEventHub;
    limiter: RateLimiter;
    signaling: SignalingHub;
    store: MilestoneStore;
  },
): void {
  const { auth, config, householdEvents, limiter, signaling, store } =
    dependencies;

  app.post('/api/household/guest-links', async (request, reply) => {
    const session = await auth.authenticateHouseholdAdminStateChange(
      request,
      reply,
    );
    if (!session) return;
    if (!limiter.take(`guest-link-create:${session.householdId}`, 20, HOUR))
      return reply.code(429).send({ error: 'Too many guest links created' });
    const body = createGuestLinkSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Invalid guest link' });
    const token = generateToken();
    const expiresAt = new Date(
      Date.now() + (body.data.expiresInHours ?? 24) * HOUR,
    );
    const id = await store.createGuestLink({
      canFlip: body.data.canFlip,
      canListen: body.data.canListen,
      canPause: body.data.canPause,
      canTalk: body.data.canTalk,
      createdByUserId: session.userId,
      expiresAt,
      householdId: session.householdId,
      ...(body.data.label !== undefined ? { label: body.data.label } : {}),
      publicCameraIds: body.data.cameraIds,
      tokenHash: hashSecret(token),
    });
    if (!id)
      return reply
        .code(400)
        .send({ error: 'None of those cameras are available to share' });
    householdEvents.publish(session.householdId, {
      type: 'household-membership-changed',
    });
    await store.audit({
      eventType: 'guest_link_created',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { guestLinkId: id },
      success: true,
      userId: session.userId,
    });
    return reply
      .code(201)
      .send({ expiresAt: expiresAt.toISOString(), id, token });
  });

  app.get('/api/household/guest-links', async (request, reply) => {
    const session = await auth.authenticateHouseholdAdmin(request, reply);
    if (!session) return;
    const links = await store.listGuestLinks(session.householdId, new Date());
    return {
      guestLinks: links.map((link) => ({
        ...link,
        createdAt: link.createdAt.toISOString(),
        expiresAt: link.expiresAt.toISOString(),
        revokedAt: link.revokedAt?.toISOString() ?? null,
      })),
    };
  });

  app.delete(
    '/api/household/guest-links/:guestLinkId',
    async (request, reply) => {
      const session = await auth.authenticateHouseholdAdminStateChange(
        request,
        reply,
      );
      if (!session) return;
      const parameters = guestLinkParameterSchema.safeParse(request.params);
      if (!parameters.success)
        return reply.code(404).send({ error: 'Guest link unavailable' });
      const revoked = await store.revokeGuestLink(
        session.householdId,
        parameters.data.guestLinkId,
      );
      if (!revoked)
        return reply.code(404).send({ error: 'Guest link unavailable' });
      householdEvents.publish(session.householdId, {
        type: 'household-membership-changed',
      });
      await store.audit({
        eventType: 'guest_link_revoked',
        householdId: session.householdId,
        ipAddress: request.ip,
        metadata: { guestLinkId: parameters.data.guestLinkId },
        success: true,
        userId: session.userId,
      });
      return reply.code(204).send();
    },
  );

  // Public: redeeming a guest link's token establishes a scoped, no-account
  // viewing session (a cookie) -- there's no CSRF cookie to check yet since
  // nothing was authenticated before this call, same as login.
  app.post('/api/guest/enter', async (request, reply) => {
    // Per address only. The link itself is a 256-bit random value, so guessing is
    // not the risk; limiting entries per link locked a whole family out when a TV or
    // a few phones opened the same link within an hour (V51).
    if (!limiter.take(`guest-enter:${request.ip}`, 120, HOUR))
      return reply.code(429).send({ error: 'Too many attempts' });
    const body = guestEnterSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'This link is not valid' });
    const tokenHash = hashSecret(body.data.token);
    const access = await store.listGuestAccessibleCameras(
      tokenHash,
      new Date(),
    );
    if (!access) {
      await store.audit({
        eventType: 'guest_link_entry_failed',
        ipAddress: request.ip,
        success: false,
      });
      return reply.code(404).send({ error: 'This link is not valid' });
    }
    // The cookie never outlives the link itself (F10).
    const secondsLeft = Math.floor(
      (access.expiresAt.getTime() - Date.now()) / 1_000,
    );
    reply.setCookie(GUEST_LINK_COOKIE, body.data.token, {
      httpOnly: true,
      maxAge: Math.max(1, Math.min(THIRTY_DAYS_SECONDS, secondsLeft)),
      path: '/',
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
    });
    await store.audit({
      eventType: 'guest_link_entered',
      householdId: access.householdId,
      ipAddress: request.ip,
      success: true,
    });
    return reply.code(200).send({ cameraCount: access.cameras.length });
  });

  app.get('/api/guest/cameras', async (request, reply) => {
    const token = request.cookies[GUEST_LINK_COOKIE];
    if (!token) return reply.code(401).send({ error: 'Guest link required' });
    const access = await store.listGuestAccessibleCameras(
      hashSecret(token),
      new Date(),
    );
    if (!access) {
      reply.clearCookie(GUEST_LINK_COOKIE, { path: '/' });
      return reply.code(401).send({ error: 'This link is no longer valid' });
    }
    return {
      cameras: access.cameras.map((camera) =>
        presentCamera(camera, signaling.cameraStatus(camera.publicCameraId), {
          role: 'guest',
          userId: '',
        }),
      ),
    };
  });

  // Cast to TV (ADR 0097): the signed-in viewer asks which Cast application to
  // use. Anyone signed in may ask; null keeps the button hidden.
  app.get('/api/cast-config', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    reply.header('Cache-Control', 'no-store');
    return { appId: config.CAST_APP_ID ?? null };
  });

  app.post('/api/guest/exit', (_request, reply) => {
    reply.clearCookie(GUEST_LINK_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
