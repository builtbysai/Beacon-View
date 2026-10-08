import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { HouseholdEventHub } from './household-events.js';
import type { AppConfig } from './config.js';
import {
  browserDeviceSchema,
  deviceParameterSchema,
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
import type { SessionRecord } from './store-contract.js';

const HOUR = 60 * 60 * 1_000;
const FIFTEEN_MINUTES = 15 * 60 * 1_000;
const TEN_MINUTES = 10 * 60 * 1_000;
export const BROWSER_CAMERA_COOKIE = 'beacon_browser_camera';

interface EnrollmentRouteDependencies {
  auth: SessionAuth;
  config: AppConfig;
  householdEvents: HouseholdEventHub;
  limiter: RateLimiter;
  signaling: SignalingHub;
  store: MilestoneStore;
}

export function registerEnrollmentRoutes(
  app: FastifyInstance,
  dependencies: EnrollmentRouteDependencies,
): void {
  const { auth, config, householdEvents, limiter, signaling, store } =
    dependencies;
  const { authenticateHouseholdAdminStateChange, authenticateStateChange } =
    auth;

  // Pairing a camera is open to any active household member, not just an
  // admin -- a viewer who adds their own device should not need to ask an
  // admin to do it for them. A guest's access is meant to stay narrow and
  // temporary, so guests are the one role still excluded here.
  async function authenticateHouseholdMemberStateChange(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionRecord | null> {
    const session = await authenticateStateChange(request, reply);
    if (!session) return null;
    if (session.role === 'guest') {
      reply.code(403).send({ error: 'Household member access required' });
      return null;
    }
    return session;
  }

  app.post('/api/pairing-codes', async (request, reply) => {
    const session = await authenticateHouseholdMemberStateChange(
      request,
      reply,
    );
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
      undefined,
      session.userId,
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
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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

  app.post('/api/devices/:deviceId/pairing-code', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    const device = (await store.listDevices(session.householdId)).find(
      (candidate) =>
        candidate.publicDeviceId === parameters.data.deviceId &&
        candidate.platform === 'android',
    );
    if (!device) return reply.code(404).send({ error: 'Camera not found' });
    const canReconnect =
      session.role === 'owner' ||
      session.role === 'admin' ||
      device.pairedByUserId === session.userId;
    if (!canReconnect)
      return reply
        .code(403)
        .send({ error: 'Household administrator access required' });
    if (!limiter.take(`pairing-reconnect:${session.userId}`, 10, HOUR)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + TEN_MINUTES);
    const id = await store.createPairingCode(
      session.householdId,
      hashSecret(code),
      expiresAt,
      device.id,
    );
    await store.audit({
      eventType: 'device_reconnect_code_created',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { deviceName: device.name },
      success: true,
      userId: session.userId,
    });
    return reply
      .code(201)
      .send({ code, expiresAt: expiresAt.toISOString(), id });
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
    const session = await authenticateHouseholdMemberStateChange(
      request,
      reply,
    );
    if (!session) return;
    const parsed = browserDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid browser camera details' });
    }
    const result = await store.registerBrowserDevice({
      createdByUserId: session.userId,
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

  // A browser camera is paired by a signed-in household member on another
  // device. The short-lived code is consumed atomically with credential
  // creation; the producer credential never enters JavaScript or a URL.
  app.post('/api/browser-devices/pair', async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: 'Request origin required' });
    const parsed = browserDeviceSchema
      .extend({
        pairingCode: registerDeviceSchema.shape.pairingCode,
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid browser camera details' });
    const key = `${request.ip}:${parsed.data.installationId}`;
    if (!limiter.take(`pairing-redeem:${key}`, 10, FIFTEEN_MINUTES))
      return reply.code(429).send({ error: 'Too many requests' });
    const credential = generateToken();
    const result = await store.redeemPairingCode({
      codeHash: hashSecret(parsed.data.pairingCode.toUpperCase()),
      credentialHash: hashSecret(credential),
      installationId: parsed.data.installationId,
      name: parsed.data.name,
      ipAddress: request.ip,
      now: new Date(),
      browserSources: parsed.data.sources,
    });
    if (result === DEVICE_REGISTRATION_RATE_LIMITED)
      return reply.code(429).send({ error: 'Too many requests' });
    if (!result)
      return reply.code(400).send({ error: 'Pairing code expired or invalid' });
    const identity = await store.findDeviceByCredential(hashSecret(credential));
    if (identity) {
      householdEvents.publish(identity.householdId, {
        cameraId: result.publicCameraId,
        pairingState: 'completed',
        type: 'camera-paired',
      });
    }
    reply.setCookie(BROWSER_CAMERA_COOKIE, credential, {
      httpOnly: true,
      path: '/api',
      sameSite: 'strict',
      secure: config.NODE_ENV === 'production',
    });
    const cameras = identity
      ? (await store.listCameras(identity.householdId)).filter(
          (camera) => camera.publicDeviceId === result.publicDeviceId,
        )
      : [];
    return reply.code(201).send({
      cameras: cameras.map((camera) => ({
        id: camera.publicCameraId,
        name: camera.name,
        sourceKey: camera.sourceKey,
      })),
      device: { id: result.publicDeviceId, name: result.name },
    });
  });

  app.post('/api/browser-devices/restore', async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: 'Request origin required' });
    const credential = request.cookies[BROWSER_CAMERA_COOKIE];
    if (!credential) return unauthorized(reply);
    const parsed = browserDeviceSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid browser camera details' });
    const identity = await store.findDeviceByCredential(hashSecret(credential));
    if (
      !identity ||
      identity.platform !== 'browser' ||
      identity.installationId !== parsed.data.installationId
    )
      return unauthorized(reply);
    const cameras = await store.syncDeviceCameras(
      hashSecret(credential),
      parsed.data.sources,
      new Date(),
    );
    if (!cameras) return unauthorized(reply);
    return {
      cameras: cameras.map((camera) => ({
        id: camera.publicCameraId,
        name: camera.name,
        sourceKey: camera.sourceKey,
      })),
      device: { id: identity.publicDeviceId, name: identity.name },
    };
  });
}
