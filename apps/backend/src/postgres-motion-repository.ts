import type { Pool } from 'pg';

import {
  isQuietHoursActive,
  minuteToTimeOfDay,
  normalizeZones,
  timeOfDayToMinute,
  type CameraMotionSettings,
  type MotionSettings,
} from './motion-settings.js';
import type {
  MotionEventOptions,
  MotionEventRecord,
  MotionRetentionDays,
  MotionRetentionRecord,
  RetentionPurgeRecord,
} from './store-contract.js';
import type { CameraUseCase, MotionPreset } from './camera-use-case.js';
import type { PostgresNotificationRepository } from './postgres-notification-repository.js';

export class PostgresMotionRepository {
  constructor(
    private readonly pool: Pool,
    private readonly notifications?: PostgresNotificationRepository,
  ) {}

  async listMotionEvents(
    householdId: string,
    options: MotionEventOptions = {},
  ): Promise<MotionEventRecord[]> {
    const result = await this.pool.query<MotionEventRecord>(
      `SELECT me.id, cs.public_camera_id AS "publicCameraId",
              cs.display_name AS "cameraName", d.name AS "deviceName",
              me.confidence::double precision AS confidence,
              me.occurred_at AS "occurredAt",
              to_char(me.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTimestamp",
              r.id AS "recordingId", r.status AS "recordingStatus"
       FROM motion_events me
       JOIN camera_sources cs ON cs.id = me.camera_source_id
       JOIN cameras d ON d.id = cs.device_id
       JOIN households h ON h.id = d.household_id
       LEFT JOIN recordings r ON r.trigger_motion_event_id = me.id
         AND r.deleted_at IS NULL
       WHERE d.household_id = $1
         AND me.occurred_at >= now() - (h.motion_retention_days * interval '1 day')
         AND ($2::uuid IS NULL OR cs.public_camera_id = $2)
         AND ($3::timestamptz IS NULL OR me.occurred_at >= $3)
         AND ($4::timestamptz IS NULL OR (me.occurred_at, me.id) < ($4, $5::uuid))
         AND ($6::uuid[] IS NULL OR cs.public_camera_id = ANY($6::uuid[]))
       ORDER BY me.occurred_at DESC, me.id DESC
       LIMIT $7`,
      [
        householdId,
        options.cameraId ?? null,
        options.since ?? null,
        options.before?.time ?? null,
        options.before?.id ?? null,
        options.allowedCameraIds ?? null,
        options.limit ?? 100,
      ],
    );
    return result.rows;
  }

  async getMotionEventById(
    householdId: string,
    motionEventId: string,
    allowedCameraIds?: string[],
  ): Promise<MotionEventRecord | null> {
    const result = await this.pool.query<MotionEventRecord>(
      `SELECT me.id, cs.public_camera_id AS "publicCameraId",
              cs.display_name AS "cameraName", d.name AS "deviceName",
              me.confidence::double precision AS confidence,
              me.occurred_at AS "occurredAt",
              to_char(me.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTimestamp",
              r.id AS "recordingId", r.status AS "recordingStatus"
       FROM motion_events me
       JOIN camera_sources cs ON cs.id = me.camera_source_id
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN recordings r ON r.trigger_motion_event_id = me.id
         AND r.deleted_at IS NULL
       WHERE d.household_id = $1 AND me.id = $2
         AND ($3::uuid[] IS NULL OR cs.public_camera_id = ANY($3::uuid[]))`,
      [householdId, motionEventId, allowedCameraIds ?? null],
    );
    return result.rows[0] ?? null;
  }

  async getMotionRetention(
    householdId: string,
  ): Promise<MotionRetentionRecord | null> {
    const result = await this.pool.query<MotionRetentionRecord>(
      `SELECT motion_retention_days AS days FROM households WHERE id = $1`,
      [householdId],
    );
    return result.rows[0] ?? null;
  }

