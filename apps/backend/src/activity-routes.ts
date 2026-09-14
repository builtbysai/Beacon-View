import type { FastifyInstance } from 'fastify';

import { isCameraOnline } from './camera-presentation.js';
import type { HouseholdEventHub } from './household-events.js';
import {
  cameraParameterSchema,
  deviceParameterSchema,
  motionRetentionSchema,
} from './http-schemas.js';
import {
  motionHistoryCursor,
  parseMotionHistoryQuery,
} from './motion-history.js';
import { motionSettingsSchema } from './motion-settings.js';
import { hashSecret } from './security.js';
import { unauthorized, type SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

interface ActivityRouteDependencies {
  auth: SessionAuth;
  householdEvents: HouseholdEventHub;
  signaling: SignalingHub;
  store: MilestoneStore;
}

export function registerActivityRoutes(
  app: FastifyInstance,
  dependencies: ActivityRouteDependencies,
): void {
  const { auth, householdEvents, signaling, store } = dependencies;
  const { authenticate, authenticateStateChange } = auth;

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
        cameraName: event.metadata.cameraName ?? null,
        deviceName: event.deviceName,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        reason: event.success ? null : (event.metadata.reason ?? null),
        success: event.success,
        viewerSessionId: event.viewerSessionId,
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
}
