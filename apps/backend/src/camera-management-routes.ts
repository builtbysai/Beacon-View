import type { FastifyInstance } from 'fastify';

import { canRemoveCamera, presentCamera } from './camera-presentation.js';
import type { HouseholdEventHub } from './household-events.js';
import {
  cameraParameterSchema,
  deviceParameterSchema,
  privacyModeSchema,
  updateCameraSchema,
  updateDeviceSchema,
} from './http-schemas.js';
import type { SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

interface CameraManagementRouteDependencies {
  auth: SessionAuth;
  householdEvents: HouseholdEventHub;
  signaling: SignalingHub;
  store: MilestoneStore;
}

export function registerCameraManagementRoutes(
  app: FastifyInstance,
  dependencies: CameraManagementRouteDependencies,
): void {
  const { auth, householdEvents, signaling, store } = dependencies;
  const {
    authenticate,
    authenticateHouseholdAdminStateChange,
    authenticateStateChange,
  } = auth;

  app.get('/api/cameras', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const cameras = await store.listAccessibleCameras(
      session.householdId,
      session.userId,
      session.role,
    );
    return {
      cameras: cameras.map((camera) =>
        presentCamera(camera, signaling.cameraStatus(camera.publicCameraId), {
          role: session.role,
          userId: session.userId,
        }),
      ),
    };
  });

  app.get('/api/devices', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const [devices, cameras] = await Promise.all([
      store.listAccessibleDevices(
        session.householdId,
        session.userId,
        session.role,
      ),
      store.listAccessibleCameras(
        session.householdId,
        session.userId,
        session.role,
      ),
    ]);
    return {
      devices: devices.map((device) => {
        const producerConnected = cameras
          .filter((camera) => camera.publicDeviceId === device.publicDeviceId)
          .some(
            (camera) =>
              signaling.cameraStatus(camera.publicCameraId).producerConnected,
          );
        const revoked = device.revokedAt !== null;
        return {
          deviceType: device.deviceType,
          canRemove:
            session.role === 'owner' ||
            session.role === 'admin' ||
            device.pairedByUserId === session.userId,
          capabilities: device.capabilities,
          batteryPercent: device.batteryPercent,
          batteryCharging: device.batteryCharging,
          connectionState: revoked
            ? 'needs_pairing'
            : !device.enabled
              ? 'disabled'
              : device.privacyMode
                ? 'privacy'
                : producerConnected
                  ? 'connected'
                  : 'offline',
          healthReportedAt: device.healthReportedAt?.toISOString() ?? null,
          enabled: device.enabled,
          privacyMode: device.privacyMode,
          id: device.publicDeviceId,
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          name: device.name,
          online: device.enabled && !revoked && producerConnected,
          platform: device.platform,
          revoked,
          softwareVersion: device.softwareVersion,
        };
      }),
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
      store.listAccessibleDevices(
        session.householdId,
        session.userId,
        session.role,
      ),
      store.listAccessibleCameras(
        session.householdId,
        session.userId,
        session.role,
      ),
    ]);
    const device = devices.find(
      (candidate) => candidate.publicDeviceId === parameters.data.deviceId,
    );
    if (!device) return reply.code(404).send({ error: 'Device not found' });
    const childCameras = cameras
      .filter((camera) => camera.publicDeviceId === device.publicDeviceId)
      .map((camera) =>
        presentCamera(camera, signaling.cameraStatus(camera.publicCameraId), {
          role: session.role,
          userId: session.userId,
        }),
      );
    return {
      cameras: childCameras,
      device: {
        aggregateViewerCount: childCameras.reduce(
          (total, camera) => total + camera.viewerCount,
          0,
        ),
        canRemove:
          session.role === 'owner' ||
          session.role === 'admin' ||
          device.pairedByUserId === session.userId,
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
        connectionState:
          device.revokedAt !== null
            ? 'needs_pairing'
            : !device.enabled
              ? 'disabled'
              : device.privacyMode
                ? 'privacy'
                : childCameras.some(
                      (camera) => camera.availability === 'available',
                    )
                  ? 'connected'
                  : 'offline',
        online:
          device.enabled &&
          device.revokedAt === null &&
          childCameras.some((camera) => camera.availability === 'available'),
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
    const cameras = await store.listAccessibleCameras(
      session.householdId,
      session.userId,
      session.role,
    );
    const camera = cameras.find(
      (candidate) => candidate.publicCameraId === parameters.data.cameraId,
    );
    if (!camera) return reply.code(404).send({ error: 'Camera not found' });
    return {
      camera: presentCamera(
        camera,
        signaling.cameraStatus(camera.publicCameraId),
        { role: session.role, userId: session.userId },
      ),
    };
  });

  app.patch('/api/devices/:deviceId', async (request, reply) => {
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
    await store
      .recordSecurityEvent({
        now: new Date(),
        securityEventType: 'device_revoked',
        userId: session.userId,
      })
      .catch((error: unknown) =>
        app.log.warn({ err: error }, 'failed to record security event'),
      );
    return reply.code(204).send();
  });

  app.delete('/api/devices/:deviceId', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = deviceParameterSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.code(404).send({ error: 'Device not found' });
    }
    const device = (await store.listDevices(session.householdId)).find(
      (candidate) => candidate.publicDeviceId === parameters.data.deviceId,
    );
    if (!device) return reply.code(404).send({ error: 'Device not found' });
    if (!canRemoveCamera(device, session))
      return reply
        .code(403)
        .send({ error: 'You can only remove a camera you paired' });
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
      metadata: { deviceName: device.name },
    });
    householdEvents.publish(session.householdId, {
      type: 'device-management-changed',
    });
    await store
      .recordSecurityEvent({
        now: new Date(),
        securityEventType: 'device_revoked',
        userId: session.userId,
      })
      .catch((error: unknown) =>
        app.log.warn({ err: error }, 'failed to record security event'),
      );
    return reply.code(204).send();
  });

  app.delete('/api/cameras/:cameraId', async (request, reply) => {
    const session = await authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    const camera = parameters.success
      ? (await store.listCameras(session.householdId)).find(
          (candidate) => candidate.publicCameraId === parameters.data.cameraId,
        )
      : undefined;
    if (!parameters.success || !camera) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    if (!canRemoveCamera(camera, session))
      return reply
        .code(403)
        .send({ error: 'You can only remove a camera you paired' });
    if (
      !(await store.deleteCamera(session.householdId, parameters.data.cameraId))
    ) {
      return reply.code(404).send({ error: 'Camera not found' });
    }
    signaling.notifySourcesChanged([
      parameters.data.cameraId,
      ...(await store.listCameras(session.householdId))
        .filter(
          (candidate) => candidate.publicDeviceId === camera.publicDeviceId,
        )
        .map((candidate) => candidate.publicCameraId),
    ]);
    signaling.disconnectCamera(parameters.data.cameraId, 'camera_removed');
    await store.audit({
      cameraId: camera.deviceId,
      eventType: 'camera_source_deleted',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { cameraName: camera.name, deviceName: camera.deviceName },
      success: true,
      userId: session.userId,
    });
    householdEvents.publish(session.householdId, {
      cameraId: parameters.data.cameraId,
      type: 'camera-presence-changed',
    });
    return reply.code(204).send();
  });

  app.post('/api/devices/:deviceId/restart', async (request, reply) => {
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
}
