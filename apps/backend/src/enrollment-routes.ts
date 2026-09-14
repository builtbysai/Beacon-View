import type { FastifyInstance } from 'fastify';

import type { HouseholdEventHub } from './household-events.js';
import {
  browserDeviceSchema,
  pairingCodeParameterSchema,
  registerDeviceSchema,
  syncCameraSourcesSchema,
} from './http-schemas.js';
import type { RateLimiter } from './rate-limit.js';
import { generatePairingCode, generateToken, hashSecret } from './security.js';
import { unauthorized, type SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import {
  DEVICE_REGISTRATION_RATE_LIMITED,
  type MilestoneStore,
} from './store.js';

const HOUR = 60 * 60 * 1_000;
const FIFTEEN_MINUTES = 15 * 60 * 1_000;
const TEN_MINUTES = 10 * 60 * 1_000;

interface EnrollmentRouteDependencies {
  auth: SessionAuth;
  householdEvents: HouseholdEventHub;
  limiter: RateLimiter;
  signaling: SignalingHub;
  store: MilestoneStore;
}

export function registerEnrollmentRoutes(
  app: FastifyInstance,
  dependencies: EnrollmentRouteDependencies,
): void {
  const { auth, householdEvents, limiter, signaling, store } = dependencies;

  app.post('/api/pairing-codes', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
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
    const session = await auth.authenticateStateChange(request, reply);
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
    const session = await auth.authenticateStateChange(request, reply);
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
}
