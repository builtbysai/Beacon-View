import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import {
  deleteDriveRecordingFile,
  DriveReconnectRequiredError,
  downloadDriveRecordingFile,
  GOOGLE_DRIVE_RECORDING_SCOPE,
  GoogleDriveRequestError,
  initiateDriveRecordingUpload,
  refreshDriveAccessToken,
  verifyDriveRecordingFile,
} from './google-drive-client.js';
import {
  DRIVE_RECONNECT_MESSAGE,
  expireDriveConnection,
} from './drive-connection-health.js';
import {
  parseRecordingHistoryQuery,
  recordingHistoryCursor,
} from './recording-history.js';
import type { RecordingRecord } from './recording-types.js';
import { RecordingKeyCipher } from './recording-crypto.js';
import type { RateLimiter } from './rate-limit.js';
import { generateToken, hashSecret } from './security.js';
import { unauthorized, type SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const createSchema = z
  .object({
    cameraId: z.string().uuid(),
    captureMode: z.enum(['viewer', 'camera']).optional(),
  })
  .strict();
const parametersSchema = z.object({ recordingId: z.string().uuid() });
const shareLinkCreateSchema = z
  .object({ expiresInHours: z.number().int().min(1).max(72) })
  .strict();
const shareLinkParametersSchema = z.object({ linkId: z.string().uuid() });
// Tokens are generateToken()'s 32-byte base64url output (43 chars, no
// padding); reject anything else before it ever reaches a hash lookup.
const shareTokenParametersSchema = z.object({
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/u)
    .max(64),
});
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
const thumbnailUploadSchema = z
  .object({
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(2 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    mimeType: z.enum(['image/jpeg', 'image/webp']),
    encryption: z
      .object({
        dataKey: base64urlBytes(32),
        iv: base64urlBytes(12),
        version: z.literal(1),
      })
      .strict(),
  })
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
    try {
      return await refreshDriveAccessToken(client, refreshToken);
    } catch (error) {
      // A dead token never recovers on its own: drop the connection so the
      // app stops offering recordings and asks the owner to reconnect.
      if (error instanceof DriveReconnectRequiredError)
        await expireDriveConnection(store, userId).catch(() => undefined);
      throw error;
    }
  };

  app.get('/api/recordings', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const query = parseRecordingHistoryQuery(request.query);
    if (!query)
      return reply
        .code(400)
        .send({ error: 'Invalid recording history filters' });
    const cameras = await store.listAccessibleCameras(
      session.householdId,
      session.userId,
      session.role,
    );
    const rows = await store.listRecordings(
      session.householdId,
      cameras.map((camera) => camera.id),
      {
        limit: query.limit + 1,
        ...(query.before ? { before: query.before } : {}),
      },
    );
    const recordings = rows.slice(0, query.limit);
    return {
      nextCursor:
        rows.length > query.limit
          ? recordingHistoryCursor(recordings[recordings.length - 1]!)
          : null,
      recordings: recordings.map(presentRecording),
    };
  });

  // Shared by the owner/household playback route and the unauthenticated
  // share-link route below: once a claim resolves (by session+ACL or by a
  // valid share token), relaying it to ciphertext is identical either way.
  // Also reused for thumbnail playback below -- a thumbnail's claim has the
  // exact same shape (a small image instead of a video), so relaying it is
  // identical work.
  const relayRecordingPlayback = async (
    request: FastifyRequest,
    reply: FastifyReply,
    claim: {
      byteSize: number;
      checksumSha256: string;
      mimeType: string;
      encryptionIv: Buffer;
      encryptionDataKeyCiphertext: Buffer;
      encryptionDataKeyIv: Buffer;
      userId: string;
      providerFileId: string;
    },
    recordingId: string,
  ) => {
    if (!recordingKeyCipher)
      return reply
        .code(503)
        .send({ error: 'Encrypted recording storage is unavailable' });
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
        recordingId,
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
          recordingId,
        },
        'recording playback failed',
      );
      return reply
        .code(503)
        .send({ error: 'Recording playback is temporarily unavailable' });
    }
  };

  app.get('/api/recordings/:recordingId/playback', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Recording unavailable' });
    // Playback follows the same per-camera access as live view and the
    // recordings list: owner/admin see everything, a viewer/guest needs a
    // grant on the specific camera that produced this clip.
    const accessibleCameras = await store.listAccessibleCameras(
      session.householdId,
      session.userId,
      session.role,
    );
    const claim = await store.getRecordingPlaybackClaim(
      session.householdId,
      parameters.data.recordingId,
      accessibleCameras.map((camera) => camera.id),
    );
    if (!claim) return reply.code(404).send({ error: 'Recording unavailable' });
    if (!limiter.take(`recording-playback:${session.userId}`, 30, 60 * 60_000))
      return reply.code(429).send({ error: 'Too many playback requests' });
    return relayRecordingPlayback(
      request,
      reply,
      claim,
      parameters.data.recordingId,
    );
  });

  app.post(
    '/api/recordings/:recordingId/share-links',
    async (request, reply) => {
      const session = await auth.authenticateStateChange(request, reply);
      if (!session) return;
      if (session.role !== 'owner')
        return reply
          .code(403)
          .send({ error: 'Household owner access required' });
      const parameters = parametersSchema.safeParse(request.params);
      const body = shareLinkCreateSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid share link request' });
      const token = generateToken();
      const expiresAt = new Date(
        Date.now() + body.data.expiresInHours * 60 * 60_000,
      );
      const link = await store.createRecordingShareLink({
        recordingId: parameters.data.recordingId,
        householdId: session.householdId,
        createdByUserId: session.userId,
        tokenHash: hashSecret(token),
        expiresAt,
      });
      if (!link)
        return reply
          .code(409)
          .send({ error: 'Only an available clip can be shared' });
      await store.audit({
        eventType: 'recording_share_link_created',
        householdId: session.householdId,
        ipAddress: request.ip,
        metadata: {
          recordingId: parameters.data.recordingId,
          expiresAt: link.expiresAt.toISOString(),
        },
        success: true,
        userId: session.userId,
      });
      return reply.code(201).send({
        expiresAt: link.expiresAt.toISOString(),
        token,
        url: `${config.WEB_ORIGIN}/shared/${token}`,
      });
    },
  );

  app.get(
    '/api/recordings/:recordingId/share-links',
    async (request, reply) => {
      const session = await auth.authenticate(request, reply);
      if (!session) return;
      if (session.role !== 'owner')
        return reply
          .code(403)
          .send({ error: 'Household owner access required' });
      const parameters = parametersSchema.safeParse(request.params);
      if (!parameters.success)
        return reply.code(404).send({ error: 'Recording unavailable' });
      const active = await store.getActiveRecordingShareLink(
        session.householdId,
        parameters.data.recordingId,
      );
      return {
        active: active
          ? { id: active.id, expiresAt: active.expiresAt.toISOString() }
          : null,
      };
    },
  );

  app.delete('/api/recordings/share-links/:linkId', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (session.role !== 'owner')
      return reply.code(403).send({ error: 'Household owner access required' });
    const parameters = shareLinkParametersSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Share link unavailable' });
    const revoked = await store.revokeRecordingShareLink(
      session.householdId,
      parameters.data.linkId,
    );
    if (!revoked)
      return reply.code(404).send({ error: 'Share link unavailable' });
    await store.audit({
      eventType: 'recording_share_link_revoked',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { linkId: parameters.data.linkId },
      success: true,
      userId: session.userId,
    });
    return reply.code(204).send();
  });

  // Unauthenticated: resolved entirely by a hard-to-guess token, exactly
  // like a guest link (see ADR 0066/0077). Never distinguishes "no such
  // token" from "expired" from "revoked" from "clip no longer available" --
  // they all fail the same way, so a guess can't learn anything from the
  // response.
  app.get('/api/shared-recordings/:token', async (request, reply) => {
    const parameters = shareTokenParametersSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Link unavailable' });
    if (!limiter.take(`share-link-lookup:${request.ip}`, 30, 60 * 60_000))
      return reply.code(429).send({ error: 'Too many requests' });
    const claim = await store.getRecordingShareLinkPlaybackClaim(
      hashSecret(parameters.data.token),
    );
    if (!claim) return reply.code(404).send({ error: 'Link unavailable' });
    return { expiresAt: claim.expiresAt.toISOString() };
  });

  app.get('/api/shared-recordings/:token/playback', async (request, reply) => {
    const parameters = shareTokenParametersSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Link unavailable' });
    if (!limiter.take(`share-link-playback:${request.ip}`, 20, 60 * 60_000))
      return reply.code(429).send({ error: 'Too many requests' });
    const tokenHash = hashSecret(parameters.data.token);
    const claim = await store.getRecordingShareLinkPlaybackClaim(tokenHash);
    if (!claim) return reply.code(404).send({ error: 'Link unavailable' });
    void store.touchRecordingShareLinkAccess(claim.shareLinkId);
    return relayRecordingPlayback(request, reply, claim, claim.recordingId);
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
    if (
      body.data.captureMode === 'camera' &&
      !signaling.requestRecording(camera.publicCameraId, recording.id)
    ) {
      await store.markOwnerRecordingFailed(
        session.householdId,
        session.userId,
        recording.id,
      );
      return reply.code(409).send({ error: 'Camera is offline' });
    }
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
          // The owner uploads from the web app. Bind Google's resumable
          // session to that browser origin so its subsequent PUT receives
          // the provider CORS headers. Device uploads are native and omit it.
          origin: config.WEB_ORIGIN,
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
            providerStatus:
              error instanceof GoogleDriveRequestError
                ? error.status
                : undefined,
            recordingId: claim.recordingId,
          },
          'recording upload session failed',
        );
        if (error instanceof DriveReconnectRequiredError)
          return reply.code(409).send({
            code: 'drive_reconnect_required',
            error: DRIVE_RECONNECT_MESSAGE,
          });
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

  // Shared by the owner and device thumbnail-completion routes: same
  // verify-before-trusting shape as finalizeRecordingUpload, but for the
  // independent thumbnail envelope (ADR 0078) -- no status/audit change,
  // since a thumbnail is optional metadata, not part of the clip lifecycle.
  const finalizeThumbnailUpload = async (
    claim: {
      byteSize: number;
      mimeType: 'image/jpeg' | 'image/webp';
      recordingId: string;
      userId: string;
    },
    providerFileId: string,
    reply: FastifyReply,
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
      const completed = await store.completeThumbnailUpload({
        providerFileId,
        recordingId: claim.recordingId,
        userId: claim.userId,
      });
      if (!completed)
        return reply.code(409).send({ error: 'Thumbnail state changed' });
      return reply.code(204).send();
    } catch (error) {
      app.log.warn(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          recordingId: claim.recordingId,
        },
        'thumbnail completion verification failed',
      );
      return reply
        .code(409)
        .send({ error: 'Uploaded thumbnail could not be verified' });
    }
  };

  app.post(
    '/api/recordings/:recordingId/thumbnail-upload-session',
    async (request, reply) => {
      const session = await auth.authenticateStateChange(request, reply);
      if (!session) return;
      if (session.role !== 'owner')
        return reply
          .code(403)
          .send({ error: 'Household owner access required' });
      const parameters = parametersSchema.safeParse(request.params);
      const body = thumbnailUploadSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid thumbnail upload' });
      if (!recordingKeyCipher)
        return reply
          .code(503)
          .send({ error: 'Encrypted recording storage is unavailable' });
      const wrappedDataKey = recordingKeyCipher.wrap(
        Buffer.from(body.data.encryption.dataKey, 'base64url'),
      );
      const claim = await store.beginOwnerThumbnailUpload({
        byteSize: body.data.byteSize,
        checksumSha256: body.data.checksumSha256,
        mimeType: body.data.mimeType,
        encryptionDataKeyCiphertext: wrappedDataKey.ciphertext,
        encryptionDataKeyIv: wrappedDataKey.iv,
        encryptionIv: Buffer.from(body.data.encryption.iv, 'base64url'),
        householdId: session.householdId,
        recordingId: parameters.data.recordingId,
        userId: session.userId,
      });
      if (!claim)
        return reply.code(404).send({ error: 'Thumbnail upload unavailable' });
      try {
        const accessToken = await recordingAccessToken(claim.userId);
        const uploadUrl = await initiateDriveRecordingUpload({
          accessToken,
          byteSize: claim.byteSize,
          mimeType: 'application/octet-stream',
          origin: config.WEB_ORIGIN,
          recordingId: claim.recordingId,
        });
        reply.header('Cache-Control', 'no-store');
        return reply.code(201).send({
          expiresInSeconds: 6 * 24 * 60 * 60,
          recordingId: claim.recordingId,
          uploadUrl,
        });
      } catch (error) {
        app.log.warn(
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
            recordingId: claim.recordingId,
          },
          'thumbnail upload session failed',
        );
        return reply
          .code(503)
          .send({ error: 'Thumbnail upload is temporarily unavailable' });
      }
    },
  );

  app.post(
    '/api/recordings/:recordingId/thumbnail-complete',
    async (request, reply) => {
      const session = await auth.authenticateStateChange(request, reply);
      if (!session) return;
      if (session.role !== 'owner')
        return reply
          .code(403)
          .send({ error: 'Household owner access required' });
      const parameters = parametersSchema.safeParse(request.params);
      const body = completeSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid thumbnail result' });
      const claim = await store.getThumbnailUploadClaim(
        session.userId,
        parameters.data.recordingId,
      );
      if (!claim)
        return reply.code(404).send({ error: 'Thumbnail upload unavailable' });
      return finalizeThumbnailUpload(claim, body.data.providerFileId, reply);
    },
  );

  app.get('/api/recordings/:recordingId/thumbnail', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Thumbnail unavailable' });
    const accessibleCameras = await store.listAccessibleCameras(
      session.householdId,
      session.userId,
      session.role,
    );
    const claim = await store.getThumbnailPlaybackClaim(
      session.householdId,
      parameters.data.recordingId,
      accessibleCameras.map((camera) => camera.id),
    );
    if (!claim) return reply.code(404).send({ error: 'Thumbnail unavailable' });
    if (!limiter.take(`recording-thumbnail:${session.userId}`, 90, 60 * 60_000))
      return reply.code(429).send({ error: 'Too many requests' });
    return relayRecordingPlayback(
      request,
      reply,
      claim,
      parameters.data.recordingId,
    );
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

  app.post(
    '/api/device/recordings/:recordingId/thumbnail-upload-session',
    async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      if (!token) return unauthorized(reply);
      const parameters = parametersSchema.safeParse(request.params);
      const body = thumbnailUploadSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid thumbnail upload' });
      if (!recordingKeyCipher)
        return reply
          .code(503)
          .send({ error: 'Encrypted recording storage is unavailable' });
      const wrappedDataKey = recordingKeyCipher.wrap(
        Buffer.from(body.data.encryption.dataKey, 'base64url'),
      );
      const claim = await store.beginThumbnailUploadByCredential({
        byteSize: body.data.byteSize,
        checksumSha256: body.data.checksumSha256,
        credentialHash: hashSecret(token),
        mimeType: body.data.mimeType,
        encryptionDataKeyCiphertext: wrappedDataKey.ciphertext,
        encryptionDataKeyIv: wrappedDataKey.iv,
        encryptionIv: Buffer.from(body.data.encryption.iv, 'base64url'),
        recordingId: parameters.data.recordingId,
      });
      if (!claim)
        return reply.code(404).send({ error: 'Thumbnail upload unavailable' });
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
        app.log.warn(
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
            recordingId: claim.recordingId,
          },
          'device thumbnail upload session failed',
        );
        return reply
          .code(503)
          .send({ error: 'Thumbnail upload is temporarily unavailable' });
      }
    },
  );

  app.post(
    '/api/device/recordings/:recordingId/thumbnail-complete',
    async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      if (!token) return unauthorized(reply);
      const parameters = parametersSchema.safeParse(request.params);
      const body = completeSchema.safeParse(request.body);
      if (!parameters.success || !body.success)
        return reply.code(400).send({ error: 'Invalid thumbnail result' });
      const claim = await store.getThumbnailUploadClaimByCredential(
        hashSecret(token),
        parameters.data.recordingId,
      );
      if (!claim)
        return reply.code(404).send({ error: 'Thumbnail upload unavailable' });
      return finalizeThumbnailUpload(claim, body.data.providerFileId, reply);
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
    triggerMotionEventId: recording.triggerMotionEventId,
    hasThumbnail: recording.hasThumbnail,
  };
}
