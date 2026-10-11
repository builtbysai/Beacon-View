import type { Pool } from 'pg';

import type {
  RecordingDeletionClaim,
  RecordingPlaybackClaim,
  RecordingRecord,
  RecordingShareLinkPlaybackClaim,
  RecordingShareLinkStatus,
  RecordingThumbnailPlaybackClaim,
  RecordingThumbnailUploadClaim,
  RecordingUploadClaim,
} from './recording-types.js';

export class PostgresRecordingRepository {
  constructor(private readonly pool: Pool) {}

  async createRequested(input: {
    cameraSourceId: string;
    householdId: string;
    userId: string;
    triggerMotionEventId?: string;
  }): Promise<RecordingRecord | null> {
    const result = await this.pool.query<RecordingRecord>(
      `WITH inserted AS (
         INSERT INTO recordings (household_id, camera_source_id, created_by_user_id, trigger_motion_event_id)
         SELECT $1, cs.id, $3, $4
         FROM camera_sources cs JOIN cameras d ON d.id=cs.device_id
         WHERE cs.id=$2 AND d.household_id=$1 AND cs.enabled=true
           AND cs.removed_at IS NULL AND d.enabled=true
           AND d.revoked_at IS NULL AND d.privacy_mode=false
         RETURNING *
       )
       SELECT r.id, cs.public_camera_id AS "cameraId",
              cs.display_name AS "cameraName", d.name AS "deviceName",
              r.created_by_user_id AS "createdByUserId", r.status,
              r.duration_ms AS "durationMs", r.byte_size AS "byteSize",
              r.expires_at AS "expiresAt", r.created_at AS "createdAt",
              r.updated_at AS "updatedAt",
              r.trigger_motion_event_id AS "triggerMotionEventId",
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTimestamp",
              (r.thumbnail_provider_file_id IS NOT NULL) AS "hasThumbnail"
       FROM inserted r JOIN camera_sources cs ON cs.id=r.camera_source_id
       JOIN cameras d ON d.id=cs.device_id`,
      [
        input.householdId,
        input.cameraSourceId,
        input.userId,
        input.triggerMotionEventId ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async listForCameraSources(
    householdId: string,
    cameraSourceIds: string[],
    options: { limit?: number; before?: { time: string; id: string } } = {},
  ): Promise<RecordingRecord[]> {
    if (cameraSourceIds.length === 0) return [];
    const result = await this.pool.query<RecordingRecord>(
      `SELECT r.id, cs.public_camera_id AS "cameraId",
              cs.display_name AS "cameraName", d.name AS "deviceName",
              r.created_by_user_id AS "createdByUserId", r.status,
              r.duration_ms AS "durationMs", r.byte_size AS "byteSize",
              r.expires_at AS "expiresAt", r.created_at AS "createdAt",
              r.updated_at AS "updatedAt",
              r.trigger_motion_event_id AS "triggerMotionEventId",
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTimestamp",
              (r.thumbnail_provider_file_id IS NOT NULL) AS "hasThumbnail"
       FROM recordings r JOIN camera_sources cs ON cs.id=r.camera_source_id
       JOIN cameras d ON d.id=cs.device_id
       WHERE r.household_id=$1 AND r.camera_source_id=ANY($2::uuid[])
         AND r.deleted_at IS NULL
         AND ($4::timestamptz IS NULL OR (r.created_at, r.id) < ($4, $5::uuid))
       ORDER BY r.created_at DESC, r.id DESC LIMIT $3`,
      [
        householdId,
        cameraSourceIds,
        options.limit ?? 50,
        options.before?.time ?? null,
        options.before?.id ?? null,
      ],
    );
    return result.rows;
  }

  /** Playback is scoped to the same cameras the requester can otherwise
   * see (owner/admin get all; a viewer/guest needs a grant on that
   * specific camera) -- not to whoever happened to request the recording.
   * `cameraSourceIds` is the caller's already-computed accessible set (see
   * listAccessibleCameras), so this never re-derives household ACLs. */
  async getPlaybackClaim(
    householdId: string,
    recordingId: string,
    cameraSourceIds: string[],
  ): Promise<RecordingPlaybackClaim | null> {
    if (cameraSourceIds.length === 0) return null;
    const result = await this.pool.query<RecordingPlaybackClaim>(
      `SELECT provider_file_id AS "providerFileId", byte_size AS "byteSize",
              checksum_sha256 AS "checksumSha256", mime_type AS "mimeType",
              encryption_iv AS "encryptionIv",
              encryption_data_key_ciphertext AS "encryptionDataKeyCiphertext",
              encryption_data_key_iv AS "encryptionDataKeyIv",
              created_by_user_id AS "userId"
       FROM recordings
       WHERE id=$2 AND household_id=$1 AND camera_source_id=ANY($3::uuid[])
         AND status='available' AND deleted_at IS NULL
         AND encryption_version=1 AND provider_file_id IS NOT NULL
         AND byte_size IS NOT NULL AND checksum_sha256 IS NOT NULL
         AND mime_type IN ('video/mp4', 'video/webm')
         AND encryption_iv IS NOT NULL
         AND encryption_data_key_ciphertext IS NOT NULL
         AND encryption_data_key_iv IS NOT NULL`,
      [householdId, recordingId, cameraSourceIds],
    );
    return result.rows[0] ?? null;
  }

  async markDeleted(
    householdId: string,
    recordingId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE recordings SET status='deleted', deleted_at=now(), updated_at=now()
       WHERE id=$2 AND household_id=$1 AND deleted_at IS NULL
         AND status IN ('requested', 'failed')`,
      [householdId, recordingId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Gives each stored wrapped clip or thumbnail key to `transform`, and saves the
   * replacement it returns (null leaves the row alone). Used to move keys onto
   * the current server key and the recording-bound form (V7). Returns how many
   * were rewritten.
   */
  async rewrapKeys(
    transform: (row: {
      recordingId: string;
      purpose: 'clip' | 'thumbnail';
      ciphertext: Buffer;
      iv: Buffer;
    }) => { ciphertext: Buffer; iv: Buffer } | null,
  ): Promise<number> {
    const rows = await this.pool.query<{
      id: string;
      clipCiphertext: Buffer | null;
      clipIv: Buffer | null;
      thumbCiphertext: Buffer | null;
      thumbIv: Buffer | null;
    }>(
      `SELECT id, encryption_data_key_ciphertext AS "clipCiphertext",
              encryption_data_key_iv AS "clipIv",
              thumbnail_encryption_data_key_ciphertext AS "thumbCiphertext",
              thumbnail_encryption_data_key_iv AS "thumbIv"
       FROM recordings
       WHERE encryption_data_key_ciphertext IS NOT NULL
          OR thumbnail_encryption_data_key_ciphertext IS NOT NULL`,
    );
    let rewritten = 0;
    for (const row of rows.rows) {
      if (row.clipCiphertext && row.clipIv) {
        const next = transform({
          recordingId: row.id,
          purpose: 'clip',
          ciphertext: row.clipCiphertext,
          iv: row.clipIv,
        });
        if (next) {
          await this.pool.query(
            `UPDATE recordings SET encryption_data_key_ciphertext=$2,
                    encryption_data_key_iv=$3
             WHERE id=$1 AND encryption_data_key_ciphertext=$4`,
            [row.id, next.ciphertext, next.iv, row.clipCiphertext],
          );
          rewritten += 1;
        }
      }
      if (row.thumbCiphertext && row.thumbIv) {
        const next = transform({
          recordingId: row.id,
          purpose: 'thumbnail',
          ciphertext: row.thumbCiphertext,
          iv: row.thumbIv,
        });
        if (next) {
          await this.pool.query(
            `UPDATE recordings SET thumbnail_encryption_data_key_ciphertext=$2,
                    thumbnail_encryption_data_key_iv=$3
             WHERE id=$1 AND thumbnail_encryption_data_key_ciphertext=$4`,
            [row.id, next.ciphertext, next.iv, row.thumbCiphertext],
          );
          rewritten += 1;
        }
      }
    }
    return rewritten;
  }

  /** Every Drive file a household's clips and thumbnails occupy, with the
   * user whose Drive holds it, so account deletion can remove them (V42). */
  async listDriveFiles(
    householdId: string,
  ): Promise<{ userId: string; providerFileId: string }[]> {
    const result = await this.pool.query<{
      userId: string;
      providerFileId: string;
    }>(
      `SELECT created_by_user_id AS "userId", provider_file_id AS "providerFileId"
       FROM recordings
       WHERE household_id=$1 AND created_by_user_id IS NOT NULL
         AND provider_file_id IS NOT NULL
       UNION ALL
       SELECT created_by_user_id, thumbnail_provider_file_id
       FROM recordings
       WHERE household_id=$1 AND created_by_user_id IS NOT NULL
         AND thumbnail_provider_file_id IS NOT NULL`,
      [householdId],
    );
    return result.rows;
  }

  async beginAvailableDeletion(
    householdId: string,
    recordingId: string,
  ): Promise<RecordingDeletionClaim | null> {
    const result = await this.pool.query<RecordingDeletionClaim>(
      `UPDATE recordings SET status='deleting', updated_at=now()
       WHERE id=$2 AND household_id=$1 AND status='available'
         AND provider_file_id IS NOT NULL AND deleted_at IS NULL
       RETURNING id AS "recordingId", created_by_user_id AS "userId",
                 provider_file_id AS "providerFileId"`,
      [householdId, recordingId],
    );
    return result.rows[0] ?? null;
  }

  async finishDeletion(
    householdId: string,
    recordingId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE recordings SET status='deleted', deleted_at=now(), updated_at=now()
       WHERE id=$2 AND household_id=$1 AND status='deleting'`,
      [householdId, recordingId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async cancelDeletion(recordingId: string): Promise<void> {
    await this.pool.query(
      `UPDATE recordings SET status='available', updated_at=now()
       WHERE id=$1 AND status='deleting' AND deleted_at IS NULL`,
      [recordingId],
    );
  }

  async beginUpload(input: {
    byteSize: number;
    checksumSha256: string;
    credentialHash: string;
    durationMs: number;
    encryptionDataKeyCiphertext: Buffer;
    encryptionDataKeyIv: Buffer;
    encryptionIv: Buffer;
    mimeType: 'video/mp4' | 'video/webm';
    recordingId: string;
  }): Promise<RecordingUploadClaim | null> {
    const result = await this.pool.query<RecordingUploadClaim>(
      `UPDATE recordings r
       SET status='uploading', byte_size=$3, duration_ms=$4,
           checksum_sha256=$5, mime_type=$6, encryption_version=1,
           encryption_iv=$7, encryption_data_key_ciphertext=$8,
           encryption_data_key_iv=$9, updated_at=now()
       FROM camera_sources cs, cameras d, device_credentials dc
       WHERE r.id=$2 AND r.camera_source_id=cs.id AND cs.device_id=d.id
         AND dc.camera_id=d.id AND dc.credential_hash=$1
         AND dc.revoked_at IS NULL AND d.revoked_at IS NULL
         AND d.enabled=true AND d.privacy_mode=false AND cs.enabled=true
         AND cs.removed_at IS NULL AND r.deleted_at IS NULL
         AND r.status IN ('requested', 'failed')
       RETURNING r.id AS "recordingId", r.created_by_user_id AS "userId",
                 r.byte_size AS "byteSize", r.mime_type AS "mimeType"`,
      [
        input.credentialHash,
        input.recordingId,
        input.byteSize,
        input.durationMs,
        input.checksumSha256,
        input.mimeType,
        input.encryptionIv,
        input.encryptionDataKeyCiphertext,
        input.encryptionDataKeyIv,
      ],
    );
    return result.rows[0] ?? null;
  }

  async beginOwnerUpload(input: {
    byteSize: number;
    checksumSha256: string;
    durationMs: number;
    encryptionDataKeyCiphertext: Buffer;
    encryptionDataKeyIv: Buffer;
    encryptionIv: Buffer;
    householdId: string;
    mimeType: 'video/mp4' | 'video/webm';
    recordingId: string;
    userId: string;
  }): Promise<RecordingUploadClaim | null> {
    const result = await this.pool.query<RecordingUploadClaim>(
      `UPDATE recordings SET status='uploading', byte_size=$4,
              duration_ms=$5, checksum_sha256=$6, mime_type=$7,
              encryption_version=1, encryption_iv=$8,
              encryption_data_key_ciphertext=$9, encryption_data_key_iv=$10,
              updated_at=now()
       WHERE id=$3 AND household_id=$1 AND created_by_user_id=$2
         AND deleted_at IS NULL AND status IN ('requested', 'failed')
       RETURNING id AS "recordingId", created_by_user_id AS "userId",
                 byte_size AS "byteSize", mime_type AS "mimeType"`,
      [
        input.householdId,
        input.userId,
        input.recordingId,
        input.byteSize,
        input.durationMs,
        input.checksumSha256,
        input.mimeType,
        input.encryptionIv,
        input.encryptionDataKeyCiphertext,
        input.encryptionDataKeyIv,
      ],
    );
    return result.rows[0] ?? null;
  }

  async getUploadClaim(
    userId: string,
    recordingId: string,
  ): Promise<RecordingUploadClaim | null> {
    const result = await this.pool.query<RecordingUploadClaim>(
      `SELECT id AS "recordingId", created_by_user_id AS "userId",
              byte_size AS "byteSize", mime_type AS "mimeType"
       FROM recordings WHERE id=$2 AND created_by_user_id=$1
         AND status='uploading' AND deleted_at IS NULL
         AND byte_size IS NOT NULL AND mime_type IS NOT NULL`,
      [userId, recordingId],
    );
    return result.rows[0] ?? null;
  }

  /** Device-credential counterpart to getUploadClaim: lets the camera that
   * started a device-initiated upload (beginUpload) report completion
   * itself, without requiring a browser session to be open. */
  async getUploadClaimByCredential(
    credentialHash: string,
    recordingId: string,
  ): Promise<RecordingUploadClaim | null> {
    const result = await this.pool.query<RecordingUploadClaim>(
      `SELECT r.id AS "recordingId", r.created_by_user_id AS "userId",
              r.byte_size AS "byteSize", r.mime_type AS "mimeType"
       FROM recordings r
       JOIN camera_sources cs ON cs.id = r.camera_source_id
       JOIN cameras d ON d.id = cs.device_id
       JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE r.id = $2 AND dc.credential_hash = $1 AND dc.revoked_at IS NULL
         AND r.status = 'uploading' AND r.deleted_at IS NULL
         AND r.byte_size IS NOT NULL AND r.mime_type IS NOT NULL`,
      [credentialHash, recordingId],
    );
    return result.rows[0] ?? null;
  }

  async markUploadFailed(recordingId: string): Promise<void> {
    await this.pool.query(
      `UPDATE recordings SET status='failed', updated_at=now()
       WHERE id=$1 AND status='uploading' AND deleted_at IS NULL`,
      [recordingId],
    );
  }

  async markOwnerFailed(
    householdId: string,
    userId: string,
    recordingId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE recordings SET status='failed', updated_at=now()
       WHERE id=$3 AND household_id=$1 AND created_by_user_id=$2
         AND status IN ('requested', 'recording', 'uploading', 'failed')
         AND deleted_at IS NULL`,
      [householdId, userId, recordingId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async markFailedByCredential(
    credentialHash: string,
    recordingId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE recordings r SET status='failed', updated_at=now()
       FROM camera_sources cs, cameras d, device_credentials dc
       WHERE r.id=$2 AND r.camera_source_id=cs.id AND cs.device_id=d.id
         AND dc.camera_id=d.id AND dc.credential_hash=$1
         AND dc.revoked_at IS NULL AND d.revoked_at IS NULL
         AND r.status IN ('requested', 'recording', 'uploading', 'failed')
         AND r.deleted_at IS NULL`,
      [credentialHash, recordingId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async recoverStale(now: Date): Promise<number> {
    const result = await this.pool.query(
      `UPDATE recordings SET status='failed', updated_at=$1::timestamptz
       WHERE deleted_at IS NULL AND (
         (status IN ('requested', 'recording') AND updated_at < $1::timestamptz - interval '15 minutes')
         OR (status='uploading' AND updated_at < $1::timestamptz - interval '2 hours')
       )`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  async completeUpload(input: {
    recordingId: string;
    providerFileId: string;
    userId: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE recordings SET status='available', provider_file_id=$3,
              updated_at=now()
       WHERE id=$2 AND created_by_user_id=$1 AND status='uploading'
         AND deleted_at IS NULL AND provider_file_id IS NULL`,
      [input.userId, input.recordingId, input.providerFileId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** At most one active link per recording: revokes any existing one first,
   * in the same transaction as creating the new one, so a recording is
   * never briefly reachable by two tokens at once. Only an available,
   * non-deleted recording in this household can be shared. */
  async createShareLink(input: {
    recordingId: string;
    householdId: string;
    createdByUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RecordingShareLinkStatus | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const recording = await client.query(
        `SELECT id FROM recordings
         WHERE id=$1 AND household_id=$2 AND status='available'
           AND deleted_at IS NULL
         FOR UPDATE`,
        [input.recordingId, input.householdId],
      );
      if (recording.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `UPDATE recording_share_links SET revoked_at=now(), updated_at=now()
         WHERE recording_id=$1 AND revoked_at IS NULL AND expires_at > now()`,
        [input.recordingId],
      );
      const inserted = await client.query<{
        id: string;
        expiresAt: Date;
      }>(
        `INSERT INTO recording_share_links
           (recording_id, household_id, token_hash, created_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, expires_at AS "expiresAt"`,
        [
          input.recordingId,
          input.householdId,
          input.tokenHash,
          input.createdByUserId,
          input.expiresAt,
        ],
      );
      await client.query('COMMIT');
      return inserted.rows[0] ?? null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getActiveShareLink(
    householdId: string,
    recordingId: string,
  ): Promise<RecordingShareLinkStatus | null> {
    const result = await this.pool.query<RecordingShareLinkStatus>(
      `SELECT id, expires_at AS "expiresAt"
       FROM recording_share_links
       WHERE recording_id=$2 AND household_id=$1
         AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [householdId, recordingId],
    );
    return result.rows[0] ?? null;
  }

  async revokeShareLink(householdId: string, linkId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE recording_share_links SET revoked_at=now(), updated_at=now()
       WHERE id=$2 AND household_id=$1 AND revoked_at IS NULL`,
      [householdId, linkId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** Resolves a share token straight to a playback claim in one query, so
   * the link's validity and the recording's playback readiness are checked
   * against the same snapshot. Returns null for an unknown, expired,
   * revoked, or no-longer-available-clip token -- deliberately the same
   * outcome for all of those, so a guess can't distinguish them. */
  async getShareLinkPlaybackClaim(
    tokenHash: string,
  ): Promise<RecordingShareLinkPlaybackClaim | null> {
    const result = await this.pool.query<RecordingShareLinkPlaybackClaim>(
      `SELECT l.id AS "shareLinkId", l.expires_at AS "expiresAt",
              l.revoked_at AS "revokedAt", r.id AS "recordingId",
              r.provider_file_id AS "providerFileId", r.byte_size AS "byteSize",
              r.checksum_sha256 AS "checksumSha256", r.mime_type AS "mimeType",
              r.encryption_iv AS "encryptionIv",
              r.encryption_data_key_ciphertext AS "encryptionDataKeyCiphertext",
              r.encryption_data_key_iv AS "encryptionDataKeyIv",
              r.created_by_user_id AS "userId"
       FROM recording_share_links l
       JOIN recordings r ON r.id = l.recording_id
       WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at > now()
         AND r.status='available' AND r.deleted_at IS NULL
         AND r.encryption_version=1 AND r.provider_file_id IS NOT NULL
         AND r.byte_size IS NOT NULL AND r.checksum_sha256 IS NOT NULL
         AND r.mime_type IN ('video/mp4', 'video/webm')
         AND r.encryption_iv IS NOT NULL
         AND r.encryption_data_key_ciphertext IS NOT NULL
         AND r.encryption_data_key_iv IS NOT NULL`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async touchShareLinkAccess(linkId: string): Promise<void> {
    await this.pool.query(
      `UPDATE recording_share_links SET last_accessed_at=now()
       WHERE id=$1`,
      [linkId],
    );
  }

  // Thumbnails (ADR 0078): a small, independently encrypted image, uploaded
  // once and never replaced once it lands -- first-write-wins, so a stray
  // retry can never orphan an already-uploaded Drive file.

  async beginOwnerThumbnailUpload(input: {
    byteSize: number;
    checksumSha256: string;
    encryptionDataKeyCiphertext: Buffer;
    encryptionDataKeyIv: Buffer;
    encryptionIv: Buffer;
    householdId: string;
    mimeType: 'image/jpeg' | 'image/webp';
    recordingId: string;
    userId: string;
  }): Promise<RecordingThumbnailUploadClaim | null> {
    const result = await this.pool.query<RecordingThumbnailUploadClaim>(
      `UPDATE recordings SET thumbnail_byte_size=$4,
              thumbnail_checksum_sha256=$5, thumbnail_mime_type=$6,
              thumbnail_encryption_iv=$7,
              thumbnail_encryption_data_key_ciphertext=$8,
              thumbnail_encryption_data_key_iv=$9, updated_at=now()
       WHERE id=$3 AND household_id=$1 AND created_by_user_id=$2
         AND deleted_at IS NULL AND thumbnail_provider_file_id IS NULL
       RETURNING id AS "recordingId", created_by_user_id AS "userId",
                 thumbnail_byte_size AS "byteSize",
                 thumbnail_mime_type AS "mimeType"`,
      [
        input.householdId,
        input.userId,
        input.recordingId,
        input.byteSize,
        input.checksumSha256,
        input.mimeType,
        input.encryptionIv,
        input.encryptionDataKeyCiphertext,
        input.encryptionDataKeyIv,
      ],
    );
    return result.rows[0] ?? null;
  }

  async beginThumbnailUploadByCredential(input: {
    byteSize: number;
    checksumSha256: string;
    credentialHash: string;
    encryptionDataKeyCiphertext: Buffer;
    encryptionDataKeyIv: Buffer;
    encryptionIv: Buffer;
    mimeType: 'image/jpeg' | 'image/webp';
    recordingId: string;
  }): Promise<RecordingThumbnailUploadClaim | null> {
    const result = await this.pool.query<RecordingThumbnailUploadClaim>(
      `UPDATE recordings r
       SET thumbnail_byte_size=$3, thumbnail_checksum_sha256=$4,
           thumbnail_mime_type=$5, thumbnail_encryption_iv=$6,
           thumbnail_encryption_data_key_ciphertext=$7,
           thumbnail_encryption_data_key_iv=$8, updated_at=now()
       FROM camera_sources cs, cameras d, device_credentials dc
       WHERE r.id=$2 AND r.camera_source_id=cs.id AND cs.device_id=d.id
         AND dc.camera_id=d.id AND dc.credential_hash=$1
         AND dc.revoked_at IS NULL AND d.revoked_at IS NULL
         AND d.enabled=true AND d.privacy_mode=false AND cs.enabled=true
         AND cs.removed_at IS NULL AND r.deleted_at IS NULL
         AND r.thumbnail_provider_file_id IS NULL
       RETURNING r.id AS "recordingId", r.created_by_user_id AS "userId",
                 r.thumbnail_byte_size AS "byteSize",
                 r.thumbnail_mime_type AS "mimeType"`,
      [
        input.credentialHash,
        input.recordingId,
        input.byteSize,
        input.checksumSha256,
        input.mimeType,
        input.encryptionIv,
        input.encryptionDataKeyCiphertext,
        input.encryptionDataKeyIv,
      ],
    );
    return result.rows[0] ?? null;
  }

  async getThumbnailUploadClaim(
    userId: string,
    recordingId: string,
  ): Promise<RecordingThumbnailUploadClaim | null> {
    const result = await this.pool.query<RecordingThumbnailUploadClaim>(
      `SELECT id AS "recordingId", created_by_user_id AS "userId",
              thumbnail_byte_size AS "byteSize",
              thumbnail_mime_type AS "mimeType"
       FROM recordings WHERE id=$2 AND created_by_user_id=$1
         AND deleted_at IS NULL AND thumbnail_provider_file_id IS NULL
         AND thumbnail_byte_size IS NOT NULL
         AND thumbnail_mime_type IS NOT NULL`,
      [userId, recordingId],
    );
    return result.rows[0] ?? null;
  }

  async getThumbnailUploadClaimByCredential(
    credentialHash: string,
    recordingId: string,
  ): Promise<RecordingThumbnailUploadClaim | null> {
    const result = await this.pool.query<RecordingThumbnailUploadClaim>(
      `SELECT r.id AS "recordingId", r.created_by_user_id AS "userId",
              r.thumbnail_byte_size AS "byteSize",
              r.thumbnail_mime_type AS "mimeType"
       FROM recordings r
       JOIN camera_sources cs ON cs.id = r.camera_source_id
       JOIN cameras d ON d.id = cs.device_id
       JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE r.id = $2 AND dc.credential_hash = $1 AND dc.revoked_at IS NULL
         AND r.deleted_at IS NULL AND r.thumbnail_provider_file_id IS NULL
         AND r.thumbnail_byte_size IS NOT NULL
         AND r.thumbnail_mime_type IS NOT NULL`,
      [credentialHash, recordingId],
    );
    return result.rows[0] ?? null;
  }

  async completeThumbnailUpload(input: {
    recordingId: string;
    providerFileId: string;
    userId: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE recordings SET thumbnail_provider_file_id=$3, updated_at=now()
       WHERE id=$2 AND created_by_user_id=$1
         AND deleted_at IS NULL AND thumbnail_provider_file_id IS NULL
         AND thumbnail_byte_size IS NOT NULL`,
      [input.userId, input.recordingId, input.providerFileId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async getThumbnailPlaybackClaim(
    householdId: string,
    recordingId: string,
    cameraSourceIds: string[],
  ): Promise<RecordingThumbnailPlaybackClaim | null> {
    if (cameraSourceIds.length === 0) return null;
    const result = await this.pool.query<RecordingThumbnailPlaybackClaim>(
      `SELECT thumbnail_provider_file_id AS "providerFileId",
              thumbnail_byte_size AS "byteSize",
              thumbnail_checksum_sha256 AS "checksumSha256",
              thumbnail_mime_type AS "mimeType",
              thumbnail_encryption_iv AS "encryptionIv",
              thumbnail_encryption_data_key_ciphertext AS "encryptionDataKeyCiphertext",
              thumbnail_encryption_data_key_iv AS "encryptionDataKeyIv",
              created_by_user_id AS "userId"
       FROM recordings
       WHERE id=$2 AND household_id=$1 AND camera_source_id=ANY($3::uuid[])
         AND deleted_at IS NULL AND thumbnail_provider_file_id IS NOT NULL
         AND thumbnail_byte_size IS NOT NULL
         AND thumbnail_checksum_sha256 IS NOT NULL
         AND thumbnail_mime_type IN ('image/jpeg', 'image/webp')
         AND thumbnail_encryption_iv IS NOT NULL
         AND thumbnail_encryption_data_key_ciphertext IS NOT NULL
         AND thumbnail_encryption_data_key_iv IS NOT NULL`,
      [householdId, recordingId, cameraSourceIds],
    );
    return result.rows[0] ?? null;
  }
}
