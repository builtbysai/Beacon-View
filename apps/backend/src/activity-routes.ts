import type { FastifyInstance } from 'fastify';

import { z } from 'zod';

import { cameraUseCaseSchema, motionPresetFor } from './camera-use-case.js';
import { isCameraOnline } from './camera-presentation.js';
import type { HouseholdEventHub } from './household-events.js';
import {
  cameraParameterSchema,
  deviceParameterSchema,
  motionEventParameterSchema,
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
import {
  DEFAULT_TIMELINE_EVENT_TYPES,
  HOUSEHOLD_ACTIVITY_EVENT_TYPES,
  type HouseholdActivityEventType,
} from './store-contract.js';

interface ActivityRouteDependencies {
  auth: SessionAuth;
  householdEvents: HouseholdEventHub;
  signaling: SignalingHub;
  store: MilestoneStore;
}

const cameraUseCaseBodySchema = z
  .object({ useCase: cameraUseCaseSchema })
  .strict();

export function registerActivityRoutes(
  app: FastifyInstance,
  dependencies: ActivityRouteDependencies,
): void {
  const { auth, householdEvents, signaling, store } = dependencies;
  const {
    authenticate,
    authenticateHouseholdAdmin,
    authenticateHouseholdAdminStateChange,
  } = auth;

  app.get('/api/diagnostics', async (request, reply) => {
    const session = await authenticateHouseholdAdmin(request, reply);
    if (!session) return;
    const [cameraResult, deviceResult] = await Promise.allSettled([
      store.listAccessibleCameras(
        session.householdId,
        session.userId,
        session.role,
      ),
      store.listAccessibleDevices(
        session.householdId,
        session.userId,
        session.role,
      ),
    ]);
    if (
      cameraResult.status === 'rejected' &&
      deviceResult.status === 'rejected'
    ) {
      return reply.code(503).send({ error: 'Diagnostics unavailable' });
    }
    const unavailable = [
      ...(cameraResult.status === 'rejected' ? ['cameras'] : []),
      ...(deviceResult.status === 'rejected' ? ['devices'] : []),
    ];
    return {
      unavailable,
      cameras: (cameraResult.status === 'fulfilled'
        ? cameraResult.value
        : []
      ).map((camera) => {
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
      devices: (deviceResult.status === 'fulfilled'
        ? deviceResult.value
        : []
      ).map((device) => ({
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

  app.get('/api/activity', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const query = request.query as {
      limit?: string;
      offset?: string;
      eventType?: string | string[];
      cameraId?: string;
      since?: string;
    };
    const limit = query.limit ? Number(query.limit) : undefined;
    const offset = query.offset ? Number(query.offset) : undefined;
    if (
      (limit !== undefined &&
        (!Number.isInteger(limit) || limit < 1 || limit > 50)) ||
      (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
    ) {
      return reply.code(400).send({ error: 'Invalid pagination parameters' });
    }

    const requestedTypes =
      query.eventType === undefined
        ? undefined
        : Array.isArray(query.eventType)
          ? query.eventType
          : [query.eventType];
    const allowedTypes = new Set<string>(HOUSEHOLD_ACTIVITY_EVENT_TYPES);
    if (requestedTypes?.some((eventType) => !allowedTypes.has(eventType))) {
      return reply.code(400).send({ error: 'Invalid activity event type' });
    }
    const camera = query.cameraId
      ? cameraParameterSchema.safeParse({ cameraId: query.cameraId })
      : null;
    const since = query.since ? new Date(query.since) : null;
    if (
      (camera && !camera.success) ||
      (since && Number.isNaN(since.getTime()))
    ) {
      return reply.code(400).send({ error: 'Invalid activity filter' });
    }

    // Activity contains household-wide security and membership metadata.
    // Keep the unfiltered feed aligned with /api/events and /api/access-history
    // until viewer/guest activity can be filtered by camera grants.
    if (session.role !== 'owner' && session.role !== 'admin') {
      return reply
        .code(403)
        .send({ error: 'Household administrator access required' });
    }

    const page = await store.listHouseholdActivity(session.householdId, {
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
      // An explicit ?eventType= is honored as-is (including a recording
      // lifecycle type, if ever requested deliberately). With no filter, the
      // timeline defaults to excluding recording lifecycle noise -- a clip
      // shows up attached to the event that caused it, not as its own row.
      eventTypes: (requestedTypes ??
        DEFAULT_TIMELINE_EVENT_TYPES) as HouseholdActivityEventType[],
      ...(camera?.success ? { cameraSourceId: camera.data.cameraId } : {}),
      ...(since ? { since } : {}),
    });
    return {
      events: page.events.map((event) => ({
        id: event.id,
        actorEmail: event.actorEmail,
        householdId: event.householdId,
        publicDeviceId: event.publicDeviceId,
        cameraSourceId: event.cameraSourceId,
        deviceName: event.deviceName,
        sourceName: event.sourceName,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        success: event.success,
        metadata: event.metadata,
      })),
      total: page.total,
    };
  });

  app.get('/api/access-history', async (request, reply) => {
    const session = await authenticateHouseholdAdmin(request, reply);
    if (!session) return;
    const query = request.query as { limit?: string; offset?: string };
    const limit = query.limit ? Number(query.limit) : undefined;
    const offset = query.offset ? Number(query.offset) : undefined;
    if (
      (limit !== undefined &&
        (!Number.isInteger(limit) || limit < 1 || limit > 100)) ||
      (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
    ) {
      return reply.code(400).send({ error: 'Invalid pagination parameters' });
    }
    const page = await store.listAccessHistory(session.householdId, {
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });
    return {
      events: page.events.map((event) => ({
        actorEmail: event.actorEmail,
        cameraName: event.metadata.cameraName ?? null,
        deviceName: event.deviceName,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        reason: event.success ? null : (event.metadata.reason ?? null),
        success: event.success,
        viewerSessionId: event.viewerSessionId,
      })),
      total: page.total,
    };
  });

  app.get('/api/devices/:deviceId/motion-settings', async (request, reply) => {
    const session = await authenticateHouseholdAdmin(request, reply);
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
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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

  app.put('/api/cameras/:cameraId/use-case', async (request, reply) => {
    const session = await authenticateHouseholdAdminStateChange(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    const body = cameraUseCaseBodySchema.safeParse(request.body);
    if (!parameters.success || !body.success)
      return reply.code(400).send({ error: 'Invalid camera use' });
    const result = await store.setCameraUseCase(
      session.householdId,
      parameters.data.cameraId,
      body.data.useCase,
      motionPresetFor(body.data.useCase),
    );
    if (!result) return reply.code(404).send({ error: 'Camera unavailable' });
    await store.audit({
      eventType: 'camera_use_case_changed',
      householdId: session.householdId,
      userId: session.userId,
      success: true,
      ipAddress: request.ip,
      metadata: { cameraId: parameters.data.cameraId, useCase: result.useCase },
    });
    return result;
  });

  app.get('/api/device/motion-settings', async (request, reply) => {
    const token = request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice('Bearer '.length)
      : '';
    const identity = token
      ? await store.findDeviceByCredential(hashSecret(token))
      : null;
    if (!identity) return unauthorized(reply);
    const body = {
      cameras: await store.listMotionSettings(
        identity.householdId,
        identity.publicDeviceId,
      ),
    };
    // The phone asks every 30 seconds and the settings rarely change, so an
    // unchanged answer is a tiny 304 (V49).
    const etag = `"${hashSecret(JSON.stringify(body)).slice(0, 32)}"`;
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'no-store');
    if (request.headers['if-none-match'] === etag)
      return reply.code(304).send();
    return body;
  });

  app.get('/api/motion-events', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const query = parseMotionHistoryQuery(request.query);
    if (!query)
      return reply.code(400).send({ error: 'Invalid motion history filters' });
    const allowedCameraIds =
      session.role === 'owner' || session.role === 'admin'
        ? undefined
        : (
            await store.listAccessibleCameras(
              session.householdId,
              session.userId,
              session.role,
            )
          ).map((camera) => camera.publicCameraId);
    const rows = await store.listMotionEvents(session.householdId, {
      ...query,
      ...(allowedCameraIds === undefined ? {} : { allowedCameraIds }),
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
        recordingId: event.recordingId,
        recordingStatus: event.recordingStatus,
      })),
    };
  });

  app.get('/api/motion-events/:motionEventId', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const parameters = motionEventParameterSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Motion event unavailable' });
    const allowedCameraIds =
      session.role === 'owner' || session.role === 'admin'
        ? undefined
        : (
            await store.listAccessibleCameras(
              session.householdId,
              session.userId,
              session.role,
            )
          ).map((camera) => camera.publicCameraId);
    const event = await store.getMotionEventById(
      session.householdId,
      parameters.data.motionEventId,
      allowedCameraIds,
    );
    if (!event)
      return reply.code(404).send({ error: 'Motion event unavailable' });
    return {
      id: event.id,
      cameraId: event.publicCameraId,
      cameraName: event.cameraName,
      deviceName: event.deviceName,
      confidence: Number(event.confidence.toFixed(4)),
      occurredAt: event.occurredAt.toISOString(),
      recordingId: event.recordingId,
      recordingStatus: event.recordingStatus,
    };
  });

  app.delete('/api/motion-events', async (request, reply) => {
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
    const session = await authenticateHouseholdAdmin(request, reply);
    if (!session) return;
    const retention = await store.getMotionRetention(session.householdId);
    if (!retention)
      return reply.code(404).send({ error: 'Household unavailable' });
    return retention;
  });

  app.put('/api/motion-retention', async (request, reply) => {
    const session = await authenticateHouseholdAdminStateChange(request, reply);
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
