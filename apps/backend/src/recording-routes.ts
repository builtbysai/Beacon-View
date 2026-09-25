import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import {
  deleteDriveRecordingFile,
  downloadDriveRecordingFile,
  GOOGLE_DRIVE_RECORDING_SCOPE,
  initiateDriveRecordingUpload,
  refreshDriveAccessToken,
  verifyDriveRecordingFile,
} from './google-drive-client.js';
import type { RecordingRecord } from './recording-types.js';
import { RecordingKeyCipher } from './recording-crypto.js';
import type { RateLimiter } from './rate-limit.js';
import { hashSecret } from './security.js';
import { unauthorized, type SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const createSchema = z.object({ cameraId: z.string().uuid() }).strict();
const parametersSchema = z.object({ recordingId: z.string().uuid() });
const base64urlBytes = (length: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/u)
    .refine((value) => Buffer.from(value, 'base64url').length === length);

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
    encryption: z
      .object({
        dataKey: base64urlBytes(32),
        iv: base64urlBytes(12),
        version: z.literal(1),
      })
      .strict(),
  })
  .strict();
const completeSchema = z
  .object({ providerFileId: z.string().trim().min(1).max(512) })
  .strict();
const failureSchema = z
  .object({
    reason: z.enum([
      'capture_failed',
      'encryption_failed',
      'upload_failed',
      'completion_failed',
      'abandoned',
    ]),
  })
  .strict();

