import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import {
  deleteDriveRecordingFile,
  GOOGLE_DRIVE_RECORDING_SCOPE,
  initiateDriveRecordingUpload,
  refreshDriveAccessToken,
  verifyDriveRecordingFile,
} from './google-drive-client.js';
import type { RecordingRecord } from './recording-types.js';
import { hashSecret } from './security.js';
import { unauthorized, type SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const createSchema = z.object({ cameraId: z.string().uuid() }).strict();
const parametersSchema = z.object({ recordingId: z.string().uuid() });
const uploadSchema = z
  .object({
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(250 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    durationMs: z
      .number()
      .int()
      .min(1_000)
      .max(10 * 60 * 1_000),
    mimeType: z.enum(['video/mp4', 'video/webm']),
  })
  .strict();
const completeSchema = z
  .object({ providerFileId: z.string().trim().min(1).max(512) })
  .strict();

export function registerRecordingRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: SessionAuth;
    config: AppConfig;
    signaling: SignalingHub;
    store: MilestoneStore;
  },
): void {
  const { auth, config, signaling, store } = dependencies;
  const recordingAccessToken = async (userId: string): Promise<string> => {
    if (!config.GOOGLE_OAUTH_CLIENT_ID)
      throw new Error('Google Drive is unavailable');
    const [refreshToken, drive] = await Promise.all([
      store.getGoogleDriveRefreshToken(userId),
      store.getGoogleDriveConnection(userId),
    ]);
    if (
      !refreshToken ||
      !drive ||
      !drive.scopes.split(/\s+/u).includes(GOOGLE_DRIVE_RECORDING_SCOPE)
    )
      throw new Error('Recording storage is unavailable');
    const client = new OAuth2Client(
      config.GOOGLE_OAUTH_CLIENT_ID,
      config.GOOGLE_OAUTH_CLIENT_SECRET,
      config.GOOGLE_OAUTH_REDIRECT_URI,
    );
    return refreshDriveAccessToken(client, refreshToken);
  };

  app.get('/api/recordings', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const cameras = await store.listAccessibleCameras(
      session.householdId,
      session.userId,
      session.role,
    );
    const recordings = await store.listRecordings(
      session.householdId,
      cameras.map((camera) => camera.id),
    );
    return { recordings: recordings.map(presentRecording) };
  });

  app.post('/api/recordings', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (session.role !== 'owner')
      return reply.code(403).send({ error: 'Household owner access required' });
    const body = createSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Invalid recording request' });
    const drive = await store.getGoogleDriveConnection(session.userId);
    if (
      !drive ||
      !drive.scopes.split(/\s+/u).includes(GOOGLE_DRIVE_RECORDING_SCOPE)
    )
      return reply
        .code(409)
        .send({ error: 'Connect Google Drive for recordings first' });
    const camera = await store.findAccessibleCamera(
      session.householdId,
      session.userId,
      session.role,
      body.data.cameraId,
    );
    if (!camera) return reply.code(404).send({ error: 'Camera unavailable' });
    if (!signaling.cameraStatus(camera.publicCameraId).producerConnected)
      return reply.code(409).send({ error: 'Camera is offline' });
    const recording = await store.createRecordingRequest({
      cameraSourceId: camera.cameraId,
      householdId: session.householdId,
      userId: session.userId,
    });
    if (!recording)
      return reply.code(409).send({ error: 'Camera is unavailable' });
    await store.audit({
      eventType: 'recording_requested',
      householdId: session.householdId,
      cameraId: camera.cameraId,
      ipAddress: request.ip,
      metadata: { recordingId: recording.id },
      success: true,
      userId: session.userId,
    });
    return reply.code(202).send({ recording: presentRecording(recording) });
  });

  app.delete('/api/recordings/:recordingId', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (session.role !== 'owner')
      return reply.code(403).send({ error: 'Household owner access required' });
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Recording unavailable' });
    let deleted = await store.deleteRecording(
      session.householdId,
      parameters.data.recordingId,
    );
    if (!deleted) {
      const claim = await store.beginAvailableRecordingDeletion(
        session.householdId,
        parameters.data.recordingId,
      );
      if (!claim)
        return reply.code(409).send({
          error: 'Recording cannot be deleted while an upload is active',
        });
      try {
        const accessToken = await recordingAccessToken(claim.userId);
        await deleteDriveRecordingFile(accessToken, claim.providerFileId);
        deleted = await store.finishRecordingDeletion(
          session.householdId,
          claim.recordingId,
        );
      } catch (error) {
        await store.cancelRecordingDeletion(claim.recordingId);
        app.log.warn(
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
            recordingId: claim.recordingId,
          },
          'recording deletion failed',
        );
        return reply
          .code(503)
          .send({ error: 'Recording could not be deleted from Google Drive' });
      }
    }
    if (!deleted)
      return reply.code(409).send({ error: 'Recording state changed' });
    await store.audit({
      eventType: 'recording_deleted',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { recordingId: parameters.data.recordingId },
      success: true,
      userId: session.userId,
    });
    return reply.code(204).send();
  });

  app.post(
    '/api/recordings/:recordingId/upload-session',
    async (request, reply) => {
      const session = await auth.authenticateStateChange(request, reply);
      if (!session) return;
      if (session.role !== 'owner')
        return reply
          .code(403)
          .send({ error: 'Household owner access required' });
      const parameters = parametersSchema.safeParse(request.params);
      const body = uploadSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid recording upload' });
      const claim = await store.beginOwnerRecordingUpload({
        ...body.data,
        householdId: session.householdId,
        recordingId: parameters.data.recordingId,
        userId: session.userId,
      });
      if (!claim)
        return reply.code(404).send({ error: 'Recording request unavailable' });
      try {
        const accessToken = await recordingAccessToken(claim.userId);
        const uploadUrl = await initiateDriveRecordingUpload({
          accessToken,
          byteSize: claim.byteSize,
          mimeType: claim.mimeType,
          recordingId: claim.recordingId,
        });
        reply.header('Cache-Control', 'no-store');
        return reply.code(201).send({
          expiresInSeconds: 6 * 24 * 60 * 60,
          recordingId: claim.recordingId,
          uploadUrl,
        });
      } catch (error) {
        await store.markRecordingUploadFailed(claim.recordingId);
        app.log.warn(
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
            recordingId: claim.recordingId,
          },
          'recording upload session failed',
        );
        return reply
          .code(503)
          .send({ error: 'Recording upload is temporarily unavailable' });
      }
    },
  );

  app.post('/api/recordings/:recordingId/complete', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (session.role !== 'owner')
      return reply.code(403).send({ error: 'Household owner access required' });
    const parameters = parametersSchema.safeParse(request.params);
    const body = completeSchema.safeParse(request.body);
    if (!parameters.success || !body.success)
      return reply.code(400).send({ error: 'Invalid recording result' });
    const claim = await store.getRecordingUploadClaim(
      session.userId,
      parameters.data.recordingId,
    );
    if (!claim)
      return reply.code(404).send({ error: 'Recording upload unavailable' });
    try {
      const accessToken = await recordingAccessToken(session.userId);
      await verifyDriveRecordingFile({
        accessToken,
        byteSize: claim.byteSize,
        mimeType: claim.mimeType,
        providerFileId: body.data.providerFileId,
        recordingId: claim.recordingId,
      });
      const completed = await store.completeRecordingUpload({
        providerFileId: body.data.providerFileId,
        recordingId: claim.recordingId,
        userId: session.userId,
      });
      if (!completed)
        return reply.code(409).send({ error: 'Recording state changed' });
      await store.audit({
        eventType: 'recording_available',
        householdId: session.householdId,
        ipAddress: request.ip,
        metadata: { recordingId: claim.recordingId },
        success: true,
        userId: session.userId,
      });
      return reply.code(204).send();
    } catch (error) {
      app.log.warn(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          recordingId: claim.recordingId,
        },
        'recording completion verification failed',
      );
      return reply
        .code(409)
        .send({ error: 'Uploaded recording could not be verified' });
    }
  });

  app.post(
    '/api/device/recordings/:recordingId/upload-session',
    async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      const parameters = parametersSchema.safeParse(request.params);
      const body = uploadSchema.safeParse(request.body);
      if (!token) return unauthorized(reply);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid recording upload' });
      if (!config.GOOGLE_OAUTH_CLIENT_ID)
        return reply.code(503).send({ error: 'Google Drive is unavailable' });
      const claim = await store.beginRecordingUpload({
        byteSize: body.data.byteSize,
        checksumSha256: body.data.checksumSha256,
        credentialHash: hashSecret(token),
        durationMs: body.data.durationMs,
        mimeType: body.data.mimeType,
        recordingId: parameters.data.recordingId,
      });
      if (!claim)
        return reply.code(404).send({ error: 'Recording request unavailable' });
      try {
        const accessToken = await recordingAccessToken(claim.userId);
        const uploadUrl = await initiateDriveRecordingUpload({
          accessToken,
          byteSize: claim.byteSize,
          mimeType: claim.mimeType,
          recordingId: claim.recordingId,
        });
        reply.header('Cache-Control', 'no-store');
        return reply.code(201).send({
          expiresInSeconds: 6 * 24 * 60 * 60,
          recordingId: claim.recordingId,
          uploadUrl,
        });
      } catch (error) {
        await store.markRecordingUploadFailed(claim.recordingId);
        app.log.warn(
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
            recordingId: claim.recordingId,
          },
          'recording upload session failed',
        );
        return reply
          .code(503)
          .send({ error: 'Recording upload is temporarily unavailable' });
      }
    },
  );
}

function presentRecording(recording: RecordingRecord) {
  return {
    id: recording.id,
    cameraId: recording.cameraId,
    cameraName: recording.cameraName,
    deviceName: recording.deviceName,
    status: recording.status,
    durationMs: recording.durationMs,
    byteSize: recording.byteSize,
    expiresAt: recording.expiresAt?.toISOString() ?? null,
    createdAt: recording.createdAt.toISOString(),
    updatedAt: recording.updatedAt.toISOString(),
  };
}
