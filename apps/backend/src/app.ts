import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import type { HealthResponse } from '@beacon/shared-types';
import { OAuth2Client } from 'google-auth-library';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import { deliverContactMessage } from './contact.js';
import { RateLimiter } from './rate-limit.js';
import { motionSettingsSchema } from './motion-settings.js';
import {
  motionHistoryCursor,
  parseMotionHistoryQuery,
} from './motion-history.js';
import { registerHouseholdEvents } from './household-events.js';
import { registerSignaling } from './signaling-route.js';
import {
  generatePairingCode,
  generateToken,
  hashPassword,
  hashSecret,
  normalizeEmail,
  secretsEqual,
  verifyPassword,
} from './security.js';
import {
  DEVICE_REGISTRATION_RATE_LIMITED,
  MOTION_RETENTION_DAYS,
  PostgresStore,
  type MilestoneStore,
  type SessionRecord,
} from './store.js';

const HOUR = 60 * 60 * 1_000;
const FIFTEEN_MINUTES = 15 * 60 * 1_000;
const SEVEN_DAYS = 7 * 24 * HOUR;
const THIRTY_DAYS = 30 * 24 * HOUR;
const TEN_MINUTES = 10 * 60 * 1_000;
const ONLINE_WINDOW = 90 * 1_000;
const CSRF_COOKIE = 'beacon_csrf';
const GOOGLE_STATE_COOKIE = 'beacon_google_oauth_state';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(128),
});
const registerDeviceSchema = z.object({
  installationId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  pairingCode: z.string().trim().min(1).max(32),
});
const cameraSourceSchema = z.object({
  sourceKey: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  facing: z.enum(['front', 'rear', 'external', 'unknown']),
  capabilities: z
    .record(z.string(), z.union([z.boolean(), z.number(), z.string()]))
    .optional(),
});
const syncCameraSourcesSchema = z.object({
  sources: z.array(cameraSourceSchema).min(1).max(12),
});
const browserDeviceSchema = z.object({
  installationId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  sources: z.array(cameraSourceSchema).min(1).max(12),
});
const cameraParameterSchema = z.object({ cameraId: z.string().uuid() });
const deviceParameterSchema = z.object({ deviceId: z.string().uuid() });
const updateDeviceSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.name !== undefined);
const updateCameraSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.name !== undefined);
const privacyModeSchema = z.object({ enabled: z.boolean() });
const heartbeatSchema = z
  .object({
    batteryPercent: z.number().int().min(0).max(100).optional(),
    batteryCharging: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.batteryPercent === undefined) ===
      (value.batteryCharging === undefined),
  );
const motionEventSchema = z.object({
  confidence: z.number().finite().min(0).max(1),
});
const motionRetentionSchema = z
  .object({ days: z.number().int() })
  .strict()
  .refine((value): value is { days: (typeof MOTION_RETENTION_DAYS)[number] } =>
    MOTION_RETENTION_DAYS.includes(
      value.days as (typeof MOTION_RETENTION_DAYS)[number],
    ),
  );
const pairingCodeParameterSchema = z.object({
  pairingCodeId: z.string().uuid(),
});
const sessionParameterSchema = z.object({ sessionId: z.string().uuid() });
const accountDeletionSchema = z.object({ confirmation: z.literal('DELETE') });
const contactSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    message: z.string().trim().min(1).max(3_000),
    name: z.string().trim().max(100).optional(),
    subject: z.string().trim().min(1).max(140),
    website: z.string().max(200).optional(),
  })
  .strict();
const googleCallbackSchema = z.object({
  code: z.string().min(1).max(4_096),
  state: z.string().min(1).max(512),
});
const googleStartSchema = z.object({
  platform: z.literal('android').optional(),
});
const mobileGoogleExchangeSchema = z.object({
  code: z.string().min(32).max(512),
});