export function registerRecordingRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: SessionAuth;
    config: AppConfig;
    limiter: RateLimiter;
    signaling: SignalingHub;
    store: MilestoneStore;
  },
): void {
  const { auth, config, limiter, signaling, store } = dependencies;
  const recordingKeyCipher = config.RECORDING_ENCRYPTION_KEY
    ? new RecordingKeyCipher(config.RECORDING_ENCRYPTION_KEY)
    : null;
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

  app.get('/api/recordings/:recordingId/playback', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    if (session.role !== 'owner')
      return reply.code(403).send({ error: 'Household owner access required' });
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Recording unavailable' });
    const claim = await store.getRecordingPlaybackClaim(
      session.householdId,
      session.userId,
      parameters.data.recordingId,
    );
    if (!claim) return reply.code(404).send({ error: 'Recording unavailable' });
    if (!recordingKeyCipher)
      return reply
        .code(503)
        .send({ error: 'Encrypted recording storage is unavailable' });
    if (!limiter.take(`recording-playback:${session.userId}`, 30, 60 * 60_000))
      return reply.code(429).send({ error: 'Too many playback requests' });
    try {
      const dataKey = recordingKeyCipher.unwrap({
        ciphertext: claim.encryptionDataKeyCiphertext,
        iv: claim.encryptionDataKeyIv,
      });
      if (
        claim.encryptionIv.length !== 12 ||
        claim.byteSize > 250 * 1024 * 1024
      )
        throw new Error('Invalid recording envelope');
      const accessToken = await recordingAccessToken(claim.userId);
      await verifyDriveRecordingFile({
        accessToken,
        byteSize: claim.byteSize,
        mimeType: 'application/octet-stream',
        providerFileId: claim.providerFileId,
        recordingId: parameters.data.recordingId,
      });
      const provider = await downloadDriveRecordingFile(
        accessToken,
        claim.providerFileId,
      );
      reply.headers({
        'Cache-Control': 'no-store, private',
        'Content-Type': 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'X-Beacon-Recording-Bytes': String(claim.byteSize),
        'X-Beacon-Recording-Checksum': claim.checksumSha256,
        'X-Beacon-Recording-Key': dataKey.toString('base64url'),
        'X-Beacon-Recording-IV': claim.encryptionIv.toString('base64url'),
        'X-Beacon-Recording-Mime': claim.mimeType,
      });
      return reply.send(
        Readable.from(boundedCiphertext(provider.body!, claim.byteSize)),
      );
    } catch (error) {
      app.log.warn(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          recordingId: parameters.data.recordingId,
        },
        'recording playback failed',
      );
      return reply
        .code(503)
        .send({ error: 'Recording playback is temporarily unavailable' });
    }
  });

  app.post('/api/recordings', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (session.role !== 'owner')
      return reply.code(403).send({ error: 'Household owner access required' });
    if (!recordingKeyCipher)
      return reply
        .code(503)
        .send({ error: 'Encrypted recording storage is unavailable' });
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
      cameraId: camera.deviceId,
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
      if (!recordingKeyCipher)
        return reply
          .code(503)
          .send({ error: 'Encrypted recording storage is unavailable' });
      const wrappedDataKey = recordingKeyCipher.wrap(
        Buffer.from(body.data.encryption.dataKey, 'base64url'),
      );
      const claim = await store.beginOwnerRecordingUpload({
        byteSize: body.data.byteSize,
        checksumSha256: body.data.checksumSha256,
        durationMs: body.data.durationMs,
        mimeType: body.data.mimeType,
        encryptionDataKeyCiphertext: wrappedDataKey.ciphertext,
        encryptionDataKeyIv: wrappedDataKey.iv,
        encryptionIv: Buffer.from(body.data.encryption.iv, 'base64url'),
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
          mimeType: 'application/octet-stream',
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

  // Shared by both the owner (session-authenticated) and device
  // (credential-authenticated) completion routes below: verify the
  // uploaded Drive file actually matches this claim before ever trusting
  // the caller's say-so that the upload succeeded.
  const finalizeRecordingUpload = async (
    request: FastifyRequest,
    reply: FastifyReply,
    claim: {
      byteSize: number;
      mimeType: 'video/mp4' | 'video/webm';
      recordingId: string;
      userId: string;
    },
    providerFileId: string,
    householdId?: string,
  ) => {
    try {
      const accessToken = await recordingAccessToken(claim.userId);
      await verifyDriveRecordingFile({
        accessToken,
        byteSize: claim.byteSize,
        mimeType: 'application/octet-stream',
        providerFileId,
        recordingId: claim.recordingId,
      });
      const completed = await store.completeRecordingUpload({
        providerFileId,
        recordingId: claim.recordingId,
        userId: claim.userId,
      });
      if (!completed)
        return reply.code(409).send({ error: 'Recording state changed' });
      await store.audit({
        eventType: 'recording_available',
        ipAddress: request.ip,
        metadata: { recordingId: claim.recordingId },
        success: true,
        userId: claim.userId,
        ...(householdId ? { householdId } : {}),
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
  };

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
    return finalizeRecordingUpload(
      request,
      reply,
      claim,
      body.data.providerFileId,
      session.householdId,
    );
  });

  app.post('/api/recordings/:recordingId/fail', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (session.role !== 'owner')
      return reply.code(403).send({ error: 'Household owner access required' });
    const parameters = parametersSchema.safeParse(request.params);
    const body = failureSchema.safeParse(request.body);
    if (!parameters.success || !body.success)
      return reply.code(400).send({ error: 'Invalid recording failure' });
    const failed = await store.markOwnerRecordingFailed(
      session.householdId,
      session.userId,
      parameters.data.recordingId,
    );
    if (!failed)
      return reply.code(404).send({ error: 'Recording request unavailable' });
    await store.audit({
      eventType: 'recording_failed',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: {
        reason: body.data.reason,
        recordingId: parameters.data.recordingId,
      },
      success: true,
      userId: session.userId,
    });
    return reply.code(204).send();
  });

  app.post(
    '/api/device/recordings/:recordingId/complete',
    async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      if (!token) return unauthorized(reply);
      const parameters = parametersSchema.safeParse(request.params);
      const body = completeSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid recording result' });
      const claim = await store.getRecordingUploadClaimByCredential(
        hashSecret(token),
        parameters.data.recordingId,
      );
      if (!claim)
        return reply.code(404).send({ error: 'Recording upload unavailable' });
      return finalizeRecordingUpload(
        request,
        reply,
        claim,
        body.data.providerFileId,
      );
    },
  );

  app.post(
    '/api/device/recordings/:recordingId/fail',
    async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      if (!token) return unauthorized(reply);
      const parameters = parametersSchema.safeParse(request.params);
      const body = failureSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid recording failure' });
      const failed = await store.markDeviceRecordingFailed(
        hashSecret(token),
        parameters.data.recordingId,
      );
      if (!failed)
        return reply.code(404).send({ error: 'Recording request unavailable' });
      app.log.info(
        { reason: body.data.reason, recordingId: parameters.data.recordingId },
        'device recording failed',
      );
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/device/recordings/:recordingId/upload-session',
    async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      if (!token) return unauthorized(reply);
      const parameters = parametersSchema.safeParse(request.params);
      const body = uploadSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid recording upload' });
      if (!recordingKeyCipher)
        return reply
          .code(503)
          .send({ error: 'Encrypted recording storage is unavailable' });
      const wrappedDataKey = recordingKeyCipher.wrap(
        Buffer.from(body.data.encryption.dataKey, 'base64url'),
      );
      const claim = await store.beginRecordingUpload({
        byteSize: body.data.byteSize,
        checksumSha256: body.data.checksumSha256,
        credentialHash: hashSecret(token),
        durationMs: body.data.durationMs,
        encryptionDataKeyCiphertext: wrappedDataKey.ciphertext,
        encryptionDataKeyIv: wrappedDataKey.iv,
        encryptionIv: Buffer.from(body.data.encryption.iv, 'base64url'),
        mimeType: body.data.mimeType,
        recordingId: parameters.data.recordingId,
      });
      if (!claim)
        return reply.code(404).send({ error: 'Recording upload unavailable' });
      try {
        const accessToken = await recordingAccessToken(claim.userId);
        const uploadUrl = await initiateDriveRecordingUpload({
          accessToken,
          byteSize: claim.byteSize,
          mimeType: 'application/octet-stream',
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
          'device recording upload session failed',
        );
        return reply
          .code(503)
          .send({ error: 'Recording upload is temporarily unavailable' });
      }
    },
  );
}

async function* boundedCiphertext(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > expectedBytes)
        throw new Error('Recording exceeded expected size');
      yield value;
    }
    if (bytes !== expectedBytes)
      throw new Error('Recording did not match expected size');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
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
