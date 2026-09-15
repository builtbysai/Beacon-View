import type { Pool } from 'pg';

import type {
  RecordingDeletionClaim,
  RecordingRecord,
  RecordingUploadClaim,
} from './recording-types.js';

export class PostgresRecordingRepository {
  constructor(private readonly pool: Pool) {}

  async createRequested(input: {
    cameraSourceId: string;
    householdId: string;
    userId: string;
  }): Promise<RecordingRecord | null> {
    const result = await this.pool.query<RecordingRecord>(
      `WITH inserted AS (
         INSERT INTO recordings (household_id, camera_source_id, created_by_user_id)
         SELECT $1, cs.id, $3
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
              r.updated_at AS "updatedAt"
       FROM inserted r JOIN camera_sources cs ON cs.id=r.camera_source_id
       JOIN cameras d ON d.id=cs.device_id`,
      [input.householdId, input.cameraSourceId, input.userId],
    );
    return result.rows[0] ?? null;
  }

  async listForCameraSources(
    householdId: string,
    cameraSourceIds: string[],
  ): Promise<RecordingRecord[]> {
    if (cameraSourceIds.length === 0) return [];
    const result = await this.pool.query<RecordingRecord>(
      `SELECT r.id, cs.public_camera_id AS "cameraId",
              cs.display_name AS "cameraName", d.name AS "deviceName",
              r.created_by_user_id AS "createdByUserId", r.status,
              r.duration_ms AS "durationMs", r.byte_size AS "byteSize",
              r.expires_at AS "expiresAt", r.created_at AS "createdAt",
              r.updated_at AS "updatedAt"
       FROM recordings r JOIN camera_sources cs ON cs.id=r.camera_source_id
       JOIN cameras d ON d.id=cs.device_id
       WHERE r.household_id=$1 AND r.camera_source_id=ANY($2::uuid[])
         AND r.deleted_at IS NULL
       ORDER BY r.created_at DESC, r.id DESC LIMIT 200`,
      [householdId, cameraSourceIds],
    );
    return result.rows;
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
    mimeType: 'video/mp4' | 'video/webm';
    recordingId: string;
  }): Promise<RecordingUploadClaim | null> {
    const result = await this.pool.query<RecordingUploadClaim>(
      `UPDATE recordings r
       SET status='uploading', byte_size=$3, duration_ms=$4,
           checksum_sha256=$5, mime_type=$6, updated_at=now()
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
      ],
    );
    return result.rows[0] ?? null;
  }

  async beginOwnerUpload(input: {
    byteSize: number;
    checksumSha256: string;
    durationMs: number;
    householdId: string;
    mimeType: 'video/mp4' | 'video/webm';
    recordingId: string;
    userId: string;
  }): Promise<RecordingUploadClaim | null> {
    const result = await this.pool.query<RecordingUploadClaim>(
      `UPDATE recordings SET status='uploading', byte_size=$4,
              duration_ms=$5, checksum_sha256=$6, mime_type=$7,
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
}