export function isCameraOnline(
  lastSeenAt: Date | null,
  now = new Date(),
): boolean {
  return (
    lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW
  );
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({ error: 'Authentication required' });
}

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
  const limiter = new RateLimiter();
  const dummyPasswordHash = hashPassword(generateToken());
  const mobileGoogleHandoffs = new Map<
    string,
    { email: string; expiresAt: number; householdId: string; userId: string }
  >();
  const googleClient = config.GOOGLE_OAUTH_CLIENT_ID
    ? new OAuth2Client(
        config.GOOGLE_OAUTH_CLIENT_ID,
        config.GOOGLE_OAUTH_CLIENT_SECRET,
        config.GOOGLE_OAUTH_REDIRECT_URI,
      )
    : null;

  void app.register(cookie);
  void app.register(websocket, { options: { maxPayload: 1_100_000 } });
  const householdEvents = registerHouseholdEvents(app, config, store);
  const signaling = registerSignaling(app, config, store, householdEvents);
  app.addHook('onClose', async () => store.close());

  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionRecord | null> {
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const rawToken = bearerToken || request.cookies[config.SESSION_COOKIE_NAME];
    if (!rawToken) {
      unauthorized(reply);
      return null;
    }
    const session = await store.findSession(hashSecret(rawToken), new Date());
    if (!session) {
      unauthorized(reply);
      return null;
    }
    return session;
  }

  async function authenticateStateChange(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionRecord | null> {
    const session = await authenticate(request, reply);
    if (!session) return null;
    if (request.headers.authorization?.startsWith('Bearer ')) return session;
    const csrfHeader = request.headers['x-csrf-token'];
    const csrfCookie = request.cookies[CSRF_COOKIE];
    const origin = request.headers.origin;
    if (
      typeof csrfHeader !== 'string' ||
      !csrfCookie ||
      !secretsEqual(csrfHeader, csrfCookie) ||
      !secretsEqual(hashSecret(csrfHeader), session.csrfHash) ||
      (origin !== undefined && origin !== config.WEB_ORIGIN)
    ) {
      reply.code(403).send({ error: 'CSRF validation failed' });
      return null;
    }
    return session;
  }

  async function issueSession(
    reply: FastifyReply,
    userId: string,
    setCookies = true,
  ): Promise<string> {
    const token = generateToken();
    const csrfToken = generateToken();
    const now = Date.now();
    await store.createSession({
      absoluteExpiresAt: new Date(now + THIRTY_DAYS),
      csrfHash: hashSecret(csrfToken),
      idleExpiresAt: new Date(now + SEVEN_DAYS),
      reauthenticatedAt: new Date(now),
      tokenHash: hashSecret(token),
      userId,
    });
    if (!setCookies) return token;
    const cookieOptions = {
      path: '/',
      sameSite: 'lax' as const,
      secure: config.NODE_ENV === 'production',
    };
    reply.setCookie(config.SESSION_COOKIE_NAME, token, {
      ...cookieOptions,
      httpOnly: true,
      maxAge: THIRTY_DAYS / 1_000,
    });
    reply.setCookie(CSRF_COOKIE, csrfToken, {
      ...cookieOptions,
      httpOnly: false,
      maxAge: THIRTY_DAYS / 1_000,
    });
    return token;
  }

  app.get('/health', (): HealthResponse => ({
    service: 'backend',
    status: 'ok',
    timestamp: new Date().toISOString(),
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
    if (!body.success)
      return reply.code(400).send({ error: 'Invalid contact message' });
    if (body.data.website) return reply.code(204).send();
    try {
      await deliverContactMessage(config, body.data);
      return reply.code(204).send();
    } catch {
      return reply.code(503).send({ error: 'Contact delivery is unavailable' });
    }
  });

  app.post('/api/auth/register', async (request, reply) => {
    if (!limiter.take(`register:${request.ip}`, 5, HOUR)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid registration details' });
    }
    const email = normalizeEmail(parsed.data.email);
    try {
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await store.createAccount(email, passwordHash, request.ip);
      await issueSession(reply, user.id);
      return reply.code(201).send({ user: { email: user.email, id: user.id } });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        return reply.code(409).send({ error: 'Unable to create account' });
      }
      throw error;
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    const email = parsed.success ? normalizeEmail(parsed.data.email) : '';
    if (
      !limiter.take(
        `login:${request.ip}:${hashSecret(email)}`,
        10,
        FIFTEEN_MINUTES,
      )
    ) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const user = parsed.success ? await store.findUserByEmail(email) : null;
    const passwordHash = user?.passwordHash ?? (await dummyPasswordHash);
    const password = parsed.success ? parsed.data.password : generateToken();
    const passwordMatches = await verifyPassword(passwordHash, password);
    const valid = Boolean(user && parsed.success && passwordMatches);
    await store.audit(
      valid && user
        ? {
            eventType: 'login_succeeded',
            householdId: user.householdId,
            ipAddress: request.ip,
            success: true,
            userId: user.id,
          }
        : {
            eventType: 'login_failed',
            ipAddress: request.ip,
            success: false,
          },
    );
    if (!valid || !user) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    await issueSession(reply, user.id);
    return reply.send({ user: { email: user.email, id: user.id } });
  });

  app.get('/api/auth/google', async (request, reply) => {
    if (!googleClient || !config.GOOGLE_OAUTH_REDIRECT_URI)
      return reply.code(503).send({ error: 'Google sign-in is unavailable' });
    const start = googleStartSchema.safeParse(request.query);
    if (!start.success)
      return reply.code(400).send({ error: 'Invalid sign-in request' });
    const android = start.data.platform === 'android';
    const state = `${android ? 'android.' : 'web.'}${generateToken()}`;
    reply.setCookie(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: TEN_MINUTES / 1_000,
      path: '/',
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
    });
    return reply.redirect(
      googleClient.generateAuthUrl({
        access_type: 'online',
        prompt: 'select_account',
        redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
        scope: ['openid', 'email', 'profile'],
        state,
      }),
    );
  });

  app.get(
    '/api/auth/google/callback',
    { logLevel: 'silent' },
    async (request, reply) => {
      const callback = googleCallbackSchema.safeParse(request.query);
      const state = request.cookies[GOOGLE_STATE_COOKIE];
      const googleClientId = config.GOOGLE_OAUTH_CLIENT_ID;
      const googleRedirectUri = config.GOOGLE_OAUTH_REDIRECT_URI;
      const android = state?.startsWith('android.') === true;
      reply.clearCookie(GOOGLE_STATE_COOKIE, { path: '/' });
      if (
        !googleClient ||
        !googleClientId ||
        !googleRedirectUri ||
        !callback.success ||
        !state ||
        !secretsEqual(state, callback.data.state)
      ) {
        return reply.redirect(
          android ? '/auth/mobile#status=failed' : '/?googleSignIn=failed',
        );
      }
      try {
        const token = await googleClient.getToken({
          code: callback.data.code,
          redirect_uri: googleRedirectUri,
        });
        if (!token.tokens.id_token)
          return reply.redirect(
            android ? '/auth/mobile#status=failed' : '/?googleSignIn=failed',
          );
        const ticket = await googleClient.verifyIdToken({
          audience: googleClientId,
          idToken: token.tokens.id_token,
        });
        const payload = ticket.getPayload();
        if (
          !payload?.sub ||
          !payload.email ||
          payload.email_verified !== true
        ) {
          return reply.redirect(
            android ? '/auth/mobile#status=failed' : '/?googleSignIn=failed',
          );
        }
        const email = normalizeEmail(payload.email);
        const avatarUrl = payload.picture ?? null;
        let user = await store.findUserByGoogleSubject(payload.sub);
        if (!user) {
          if (await store.findUserByEmail(email)) {
            return reply.redirect(
              android
                ? '/auth/mobile#status=linkRequired'
                : '/?googleSignIn=linkRequired',
            );
          }
          user = await store.createGoogleAccount(
            email,
            payload.sub,
            request.ip,
            avatarUrl,
          );
        } else if (avatarUrl && avatarUrl !== user.avatarUrl) {
          await store.updateGoogleAvatar(user.id, avatarUrl);
          user = { ...user, avatarUrl };
        }
        await store.audit({
          eventType: 'google_login_succeeded',
          householdId: user.householdId,
          ipAddress: request.ip,
          success: true,
          userId: user.id,
        });
        if (android) {
          const handoffCode = generateToken();
          const now = Date.now();
          for (const [key, value] of mobileGoogleHandoffs) {
            if (value.expiresAt <= now) mobileGoogleHandoffs.delete(key);
          }
          mobileGoogleHandoffs.set(hashSecret(handoffCode), {
            email: user.email,
            expiresAt: now + TEN_MINUTES,
            householdId: user.householdId,
            userId: user.id,
          });
          return reply.redirect(
            `/auth/mobile#code=${encodeURIComponent(handoffCode)}`,
          );
        }
        await issueSession(reply, user.id);
        return reply.redirect('/');
      } catch {
        return reply.redirect(
          android ? '/auth/mobile#status=failed' : '/?googleSignIn=failed',
        );
      }
    },
  );

  app.post('/api/mobile/auth/google', async (request, reply) => {
    const parsed = mobileGoogleExchangeSchema.safeParse(request.body);
    if (
      !parsed.success ||
      !limiter.take(`mobile-google:${request.ip}`, 10, FIFTEEN_MINUTES)
    ) {
      return reply
        .code(401)
        .send({ error: 'Google sign-in could not be completed' });
    }
    const handoff = mobileGoogleHandoffs.get(hashSecret(parsed.data.code));
    mobileGoogleHandoffs.delete(hashSecret(parsed.data.code));
    if (!handoff || handoff.expiresAt <= Date.now()) {
      return reply
        .code(401)
        .send({ error: 'Google sign-in could not be completed' });
    }
    await store.audit({
      eventType: 'mobile_google_login_succeeded',
      householdId: handoff.householdId,
      ipAddress: request.ip,
      success: true,
      userId: handoff.userId,
    });
    const token = await issueSession(reply, handoff.userId, false);
    return reply.send({
      sessionToken: token,
      user: { email: handoff.email, id: handoff.userId },
    });
  });

  app.post('/api/mobile/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    const email = parsed.success ? normalizeEmail(parsed.data.email) : '';
    if (
      !limiter.take(
        `mobile-login:${request.ip}:${hashSecret(email)}`,
        10,
        FIFTEEN_MINUTES,
      )
    ) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const user = parsed.success ? await store.findUserByEmail(email) : null;
    const passwordHash = user?.passwordHash ?? (await dummyPasswordHash);
    const password = parsed.success ? parsed.data.password : generateToken();
    const passwordMatches = await verifyPassword(passwordHash, password);
    if (!user || !parsed.success || !passwordMatches) {
      await store.audit({
        eventType: 'mobile_login_failed',
        ipAddress: request.ip,
        success: false,
      });
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    await store.audit({
      eventType: 'mobile_login_succeeded',
      householdId: user.householdId,
      ipAddress: request.ip,
      success: true,
      userId: user.id,
    });
    const token = await issueSession(reply, user.id, false);
    return reply.send({
      sessionToken: token,
      user: { email: user.email, id: user.id },
    });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    return {
      user: {
        avatarUrl: session.avatarUrl,
        email: session.email,
        id: session.userId,
      },
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    await store.revokeSession(session.id);
    await store.audit({
      eventType: 'logout',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/account/sessions', async (request, reply) => {
    const current = await authenticate(request, reply);
    if (!current) return;
    const sessions = await store.listBrowserSessions(current.userId);
    return {
      sessions: sessions.map((session) => ({
        createdAt: session.createdAt.toISOString(),
        current: session.id === current.id,
        expiresAt: session.absoluteExpiresAt.toISOString(),
        id: session.id,
        lastSeenAt: session.lastSeenAt.toISOString(),
      })),
    };
  });

  app.delete('/api/account/sessions/:sessionId', async (request, reply) => {
    const current = await authenticateStateChange(request, reply);
    if (!current) return;
    const parameters = sessionParameterSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Session not found' });
    const revoked = await store.revokeBrowserSession(
      current.userId,
      parameters.data.sessionId,
    );
    if (!revoked) return reply.code(404).send({ error: 'Session not found' });
    await store.audit({
      eventType: 'browser_session_revoked',
      householdId: current.householdId,
      ipAddress: request.ip,
      success: true,
      userId: current.userId,
    });
    if (parameters.data.sessionId === current.id) {
      reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
      reply.clearCookie(CSRF_COOKIE, { path: '/' });
    }
    return reply.code(204).send();
  });

  app.delete('/api/account', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const body = accountDeletionSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'Account deletion was not confirmed' });
    if (Date.now() - session.reauthenticatedAt.getTime() > TEN_MINUTES) {
      return reply.code(403).send({
        error: 'Sign in again, then retry account deletion within 10 minutes',
      });
    }
    const cameras = await store.listCameras(session.householdId);
    for (const camera of cameras) {
      signaling.disconnectCamera(camera.publicCameraId, 'device_deleted');
    }
    const deleted = await store.deleteAccount(session.userId);
    if (!deleted) return reply.code(404).send({ error: 'Account not found' });
    await store.audit({
      eventType: 'account_deleted',
      ipAddress: request.ip,
      success: true,
    });
    reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.post('/api/pairing-codes', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    if (!limiter.take(`pairing-create:${session.userId}`, 10, HOUR)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + TEN_MINUTES);
    const id = await store.createPairingCode(
      session.householdId,
      hashSecret(code),
      expiresAt,
    );
    await store.audit({
      eventType: 'pairing_code_created',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    return reply
      .code(201)
      .send({ code, expiresAt: expiresAt.toISOString(), id });
  });

  app.delete('/api/pairing-codes/:pairingCodeId', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parsed = pairingCodeParameterSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(404).send({ error: 'Pairing code not found' });
    }
    const revoked = await store.revokePairingCode(
      session.householdId,
      parsed.data.pairingCodeId,
    );
    return revoked
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Pairing code not found' });
  });

  app.post('/api/devices/register', async (request, reply) => {
    const parsed = registerDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Unable to pair device' });
    }
    const key = `${request.ip}:${parsed.data.installationId}`;
    if (!limiter.take(`pairing-redeem:${key}`, 10, FIFTEEN_MINUTES)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const credential = generateToken();
    const result = await store.redeemPairingCode({
      codeHash: hashSecret(parsed.data.pairingCode.toUpperCase()),
      credentialHash: hashSecret(credential),
      installationId: parsed.data.installationId,
      ipAddress: request.ip,
      name: parsed.data.name,
      now: new Date(),
    });
    if (result === DEVICE_REGISTRATION_RATE_LIMITED) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    if (!result) {
      return reply.code(400).send({ error: 'Unable to pair device' });
    }
    const pairedIdentity = await store.findDeviceByCredential(
      hashSecret(credential),
    );
    if (pairedIdentity) {
      householdEvents.publish(pairedIdentity.householdId, {
        cameraId: result.publicCameraId,
        pairingState: 'completed',
        type: 'camera-paired',
      });
    }
    return reply.code(201).send({
      camera: { id: result.publicCameraId, name: result.name },
      device: { id: result.publicDeviceId, name: result.name },
      credential,
    });
  });

  app.put('/api/device/cameras', async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const parsed = syncCameraSourcesSchema.safeParse(request.body);
    if (!token || !parsed.success) return unauthorized(reply);
    const cameras = await store.syncDeviceCameras(
      hashSecret(token),
      parsed.data.sources,
      new Date(),
    );
    if (!cameras) return unauthorized(reply);
    return {
      cameras: cameras.map((camera) => ({
        facing: camera.facing,
        id: camera.publicCameraId,
        name: camera.name,
        sourceKey: camera.sourceKey,
        streaming:
          signaling.cameraStatus(camera.publicCameraId).viewerCount > 0,
        viewerCount: signaling.cameraStatus(camera.publicCameraId).viewerCount,
      })),
      privacyMode: cameras[0]?.privacyMode ?? false,
    };
  });

  app.post('/api/browser-devices', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parsed = browserDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid browser camera details' });
    }
    const result = await store.registerBrowserDevice({
      householdId: session.householdId,
      installationId: parsed.data.installationId,
      name: parsed.data.name,
      now: new Date(),
      sources: parsed.data.sources,
    });
    for (const camera of result.cameras) {
      householdEvents.publish(session.householdId, {
        cameraId: camera.publicCameraId,
        type: 'camera-presence-changed',
      });
    }
    return reply.code(201).send({
      cameras: result.cameras.map((camera) => ({
        facing: camera.facing,
        id: camera.publicCameraId,
        name: camera.name,
        sourceKey: camera.sourceKey,
      })),
      device: {
        id: result.device.publicDeviceId,
        name: result.device.name,
        platform: result.device.platform,
      },
    });
  });

  app.get('/api/cameras', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const now = Date.now();
    const cameras = await store.listCameras(session.householdId);
    return {
      cameras: cameras.map((camera) => {
        const status = signaling.cameraStatus(camera.publicCameraId);
        return {
          availability: status.producerConnected ? 'available' : 'unavailable',
          credentialRevoked: camera.credentialRevokedAt !== null,
          capabilities: camera.capabilities,
          deviceId: camera.publicDeviceId,
          deviceName: camera.deviceName,
          enabled: camera.enabled,
          facing: camera.facing,
          id: camera.publicCameraId,
          lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
          name: camera.name,
          online:
            camera.enabled &&
            !camera.privacyMode &&
            (status.producerConnected ||
              isCameraOnline(camera.lastSeenAt, new Date(now))),
          platform: camera.platform,
          privacyMode: camera.privacyMode,
          sourceKey: camera.sourceKey,
          streaming: status.viewerCount > 0,
          viewerCount: status.viewerCount,
        };
      }),
    };
  });

  app.get('/api/devices', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const devices = await store.listDevices(session.householdId);
    return {
      devices: devices.map((device) => ({
        deviceType: device.deviceType,
        capabilities: device.capabilities,
        batteryPercent: device.batteryPercent,
        batteryCharging: device.batteryCharging,
        healthReportedAt: device.healthReportedAt?.toISOString() ?? null,
        enabled: device.enabled,
        privacyMode: device.privacyMode,
        id: device.publicDeviceId,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        name: device.name,
        online: device.enabled && isCameraOnline(device.lastSeenAt),
        platform: device.platform,
        revoked: device.revokedAt !== null,
        softwareVersion: device.softwareVersion,
      })),
    };
  });

  app.get('/api/devices/:deviceId', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.code(404).send({ error: 'Device not found' });
    }
    const [devices, cameras] = await Promise.all([
      store.listDevices(session.householdId),
      store.listCameras(session.householdId),
    ]);
    const device = devices.find(
      (candidate) => candidate.publicDeviceId === parameters.data.deviceId,
    );
    if (!device) return reply.code(404).send({ error: 'Device not found' });
    const now = new Date();
    const childCameras = cameras
      .filter((camera) => camera.publicDeviceId === device.publicDeviceId)
      .map((camera) => {
        const status = signaling.cameraStatus(camera.publicCameraId);
        return {
          availability: status.producerConnected ? 'available' : 'unavailable',
          capabilities: camera.capabilities,
          credentialRevoked: camera.credentialRevokedAt !== null,
          deviceId: camera.publicDeviceId,
          deviceName: camera.deviceName,
          enabled: camera.enabled,
          facing: camera.facing,
          id: camera.publicCameraId,
          lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
          name: camera.name,
          online:
            camera.enabled &&
            !camera.privacyMode &&
            (status.producerConnected ||
              isCameraOnline(camera.lastSeenAt, now)),
          platform: camera.platform,
          privacyMode: camera.privacyMode,
          sourceKey: camera.sourceKey,
          streaming: status.viewerCount > 0,
          viewerCount: status.viewerCount,
        };
      });
    return {
      cameras: childCameras,
      device: {
        aggregateViewerCount: childCameras.reduce(
          (total, camera) => total + camera.viewerCount,
          0,
        ),
        capabilities: {
          maxSimultaneousSources: 1,
          simultaneousCapture: false,
          ...device.capabilities,
        },
        deviceType: device.deviceType,
        enabled: device.enabled,
        privacyMode: device.privacyMode,
        id: device.publicDeviceId,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        name: device.name,
        online: device.enabled && isCameraOnline(device.lastSeenAt, now),
        platform: device.platform,
        revoked: device.revokedAt !== null,
        softwareVersion: device.softwareVersion,
      },
    };
  });

  app.get('/api/cameras/:cameraId', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    const cameras = await store.listCameras(session.householdId);
    const camera = cameras.find(
      (candidate) => candidate.publicCameraId === parameters.data.cameraId,
    );
    if (!camera) return reply.code(404).send({ error: 'Camera not found' });
    const status = signaling.cameraStatus(camera.publicCameraId);
    return {
      camera: {
        availability: status.producerConnected ? 'available' : 'unavailable',
        capabilities: camera.capabilities,
        credentialRevoked: camera.credentialRevokedAt !== null,
        deviceId: camera.publicDeviceId,
        deviceName: camera.deviceName,
        enabled: camera.enabled,
        facing: camera.facing,
        id: camera.publicCameraId,
        lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
        name: camera.name,
        online:
          camera.enabled &&
          !camera.privacyMode &&
          (status.producerConnected || isCameraOnline(camera.lastSeenAt)),
        platform: camera.platform,
        privacyMode: camera.privacyMode,
        sourceKey: camera.sourceKey,
        streaming: status.viewerCount > 0,
        viewerCount: status.viewerCount,
      },
    };
  });

  app.patch('/api/devices/:deviceId', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    const body = updateDeviceSchema.safeParse(request.body);
    if (
      !parameters.success ||
      !body.success ||
      !(await store.updateDevice(
        session.householdId,
        parameters.data.deviceId,
        body.data,
      ))
    ) {
      return reply.code(404).send({ error: 'Device not found' });
    }
    if (body.data.enabled === false) {
      const cameras = await store.listCameras(session.householdId);
      for (const camera of cameras.filter(
        (candidate) => candidate.publicDeviceId === parameters.data.deviceId,
      )) {
        signaling.disconnectCamera(camera.publicCameraId, 'device_disabled');
        householdEvents.publish(session.householdId, {
          cameraId: camera.publicCameraId,
          type: 'camera-presence-changed',
        });
      }
    } else {
      householdEvents.publish(session.householdId, {
        type: 'device-management-changed',
      });
    }
    return reply.code(204).send();
  });

  app.put('/api/devices/:deviceId/privacy', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    const body = privacyModeSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.code(400).send({ error: 'Invalid privacy mode request' });
    }
    const devices = await store.listDevices(session.householdId);
    const device = devices.find(
      (candidate) => candidate.publicDeviceId === parameters.data.deviceId,
    );
    if (!device) return reply.code(404).send({ error: 'Device not found' });
    if (device.platform !== 'android') {
      return reply.code(409).send({
        error: 'Privacy mode currently requires an Android camera device',
      });
    }
    const deviceId = await store.setPrivacyMode(
      session.householdId,
      parameters.data.deviceId,
      body.data.enabled,
    );
    if (!deviceId) return reply.code(404).send({ error: 'Device not found' });
    const cameras = await store.listCameras(session.householdId);
    for (const camera of cameras.filter(
      (candidate) => candidate.publicDeviceId === parameters.data.deviceId,
    )) {
      signaling.setPrivacyMode(camera.publicCameraId, body.data.enabled);
    }
    await store.audit({
      cameraId: deviceId,
      eventType: body.data.enabled ? 'privacy_enabled' : 'privacy_disabled',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    householdEvents.publish(session.householdId, {
      type: 'device-management-changed',
    });
    return reply.code(200).send({ privacyMode: body.data.enabled });
  });

  app.patch('/api/cameras/:cameraId', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    const body = updateCameraSchema.safeParse(request.body);
    if (
      !parameters.success ||
      !body.success ||
      !(await store.updateCamera(
        session.householdId,
        parameters.data.cameraId,
        body.data,
      ))
    ) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    householdEvents.publish(session.householdId, {
      cameraId: parameters.data.cameraId,
      type: 'camera-presence-changed',
    });
    if (body.data.enabled === false) {
      signaling.disconnectCamera(parameters.data.cameraId, 'camera_disabled');
    }
    return reply.code(204).send();
  });

  app.post('/api/devices/:deviceId/revoke', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.code(404).send({ error: 'Device not found' });
    }
    const deviceId = parameters.data.deviceId;
    const revoked = await store.revokeDevice(session.householdId, deviceId);
    if (!revoked) return reply.code(404).send({ error: 'Device not found' });
    const cameras = await store.listCameras(session.householdId);
    for (const camera of cameras.filter(
      (candidate) => candidate.publicDeviceId === deviceId,
    )) {
      signaling.disconnectCamera(camera.publicCameraId, 'device_revoked');
    }
    await store.audit({
      cameraId: revoked,
      eventType: 'device_credential_revoked',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    householdEvents.publish(session.householdId, {
      type: 'device-credential-revoked',
    });
    return reply.code(204).send();
  });

  app.delete('/api/devices/:deviceId', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.code(404).send({ error: 'Device not found' });
    }
    const cameras = (await store.listCameras(session.householdId)).filter(
      (camera) => camera.publicDeviceId === parameters.data.deviceId,
    );
    for (const camera of cameras) {
      signaling.disconnectCamera(camera.publicCameraId, 'device_deleted');
    }
    const deleted = await store.deleteDevice(
      session.householdId,
      parameters.data.deviceId,
    );
    if (!deleted) return reply.code(404).send({ error: 'Device not found' });
    await store.audit({
      eventType: 'device_deleted',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    householdEvents.publish(session.householdId, {
      type: 'device-management-changed',
    });
    return reply.code(204).send();
  });

  app.delete('/api/cameras/:cameraId', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    if (
      !parameters.success ||
      !(await store.deleteCamera(session.householdId, parameters.data.cameraId))
    ) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    signaling.disconnectCamera(parameters.data.cameraId, 'camera_removed');
    householdEvents.publish(session.householdId, {
      cameraId: parameters.data.cameraId,
      type: 'camera-presence-changed',
    });
    return reply.code(204).send();
  });

  app.post('/api/devices/:deviceId/restart', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    const devices = await store.listDevices(session.householdId);
    if (
      !parameters.success ||
      !devices.some(
        (device) => device.publicDeviceId === parameters.data.deviceId,
      )
    ) {
      return reply.code(404).send({ error: 'Device not found' });
    }
    const cameras = await store.listCameras(session.householdId);
    for (const camera of cameras.filter(
      (candidate) => candidate.publicDeviceId === parameters.data.deviceId,
    )) {
      signaling.disconnectCamera(camera.publicCameraId, 'device_restart');
    }
    householdEvents.publish(session.householdId, {
      type: 'device-management-changed',
    });
    return reply.code(202).send({ state: 'reconnecting' });
  });

  app.post('/api/cameras/:cameraId/restart', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    const cameras = await store.listCameras(session.householdId);
    if (
      !parameters.success ||
      !cameras.some(
        (camera) => camera.publicCameraId === parameters.data.cameraId,
      )
    ) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    signaling.disconnectCamera(parameters.data.cameraId, 'source_restart');
    householdEvents.publish(session.householdId, {
      cameraId: parameters.data.cameraId,
      type: 'camera-presence-changed',
    });
    return reply.code(202).send({ state: 'reconnecting' });
  });

  app.post('/api/cameras/:cameraId/activate', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    const cameras = await store.listCameras(session.householdId);
    const target = parameters.success
      ? cameras.find(
          (camera) =>
            camera.publicCameraId === parameters.data.cameraId &&
            camera.enabled &&
            camera.credentialRevokedAt === null,
        )
      : undefined;
    if (!target) return reply.code(404).send({ error: 'Camera not found' });
    const siblings = cameras
      .filter((camera) => camera.publicDeviceId === target.publicDeviceId)
      .map((camera) => camera.publicCameraId);
    const requested = signaling.requestSourceSwitch(
      siblings,
      target.publicCameraId,
    );
    if (!requested) {
      return reply.code(409).send({
        error:
          'Device is offline; source switch will be available when it reconnects',
      });
    }
    householdEvents.publish(session.householdId, {
      cameraId: target.publicCameraId,
      type: 'camera-presence-changed',
    });
    return reply.code(202).send({ state: 'switching' });
  });

  app.get('/api/diagnostics', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const [cameras, devices] = await Promise.all([
      store.listCameras(session.householdId),
      store.listDevices(session.householdId),
    ]);
    return {
      cameras: cameras.map((camera) => {
        const status = signaling.cameraStatus(camera.publicCameraId);
        return {
          availability: status.producerConnected ? 'online' : 'offline',
          capabilities: camera.capabilities,
          cameraId: camera.publicCameraId,
          captureState: status.viewerCount > 0 ? 'streaming' : 'idle',
          deviceId: camera.publicDeviceId,
          facing: camera.facing,
          producerConnected: status.producerConnected,
          sourceKey: camera.sourceKey,
          viewerConnectionIds: status.connectionIds,
          viewerCount: status.viewerCount,
        };
      }),
      devices: devices.map((device) => ({
        connectionState: device.revokedAt
          ? 'revoked'
          : !device.enabled
            ? 'disabled'
            : isCameraOnline(device.lastSeenAt)
              ? 'online'
              : 'offline',
        deviceId: device.publicDeviceId,
        capabilities: device.capabilities,
        enabled: device.enabled,
        lastHeartbeatAt: device.lastSeenAt?.toISOString() ?? null,
        platform: device.platform,
        softwareVersion: device.softwareVersion,
      })),
    };
  });

  app.get('/api/access-history', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const events = await store.listAccessHistory(session.householdId);
    return {
      events: events.map((event) => ({
        actorEmail: event.actorEmail,
        deviceName: event.deviceName,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        success: event.success,
      })),
    };
  });

  app.get('/api/devices/:deviceId/motion-settings', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(400).send({ error: 'Invalid device' });
    return {
      cameras: await store.listMotionSettings(
        session.householdId,
        parameters.data.deviceId,
      ),
    };
  });

  app.put('/api/cameras/:cameraId/motion-settings', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    const settings = motionSettingsSchema.safeParse(request.body);
    if (!parameters.success || !settings.success)
      return reply.code(400).send({ error: 'Invalid motion settings' });
    const result = await store.updateMotionSettings(
      session.householdId,
      parameters.data.cameraId,
      settings.data,
    );
    if (!result) return reply.code(404).send({ error: 'Camera unavailable' });
    await store.audit({
      eventType: 'motion_settings_changed',
      householdId: session.householdId,
      userId: session.userId,
      success: true,
      ipAddress: request.ip,
      metadata: { cameraId: result.cameraId },
    });
    return { settings: result };
  });

  app.get('/api/device/motion-settings', async (request, reply) => {
    const token = request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice('Bearer '.length)
      : '';
    const identity = token
      ? await store.findDeviceByCredential(hashSecret(token))
      : null;
    if (!identity) return unauthorized(reply);
    return {
      cameras: await store.listMotionSettings(
        identity.householdId,
        identity.publicDeviceId,
      ),
    };
  });

  app.get('/api/motion-events', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const query = parseMotionHistoryQuery(request.query);
    if (!query)
      return reply.code(400).send({ error: 'Invalid motion history filters' });
    const rows = await store.listMotionEvents(session.householdId, {
      ...query,
      limit: query.limit + 1,
    });
    const events = rows.slice(0, query.limit);
    return {
      nextCursor:
        rows.length > query.limit
          ? motionHistoryCursor(events[events.length - 1]!)
          : null,
      events: events.map((event) => ({
        id: event.id,
        cameraId: event.publicCameraId,
        cameraName: event.cameraName,
        deviceName: event.deviceName,
        confidence: Number(event.confidence.toFixed(4)),
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  });

  app.delete('/api/motion-events', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const deleted = await store.clearMotionEvents(session.householdId);
    await store.audit({
      eventType: 'motion_history_cleared',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { deletedCount: String(deleted) },
      success: true,
      userId: session.userId,
    });
    householdEvents.publish(session.householdId, {
      type: 'motion-history-cleared',
    });
    return reply.code(204).send();
  });

  app.get('/api/motion-retention', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const retention = await store.getMotionRetention(session.householdId);
    if (!retention)
      return reply.code(404).send({ error: 'Household unavailable' });
    return retention;
  });

  app.put('/api/motion-retention', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const body = motionRetentionSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'Invalid motion retention setting' });
    const retention = await store.updateMotionRetention(
      session.householdId,
      body.data.days,
    );
    if (!retention)
      return reply.code(404).send({ error: 'Household unavailable' });
    await store.audit({
      eventType: 'motion_retention_changed',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { days: String(retention.days) },
      success: true,
      userId: session.userId,
    });
    return retention;
  });

  app.delete('/api/cameras/:cameraId/credential', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parsed = cameraParameterSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    const householdCameras = await store.listCameras(session.householdId);
    const ownedCamera = householdCameras.find(
      (camera) => camera.publicCameraId === parsed.data.cameraId,
    );
    const revokedCameraId = ownedCamera
      ? await store.revokeDevice(
          session.householdId,
          ownedCamera.publicDeviceId,
        )
      : null;
    if (!revokedCameraId) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    for (const camera of householdCameras.filter(
      (camera) => camera.publicDeviceId === ownedCamera!.publicDeviceId,
    )) {
      signaling.disconnectCamera(camera.publicCameraId, 'device_revoked');
    }
    await store.audit({
      cameraId: revokedCameraId,
      eventType: 'device_credential_revoked',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    householdEvents.publish(session.householdId, {
      cameraId: parsed.data.cameraId,
      type: 'device-credential-revoked',
    });
    return reply.code(204).send();
  });

  app.post('/api/device/heartbeat', async (request, reply) => {
    const health = heartbeatSchema.safeParse(request.body);
    if (!health.success)
      return reply.code(400).send({ error: 'Invalid device health' });
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const identity = token
      ? await store.findDeviceByCredential(hashSecret(token))
      : null;
    const cameraId =
      token && identity
        ? await store.heartbeat(
            hashSecret(token),
            new Date(),
            health.data.batteryPercent === undefined
              ? undefined
              : {
                  batteryPercent: health.data.batteryPercent,
                  batteryCharging: health.data.batteryCharging!,
                },
          )
        : null;
    if (!cameraId) return unauthorized(reply);
    householdEvents.publish(identity!.householdId, {
      cameraId: identity!.publicCameraId,
      type: 'camera-presence-changed',
    });
    return reply.code(204).send();
  });

  app.post(
    '/api/device/cameras/:cameraId/motion-events',
    async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      const parameters = cameraParameterSchema.safeParse(request.params);
      const body = motionEventSchema.safeParse(request.body);
      if (!token) return unauthorized(reply);
      if (!parameters.success || !body.success) {
        return reply.code(400).send({ error: 'Invalid motion event' });
      }
      const result = await store.createMotionEvent({
        confidence: body.data.confidence,
        credentialHash: hashSecret(token),
        now: new Date(),
        publicCameraId: parameters.data.cameraId,
      });
      if (!result) {
        // Privacy/source restrictions suppress a report without revoking the
        // device's registration. Never tell Android to discard a valid pairing.
        const device = await store.findDeviceByCredential(hashSecret(token));
        if (!device) return unauthorized(reply);
        return reply
          .code(409)
          .send({ error: 'Motion reporting is paused or unavailable' });
      }
      if (!result.created) return reply.code(204).send();
      householdEvents.publish(result.householdId, {
        cameraId: parameters.data.cameraId,
        type: 'motion-event-created',
      });
      return reply.code(201).send({ created: true });
    },
  );

  app.put('/api/device/privacy', async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const body = privacyModeSchema.safeParse(request.body);
    const identity = token
      ? await store.findDeviceByCredential(hashSecret(token))
      : null;
    if (!identity) return unauthorized(reply);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid privacy mode request' });
    }
    const deviceId = await store.setPrivacyMode(
      identity.householdId,
      identity.publicDeviceId,
      body.data.enabled,
    );
    if (!deviceId) return unauthorized(reply);
    const cameras = await store.listCameras(identity.householdId);
    for (const camera of cameras.filter(
      (candidate) => candidate.publicDeviceId === identity.publicDeviceId,
    )) {
      signaling.setPrivacyMode(camera.publicCameraId, body.data.enabled);
    }
    await store.audit({
      cameraId: deviceId,
      eventType: body.data.enabled ? 'privacy_enabled' : 'privacy_disabled',
      householdId: identity.householdId,
      ipAddress: request.ip,
      success: true,
    });
    householdEvents.publish(identity.householdId, {
      type: 'device-management-changed',
    });
    return reply.code(200).send({ privacyMode: body.data.enabled });
  });

  app.delete('/api/device/registration', async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const identity = token
      ? await store.findDeviceByCredential(hashSecret(token))
      : null;
    if (!identity) return unauthorized(reply);
    const cameras = (await store.listCameras(identity.householdId)).filter(
      (camera) => camera.publicDeviceId === identity.publicDeviceId,
    );
    const deleted = await store.deleteDevice(
      identity.householdId,
      identity.publicDeviceId,
    );
    if (!deleted) return reply.code(404).send({ error: 'Device not found' });
    for (const camera of cameras) {
      signaling.disconnectCamera(camera.publicCameraId, 'device_deleted');
    }
    await store.audit({
      eventType: 'device_self_removed',
      householdId: identity.householdId,
      ipAddress: request.ip,
      success: true,
    });
    householdEvents.publish(identity.householdId, {
      type: 'device-management-changed',
    });
    return reply.code(204).send();
  });

  return app;
}