  async updateMotionRetention(
    householdId: string,
    days: MotionRetentionDays,
  ): Promise<MotionRetentionRecord | null> {
    const result = await this.pool.query<MotionRetentionRecord>(
      `UPDATE households SET motion_retention_days = $2, updated_at = now()
       WHERE id = $1
       RETURNING motion_retention_days AS days`,
      [householdId, days],
    );
    return result.rows[0] ?? null;
  }

  async purgeExpiredMotionEvents(now: Date): Promise<RetentionPurgeRecord[]> {
    const result = await this.pool.query<RetentionPurgeRecord>(
      `WITH deleted AS (
         DELETE FROM motion_events me
         USING camera_sources cs, cameras d, households h
         WHERE me.camera_source_id = cs.id
           AND cs.device_id = d.id
           AND d.household_id = h.id
           AND me.occurred_at < $1::timestamptz - (h.motion_retention_days * interval '1 day')
         RETURNING d.household_id
       )
       SELECT household_id AS "householdId", count(*)::int AS "deletedCount"
       FROM deleted
       GROUP BY household_id`,
      [now],
    );
    return result.rows;
  }

  async clearMotionEvents(householdId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM motion_events me
       USING camera_sources cs, cameras d
       WHERE me.camera_source_id = cs.id AND cs.device_id = d.id
         AND d.household_id = $1`,
      [householdId],
    );
    return result.rowCount ?? 0;
  }

  async listMotionSettings(
    householdId: string,
    publicDeviceId: string,
  ): Promise<CameraMotionSettings[]> {
    const result = await this.pool.query<CameraMotionSettings>(
      `SELECT cs.public_camera_id AS "cameraId", cs.motion_enabled AS enabled,
              cs.motion_record_enabled AS "recordOnMotion",
              cs.motion_ignored_zones AS "ignoredZones",
              cs.motion_sensitivity AS sensitivity, cs.motion_cooldown_seconds AS "cooldownSeconds",
              CASE WHEN cs.motion_quiet_hours_start_minute IS NULL THEN NULL ELSE jsonb_build_object('start', lpad((cs.motion_quiet_hours_start_minute / 60)::text, 2, '0') || ':' || lpad((cs.motion_quiet_hours_start_minute % 60)::text, 2, '0'), 'end', lpad((cs.motion_quiet_hours_end_minute / 60)::text, 2, '0') || ':' || lpad((cs.motion_quiet_hours_end_minute % 60)::text, 2, '0'), 'timeZone', cs.motion_quiet_hours_time_zone) END AS "quietHours"
       FROM camera_sources cs JOIN cameras d ON d.id = cs.device_id
       JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1 AND d.public_device_id = $2 AND d.platform = 'android'
         AND d.revoked_at IS NULL AND dc.revoked_at IS NULL AND cs.removed_at IS NULL
       ORDER BY cs.created_at, cs.id`,
      [householdId, publicDeviceId],
    );
    return result.rows;
  }

  async updateMotionSettings(
    householdId: string,
    publicCameraId: string,
    settings: MotionSettings,
  ): Promise<CameraMotionSettings | null> {
    const result = await this.pool.query<CameraMotionSettings>(
      `UPDATE camera_sources cs SET motion_enabled = $3, motion_record_enabled = $4,
              motion_sensitivity = $5, motion_cooldown_seconds = $6,
              motion_quiet_hours_start_minute = $7, motion_quiet_hours_end_minute = $8,
              motion_quiet_hours_time_zone = $9,
              motion_ignored_zones = COALESCE($10::jsonb, cs.motion_ignored_zones),
              updated_at = now()
       FROM cameras d WHERE cs.device_id = d.id AND d.household_id = $1
         AND cs.public_camera_id = $2 AND d.platform = 'android'
         AND cs.removed_at IS NULL AND d.revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM device_credentials dc WHERE dc.camera_id = d.id AND dc.revoked_at IS NULL)
       RETURNING cs.public_camera_id AS "cameraId", cs.motion_enabled AS enabled,
                 cs.motion_record_enabled AS "recordOnMotion",
                 cs.motion_ignored_zones AS "ignoredZones",
                 cs.motion_sensitivity AS sensitivity, cs.motion_cooldown_seconds AS "cooldownSeconds",
                 CASE WHEN cs.motion_quiet_hours_start_minute IS NULL THEN NULL ELSE jsonb_build_object('start', lpad((cs.motion_quiet_hours_start_minute / 60)::text, 2, '0') || ':' || lpad((cs.motion_quiet_hours_start_minute % 60)::text, 2, '0'), 'end', lpad((cs.motion_quiet_hours_end_minute / 60)::text, 2, '0') || ':' || lpad((cs.motion_quiet_hours_end_minute % 60)::text, 2, '0'), 'timeZone', cs.motion_quiet_hours_time_zone) END AS "quietHours"`,
      [
        householdId,
        publicCameraId,
        settings.enabled,
        settings.recordOnMotion,
        settings.sensitivity,
        settings.cooldownSeconds,
        settings.quietHours
          ? timeOfDayToMinute(settings.quietHours.start)
          : null,
        settings.quietHours ? timeOfDayToMinute(settings.quietHours.end) : null,
        settings.quietHours?.timeZone ?? null,
        settings.ignoredZones
          ? JSON.stringify(normalizeZones(settings.ignoredZones))
          : null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async setCameraUseCase(
    householdId: string,
    publicCameraId: string,
    useCase: CameraUseCase,
    preset: MotionPreset | null,
  ): Promise<{ motionPresetApplied: boolean; useCase: CameraUseCase } | null> {
    // Only Android cameras detect motion on the device; a browser camera's
    // use case is a label and its camera-power/sound defaults.
    const result = await this.pool.query<{
      motionPresetApplied: boolean;
      useCase: CameraUseCase;
    }>(
      `UPDATE camera_sources cs SET use_case = $3, updated_at = now(),
              motion_enabled = CASE WHEN d.platform = 'android' AND $4::boolean IS NOT NULL THEN $4 ELSE cs.motion_enabled END,
              motion_record_enabled = CASE WHEN d.platform = 'android' AND $5::boolean IS NOT NULL THEN $5 ELSE cs.motion_record_enabled END,
              motion_sensitivity = CASE WHEN d.platform = 'android' AND $6::text IS NOT NULL THEN $6 ELSE cs.motion_sensitivity END,
              motion_cooldown_seconds = CASE WHEN d.platform = 'android' AND $7::integer IS NOT NULL THEN $7 ELSE cs.motion_cooldown_seconds END
       FROM cameras d WHERE cs.device_id = d.id AND d.household_id = $1
         AND cs.public_camera_id = $2 AND cs.removed_at IS NULL AND d.revoked_at IS NULL
       RETURNING cs.use_case AS "useCase",
                 (d.platform = 'android' AND $4::boolean IS NOT NULL) AS "motionPresetApplied"`,
      [
        householdId,
        publicCameraId,
        useCase,
        preset?.enabled ?? null,
        preset?.recordOnMotion ?? null,
        preset?.sensitivity ?? null,
        preset?.cooldownSeconds ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async createMotionEvent(input: {
    credentialHash: string;
    publicCameraId: string;
    confidence: number;
    now: Date;
  }): Promise<{
    created: boolean;
    householdId: string;
    cameraSourceId: string;
    ownerId: string;
    recordOnMotion: boolean;
    motionEventId: string | null;
  } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      // Lock the device before its credential/source, as registration does.
      // Waiting writers must check cooldown in a subsequent statement so they
      // see the event committed by the preceding writer, not its old snapshot.
      const identity = await client.query<{
        deviceId: string;
        householdId: string;
        userId: string;
      }>(
        `SELECT d.id AS "deviceId", d.household_id AS "householdId", h.owner_id AS "userId"
         FROM cameras d JOIN households h ON h.id = d.household_id
         JOIN device_credentials dc ON dc.camera_id = d.id
         WHERE $1 IN (dc.credential_hash, dc.previous_credential_hash) AND dc.revoked_at IS NULL
           AND d.revoked_at IS NULL AND d.enabled = true AND d.privacy_mode = false
         FOR UPDATE OF d`,
        [input.credentialHash],
      );
      const device = identity.rows[0];
      if (!device) {
        await client.query('ROLLBACK');
        return null;
      }
      const source = await client.query<{
        id: string;
        motionEnabled: boolean;
        recordOnMotion: boolean;
        cooldownSeconds: number;
        quietHoursStartMinute: number | null;
        quietHoursEndMinute: number | null;
        quietHoursTimeZone: string | null;
      }>(
        `SELECT cs.id, cs.motion_enabled AS "motionEnabled",
                cs.motion_record_enabled AS "recordOnMotion",
                cs.motion_cooldown_seconds AS "cooldownSeconds",
                cs.motion_quiet_hours_start_minute AS "quietHoursStartMinute",
                cs.motion_quiet_hours_end_minute AS "quietHoursEndMinute",
                cs.motion_quiet_hours_time_zone AS "quietHoursTimeZone" FROM camera_sources cs
         JOIN device_credentials dc ON dc.camera_id = cs.device_id
         WHERE cs.device_id = $1 AND cs.public_camera_id = $2
           AND cs.enabled = true AND cs.removed_at IS NULL
           AND $3 IN (dc.credential_hash, dc.previous_credential_hash) AND dc.revoked_at IS NULL
         FOR UPDATE OF cs FOR SHARE OF dc`,
        [device.deviceId, input.publicCameraId, input.credentialHash],
      );
      const sourceId = source.rows[0]?.id;
      if (!sourceId) {
        await client.query('ROLLBACK');
        return null;
      }
      const sourceSettings = source.rows[0]!;
      if (!sourceSettings.motionEnabled) {
        await client.query('COMMIT');
        return {
          cameraSourceId: sourceId,
          created: false,
          householdId: device.householdId,
          motionEventId: null,
          ownerId: device.userId,
          recordOnMotion: false,
        };
      }
      if (
        sourceSettings.quietHoursStartMinute !== null &&
        isQuietHoursActive(
          {
            start: minuteToTimeOfDay(sourceSettings.quietHoursStartMinute),
            end: minuteToTimeOfDay(sourceSettings.quietHoursEndMinute!),
            timeZone: sourceSettings.quietHoursTimeZone!,
          },
          input.now,
        )
      ) {
        await client.query('COMMIT');
        return {
          cameraSourceId: sourceId,
          created: false,
          householdId: device.householdId,
          motionEventId: null,
          ownerId: device.userId,
          recordOnMotion: false,
        };
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO motion_events (camera_source_id, confidence, occurred_at)
         SELECT $1, $2::real, $3 WHERE NOT EXISTS (
           SELECT 1 FROM motion_events recent WHERE recent.camera_source_id = $1
             AND recent.occurred_at > $3::timestamptz - ($4::int * interval '1 second')
         ) RETURNING id`,
        [
          sourceId,
          input.confidence.toFixed(4),
          input.now,
          sourceSettings.cooldownSeconds,
        ],
      );
      const motionEventId = inserted.rows[0]?.id;
      if (motionEventId) {
        await this.notifications?.enqueueMotion(client, {
          deviceId: device.deviceId,
          motionEventId,
          now: input.now,
          sourceId,
        });
      }
      const created = (inserted.rowCount ?? 0) === 1;
      await client.query('COMMIT');
      return {
        cameraSourceId: sourceId,
        created,
        householdId: device.householdId,
        motionEventId: created ? motionEventId! : null,
        ownerId: device.userId,
        recordOnMotion: created && sourceSettings.recordOnMotion,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
