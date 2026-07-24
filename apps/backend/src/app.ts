import cookie from '@fastify/cookie';
import type { HealthResponse } from '@beacon/shared-types';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import { RateLimiter } from './rate-limit.js';
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

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(128),
});
const registerDeviceSchema = z.object({
  installationId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  pairingCode: z.string().trim().min(1).max(32),
});
const cameraParameterSchema = z.object({ cameraId: z.string().uuid() });
const pairingCodeParameterSchema = z.object({
  pairingCodeId: z.string().uuid(),
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

  void app.register(cookie);
  app.addHook('onClose', async () => store.close());

  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionRecord | null> {
    const rawToken = request.cookies[config.SESSION_COOKIE_NAME];
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
  ): Promise<void> {
    const token = generateToken();
    const csrfToken = generateToken();
    const now = Date.now();
    await store.createSession({
      absoluteExpiresAt: new Date(now + THIRTY_DAYS),
      csrfHash: hashSecret(csrfToken),
      idleExpiresAt: new Date(now + SEVEN_DAYS),
      tokenHash: hashSecret(token),
      userId,
    });
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
  }

  app.get('/health', (): HealthResponse => ({
    service: 'backend',
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

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

  app.get('/api/auth/me', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    return { user: { email: session.email, id: session.userId } };
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
    return reply.code(201).send({
      camera: { id: result.publicDeviceId, name: result.name },
      credential,
    });
  });

  app.get('/api/cameras', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const now = Date.now();
    const cameras = await store.listCameras(session.householdId);
    return {
      cameras: cameras.map((camera) => ({
        credentialRevoked: camera.credentialRevokedAt !== null,
        id: camera.publicDeviceId,
        lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
        name: camera.name,
        online: isCameraOnline(camera.lastSeenAt, new Date(now)),
      })),
    };
  });

  app.delete('/api/cameras/:cameraId/credential', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parsed = cameraParameterSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    const revokedCameraId = await store.revokeDevice(
      session.householdId,
      parsed.data.cameraId,
    );
    if (!revokedCameraId) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    await store.audit({
      cameraId: revokedCameraId,
      eventType: 'device_credential_revoked',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    return reply.code(204).send();
  });

  app.post('/api/device/heartbeat', async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const cameraId = token
      ? await store.heartbeat(hashSecret(token), new Date())
      : null;
    if (!cameraId) return unauthorized(reply);
    return reply.code(204).send();
  });

  return app;
}
