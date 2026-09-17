import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { HouseholdEventHub } from './household-events.js';
import {
  cameraParameterSchema,
  heartbeatSchema,
  motionEventSchema,
  privacyModeSchema,
} from './http-schemas.js';
import { hashSecret } from './security.js';
import { unauthorized, type SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

interface DeviceRuntimeRouteDependencies {
  auth: SessionAuth;
  householdEvents: HouseholdEventHub;
  signaling: SignalingHub;
  store: MilestoneStore;
}

export function registerDeviceRuntimeRoutes(
  app: FastifyInstance,
  dependencies: DeviceRuntimeRouteDependencies,
): void {
  const { auth, householdEvents, signaling, store } = dependencies;
  const { authenticateHouseholdAdminStateChange } = auth;

  app.delete('/api/cameras/:cameraId/credential', async (request, reply) => {
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
    const recovered = await store.recordDeviceRecoveredIfOffline({
      cameraId,
      householdId: identity!.householdId,
      publicDeviceId: identity!.publicDeviceId,
      now: new Date(),
    });
    householdEvents.publish(identity!.householdId, {
      cameraId: identity!.publicCameraId,
      type: 'camera-presence-changed',
    });
    if (recovered) {
      householdEvents.publish(identity!.householdId, {
        type: 'device-management-changed',
      });
    }
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
      // Best-effort: a missed auto-recording (Drive not connected, or one
      // already in flight for this camera) never fails the motion report
      // itself -- the event is already committed above either way.
      const recording = result.recordOnMotion
        ? await store.createMotionTriggeredRecording({
            cameraSourceId: result.cameraSourceId,
            householdId: result.householdId,
            ownerId: result.ownerId,
          })
        : null;
      return reply.code(201).send({
        created: true,
        ...(recording ? { recordingId: recording.recordingId } : {}),
      });
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

  const disconnectRegistration = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
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
    const device = (await store.listDevices(identity.householdId)).find(
      (candidate) => candidate.publicDeviceId === identity.publicDeviceId,
    );
    const revoked = await store.revokeDevice(
      identity.householdId,
      identity.publicDeviceId,
    );
    if (!revoked) return reply.code(404).send({ error: 'Device not found' });
    for (const camera of cameras) {
      signaling.disconnectCamera(camera.publicCameraId, 'device_revoked');
    }
    await store.audit({
      eventType: 'device_self_disconnected',
      householdId: identity.householdId,
      ipAddress: request.ip,
      ...(device ? { metadata: { deviceName: device.name } } : {}),
      success: true,
    });
    householdEvents.publish(identity.householdId, {
      type: 'device-management-changed',
    });
    return reply.code(204).send();
  };

  // POST with an explicit JSON body is the primary Android path. Keep DELETE
  // for older camera builds, but both operations now preserve the device row
  // so an owner can issue a device-bound re-pairing code.
  app.post('/api/device/disconnect', disconnectRegistration);
  app.delete('/api/device/registration', disconnectRegistration);
}
