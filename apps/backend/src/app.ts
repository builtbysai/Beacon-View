import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import type { HealthResponse } from '@beacon/shared-types';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import { RateLimiter } from './rate-limit.js';
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
const updateDeviceSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
const updateCameraSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.name !== undefined);
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
  void app.register(websocket, { options: { maxPayload: 1_100_000 } });
  const householdEvents = registerHouseholdEvents(app, config, store);
  const signaling = registerSignaling(app, config, store, householdEvents);
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
          credentialRevoked: camera.credentialRevokedAt !== null,
          deviceId: camera.publicDeviceId,
          deviceName: camera.deviceName,
          enabled: camera.enabled,
          facing: camera.facing,
          id: camera.publicCameraId,
          lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
          name: camera.name,
          online:
            status.producerConnected ||
            isCameraOnline(camera.lastSeenAt, new Date(now)),
          platform: camera.platform,
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
        id: device.publicDeviceId,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        name: device.name,
        online: isCameraOnline(device.lastSeenAt),
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
          credentialRevoked: camera.credentialRevokedAt !== null,
          deviceId: camera.publicDeviceId,
          deviceName: camera.deviceName,
          enabled: camera.enabled,
          facing: camera.facing,
          id: camera.publicCameraId,
          lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
          name: camera.name,
          online:
            status.producerConnected || isCameraOnline(camera.lastSeenAt, now),
          platform: camera.platform,
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
        },
        deviceType: device.deviceType,
        id: device.publicDeviceId,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        name: device.name,
        online: isCameraOnline(device.lastSeenAt, now),
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
        credentialRevoked: camera.credentialRevokedAt !== null,
        deviceId: camera.publicDeviceId,
        deviceName: camera.deviceName,
        enabled: camera.enabled,
        facing: camera.facing,
        id: camera.publicCameraId,
        lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
        name: camera.name,
        online: status.producerConnected || isCameraOnline(camera.lastSeenAt),
        platform: camera.platform,
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
        body.data.name,
      ))
    ) {
      return reply.code(404).send({ error: 'Device not found' });
    }
    return reply.code(204).send();
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
    return reply.code(204).send();
  });

  app.delete('/api/devices/:deviceId', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    const revoked = parameters.success
      ? await store.revokeDevice(session.householdId, parameters.data.deviceId)
      : null;
    if (!revoked) return reply.code(404).send({ error: 'Device not found' });
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
          : isCameraOnline(device.lastSeenAt)
            ? 'online'
            : 'offline',
        deviceId: device.publicDeviceId,
        lastHeartbeatAt: device.lastSeenAt?.toISOString() ?? null,
        platform: device.platform,
        softwareVersion: device.softwareVersion,
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
    const ownedCamera = await store.findOwnedCamera(
      session.householdId,
      parsed.data.cameraId,
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
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const identity = token
      ? await store.findDeviceByCredential(hashSecret(token))
      : null;
    const cameraId =
      token && identity
        ? await store.heartbeat(hashSecret(token), new Date())
        : null;
    if (!cameraId) return unauthorized(reply);
    householdEvents.publish(identity!.householdId, {
      cameraId: identity!.publicCameraId,
      type: 'camera-presence-changed',
    });
    return reply.code(204).send();
  });

  return app;
}
