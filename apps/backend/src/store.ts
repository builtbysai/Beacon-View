import { Pool, type PoolClient } from 'pg';
import {
  isQuietHoursActive,
  minuteToTimeOfDay,
  timeOfDayToMinute,
  type CameraMotionSettings,
  type MotionSettings,
} from './motion-settings.js';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  googleSubject: string | null;
  avatarUrl: string | null;
  householdId: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  email: string;
  avatarUrl: string | null;
  householdId: string;
  tokenHash: string;
  csrfHash: string;
  reauthenticatedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface BrowserSessionRecord {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  userAgent: string | null;
}

export interface CameraRecord {
  id: string;
  publicCameraId: string;
  deviceId: string;
  publicDeviceId: string;
  deviceName: string;
  platform: 'android' | 'browser';
  sourceKey: string;
  facing: 'front' | 'rear' | 'external' | 'unknown';
  enabled: boolean;
  privacyMode: boolean;
  name: string;
  lastSeenAt: Date | null;
  credentialRevokedAt: Date | null;
  capabilities: Record<string, boolean | number | string>;
}

export interface CameraIdentity {
  cameraId: string;
  deviceId: string;
  householdId: string;
  publicCameraId: string;
  publicDeviceId: string;
}

export interface DeviceRecord {
  id: string;
  publicDeviceId: string;
  name: string;
  platform: 'android' | 'browser';
  deviceType: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  softwareVersion: string | null;
  enabled: boolean;
  privacyMode: boolean;
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  healthReportedAt: Date | null;
  capabilities: Record<string, boolean | number | string>;
}

export interface CameraSourceInput {
  sourceKey: string;
  name: string;
  facing: 'front' | 'rear' | 'external' | 'unknown';
  capabilities?: Record<string, boolean | number | string> | undefined;
}

export interface PairedDeviceRecord {
  id: string;
  publicDeviceId: string;
  publicCameraId: string;
  name: string;
}

export interface AuditInput {
  eventType: string;
  success: boolean;
  ipAddress?: string;
  userId?: string;
  householdId?: string;
  cameraId?: string;
  metadata?: Record<string, string>;
  /** Client-generated id shared across one continuous live-view attempt
   * (including its own automatic reconnects), so access-history can group
   * related rows without guessing from timestamps. */
  viewerSessionId?: string;
}

export interface AccessHistoryRecord {
  id: string;
  actorEmail: string | null;
  deviceName: string | null;
  eventType: 'live_view_started' | 'live_view_rejected';
  occurredAt: Date;
  success: boolean;
  viewerSessionId: string | null;
  metadata: Record<string, string>;
}

export interface MotionEventRecord {
  id: string;
  publicCameraId: string;
  cameraName: string;
  deviceName: string;
  confidence: number;
  occurredAt: Date;
  cursorTimestamp: string;
}

export interface MotionEventOptions {
  cameraId?: string;
  since?: string;
  before?: { time: string; id: string };
  limit?: number;
}

export const MOTION_RETENTION_DAYS = [1, 7, 30, 90] as const;
export type MotionRetentionDays = (typeof MOTION_RETENTION_DAYS)[number];

export interface MotionRetentionRecord {
  days: MotionRetentionDays;
}

export interface RetentionPurgeRecord {
  householdId: string;
  deletedCount: number;
}

export const DEVICE_REGISTRATION_RATE_LIMITED =
  'device_registration_rate_limited' as const;

export type PairingRedemptionResult =
  PairedDeviceRecord | null | typeof DEVICE_REGISTRATION_RATE_LIMITED;

export interface MilestoneStore {
  isReady(): Promise<boolean>;
  listMotionSettings(
    householdId: string,
    publicDeviceId: string,
  ): Promise<CameraMotionSettings[]>;
  updateMotionSettings(
    householdId: string,
    publicCameraId: string,
    settings: MotionSettings,
  ): Promise<CameraMotionSettings | null>;
  close(): Promise<void>;
  createAccount(
    email: string,
    passwordHash: string,
    ipAddress: string,
  ): Promise<UserRecord>;
  createGoogleAccount(
    email: string,
    googleSubject: string,
    ipAddress: string,
    avatarUrl?: string | null,
  ): Promise<UserRecord>;
  updateGoogleAvatar(userId: string, avatarUrl: string): Promise<void>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserByGoogleSubject(googleSubject: string): Promise<UserRecord | null>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    csrfHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    reauthenticatedAt?: Date;
    userAgent?: string | null | undefined;
  }): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  revokeSession(id: string): Promise<void>;
  listBrowserSessions(userId: string): Promise<BrowserSessionRecord[]>;
  revokeBrowserSession(userId: string, sessionId: string): Promise<boolean>;
  deleteAccount(userId: string): Promise<boolean>;
  audit(input: AuditInput): Promise<void>;
  purgeExpiredAuditEvents(now: Date): Promise<number>;
  listAccessHistory(householdId: string): Promise<AccessHistoryRecord[]>;
  listMotionEvents(
    householdId: string,
    options?: MotionEventOptions,
  ): Promise<MotionEventRecord[]>;
  getMotionRetention(
    householdId: string,
  ): Promise<MotionRetentionRecord | null>;
  updateMotionRetention(
    householdId: string,
    days: MotionRetentionDays,
  ): Promise<MotionRetentionRecord | null>;
  purgeExpiredMotionEvents(now: Date): Promise<RetentionPurgeRecord[]>;
  clearMotionEvents(householdId: string): Promise<number>;
  createMotionEvent(input: {
    credentialHash: string;
    publicCameraId: string;
    confidence: number;
    now: Date;
  }): Promise<{ created: boolean; householdId: string } | null>;
  createPairingCode(
    householdId: string,
    codeHash: string,
    expiresAt: Date,
  ): Promise<string>;
  revokePairingCode(
    householdId: string,
    pairingCodeId: string,
  ): Promise<boolean>;
  redeemPairingCode(input: {
    codeHash: string;
    credentialHash: string;
    installationId: string;
    name: string;
    ipAddress: string;
    now: Date;
  }): Promise<PairingRedemptionResult>;
  listCameras(householdId: string): Promise<CameraRecord[]>;
  listDevices(householdId: string): Promise<DeviceRecord[]>;
  syncDeviceCameras(
    credentialHash: string,
    sources: CameraSourceInput[],
    now: Date,
  ): Promise<CameraRecord[] | null>;
  registerBrowserDevice(input: {
    householdId: string;
    installationId: string;
    name: string;
    sources: CameraSourceInput[];
    now: Date;
  }): Promise<{ device: DeviceRecord; cameras: CameraRecord[] }>;
  updateDevice(
    householdId: string,
    publicDeviceId: string,
    changes: { enabled?: boolean | undefined; name?: string | undefined },
  ): Promise<boolean>;
  setPrivacyMode(
    householdId: string,
    publicDeviceId: string,
    enabled: boolean,
  ): Promise<string | null>;
  updateCamera(
    householdId: string,
    publicCameraId: string,
    changes: {
      enabled?: boolean | undefined;
      name?: string | undefined;
    },
  ): Promise<boolean>;
  heartbeat(
    credentialHash: string,
    now: Date,
    health?: { batteryPercent: number; batteryCharging: boolean },
  ): Promise<string | null>;
  revokeDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null>;
  deleteDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null>;
  deleteCamera(householdId: string, publicCameraId: string): Promise<boolean>;
  findDeviceByCredential(
    credentialHash: string,
  ): Promise<CameraIdentity | null>;
  findCameraForDeviceCredential(
    credentialHash: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null>;
  findOwnedCamera(
    householdId: string,
    publicDeviceId: string,
  ): Promise<CameraIdentity | null>;
  findManagedCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null>;
}

export class PostgresStore implements MilestoneStore {
  readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async isReady(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  async createAccount(
    email: string,
    passwordHash: string,
    ipAddress: string,
  ): Promise<UserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2) RETURNING id`,
        [email, passwordHash],
      );
      const userId = user.rows[0]!.id;
      const household = await client.query<{ id: string }>(
        `INSERT INTO households (name, owner_id)
         VALUES ('My Household', $1) RETURNING id`,
        [userId],
      );
      const householdId = household.rows[0]!.id;
      await this.insertAudit(client, {
        eventType: 'account_created',
        householdId,
        ipAddress,
        success: true,
        userId,
      });
      await client.query('COMMIT');
      return {
        avatarUrl: null,
        email,
        googleSubject: null,
        householdId,
        id: userId,
        passwordHash,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRecord>(
      `SELECT u.id, u.email, u.password_hash AS "passwordHash", u.google_subject AS "googleSubject",
              u.avatar_url AS "avatarUrl", h.id AS "householdId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async createGoogleAccount(
    email: string,
    googleSubject: string,
    ipAddress: string,
    avatarUrl: string | null = null,
  ): Promise<UserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, google_subject, avatar_url) VALUES ($1, $2, $3) RETURNING id`,
        [email, googleSubject, avatarUrl],
      );
      const userId = user.rows[0]!.id;
      const household = await client.query<{ id: string }>(
        `INSERT INTO households (name, owner_id) VALUES ('My Household', $1) RETURNING id`,
        [userId],
      );
      const householdId = household.rows[0]!.id;
      await this.insertAudit(client, {
        eventType: 'google_account_created',
        householdId,
        ipAddress,
        success: true,
        userId,
      });
      await client.query('COMMIT');
      return {
        avatarUrl,
        email,
        googleSubject,
        householdId,
        id: userId,
        passwordHash: null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateGoogleAvatar(userId: string, avatarUrl: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET avatar_url = $2 WHERE id = $1 AND avatar_url IS DISTINCT FROM $2`,
      [userId, avatarUrl],
    );
  }

  async findUserByGoogleSubject(
    googleSubject: string,
  ): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRecord>(
      `SELECT u.id, u.email, u.password_hash AS "passwordHash", u.google_subject AS "googleSubject",
              u.avatar_url AS "avatarUrl", h.id AS "householdId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.google_subject = $1`,
      [googleSubject],
    );
    return result.rows[0] ?? null;
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    csrfHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    reauthenticatedAt?: Date;
    userAgent?: string | null | undefined;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO browser_sessions
       (user_id, token_hash, csrf_hash, idle_expires_at, absolute_expires_at,
        reauthenticated_at, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.userId,
        input.tokenHash,
        input.csrfHash,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.reauthenticatedAt ?? new Date(),
        input.userAgent ?? null,
      ],
    );
  }

  async findSession(
    tokenHash: string,
    now: Date,
  ): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRecord>(
      `UPDATE browser_sessions s
       SET last_seen_at = $2,
           idle_expires_at = LEAST($2 + interval '7 days', s.absolute_expires_at)
       FROM users u, households h
       WHERE s.token_hash = $1 AND s.user_id = u.id AND h.owner_id = u.id
         AND s.revoked_at IS NULL AND s.idle_expires_at > $2
         AND s.absolute_expires_at > $2
       RETURNING s.id, s.user_id AS "userId", u.email, u.avatar_url AS "avatarUrl",
                 h.id AS "householdId", s.token_hash AS "tokenHash",
                 s.csrf_hash AS "csrfHash", s.idle_expires_at AS "idleExpiresAt",
                 s.absolute_expires_at AS "absoluteExpiresAt",
                 s.reauthenticated_at AS "reauthenticatedAt", s.revoked_at AS "revokedAt"`,
      [tokenHash, now],
    );
    return result.rows[0] ?? null;
  }

  async revokeSession(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE browser_sessions SET revoked_at = now() WHERE id = $1',
      [id],
    );
  }

  async listBrowserSessions(userId: string): Promise<BrowserSessionRecord[]> {
    const result = await this.pool.query<BrowserSessionRecord>(
      `SELECT id, created_at AS "createdAt", last_seen_at AS "lastSeenAt",
              absolute_expires_at AS "absoluteExpiresAt",
              user_agent AS "userAgent"
       FROM browser_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND absolute_expires_at > now()
       ORDER BY last_seen_at DESC, id DESC`,
      [userId],
    );
    return result.rows;
  }

  async revokeBrowserSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE browser_sessions SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async deleteAccount(userId: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM users WHERE id = $1', [
      userId,
    ]);
    return (result.rowCount ?? 0) === 1;
  }

  async audit(input: AuditInput): Promise<void> {
    await this.insertAudit(this.pool, input);
  }

  async purgeExpiredAuditEvents(now: Date): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM audit_events
       WHERE occurred_at < $1::timestamptz - interval '90 days'`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  async listAccessHistory(householdId: string): Promise<AccessHistoryRecord[]> {
    const result = await this.pool.query<AccessHistoryRecord>(
      `SELECT ae.id, u.email AS "actorEmail", d.name AS "deviceName",
              ae.event_type AS "eventType", ae.occurred_at AS "occurredAt",
              ae.success, ae.viewer_session_id AS "viewerSessionId",
              ae.metadata
       FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.user_id
       LEFT JOIN cameras d ON d.id = ae.camera_id
       WHERE ae.household_id = $1
         AND ae.event_type IN ('live_view_started', 'live_view_rejected')
       ORDER BY ae.occurred_at DESC
       LIMIT 50`,
      [householdId],
    );
    return result.rows;
  }

  async listMotionEvents(
    householdId: string,
    options: MotionEventOptions = {},
  ): Promise<MotionEventRecord[]> {
    const result = await this.pool.query<MotionEventRecord>(
      `SELECT me.id, cs.public_camera_id AS "publicCameraId",
              cs.display_name AS "cameraName", d.name AS "deviceName",
              me.confidence::double precision AS confidence,
              me.occurred_at AS "occurredAt",
              to_char(me.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTimestamp"
       FROM motion_events me
       JOIN camera_sources cs ON cs.id = me.camera_source_id
       JOIN cameras d ON d.id = cs.device_id
       JOIN households h ON h.id = d.household_id
       WHERE d.household_id = $1
         AND me.occurred_at >= now() - (h.motion_retention_days * interval '1 day')
         AND ($2::uuid IS NULL OR cs.public_camera_id = $2)
         AND ($3::timestamptz IS NULL OR me.occurred_at >= $3)
         AND ($4::timestamptz IS NULL OR (me.occurred_at, me.id) < ($4, $5::uuid))
       ORDER BY me.occurred_at DESC, me.id DESC
       LIMIT $6`,
      [
        householdId,
        options.cameraId ?? null,
        options.since ?? null,
        options.before?.time ?? null,
        options.before?.id ?? null,
        options.limit ?? 100,
      ],
    );
    return result.rows;
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
      `UPDATE camera_sources cs SET motion_enabled = $3, motion_sensitivity = $4,
              motion_cooldown_seconds = $5, motion_quiet_hours_start_minute = $6,
              motion_quiet_hours_end_minute = $7, motion_quiet_hours_time_zone = $8, updated_at = now()
       FROM cameras d WHERE cs.device_id = d.id AND d.household_id = $1
         AND cs.public_camera_id = $2 AND d.platform = 'android'
         AND cs.removed_at IS NULL AND d.revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM device_credentials dc WHERE dc.camera_id = d.id AND dc.revoked_at IS NULL)
       RETURNING cs.public_camera_id AS "cameraId", cs.motion_enabled AS enabled,
                 cs.motion_sensitivity AS sensitivity, cs.motion_cooldown_seconds AS "cooldownSeconds",
                 CASE WHEN cs.motion_quiet_hours_start_minute IS NULL THEN NULL ELSE jsonb_build_object('start', lpad((cs.motion_quiet_hours_start_minute / 60)::text, 2, '0') || ':' || lpad((cs.motion_quiet_hours_start_minute % 60)::text, 2, '0'), 'end', lpad((cs.motion_quiet_hours_end_minute / 60)::text, 2, '0') || ':' || lpad((cs.motion_quiet_hours_end_minute % 60)::text, 2, '0'), 'timeZone', cs.motion_quiet_hours_time_zone) END AS "quietHours"`,
      [
        householdId,
        publicCameraId,
        settings.enabled,
        settings.sensitivity,
        settings.cooldownSeconds,
        settings.quietHours
          ? timeOfDayToMinute(settings.quietHours.start)
          : null,
        settings.quietHours ? timeOfDayToMinute(settings.quietHours.end) : null,
        settings.quietHours?.timeZone ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  async createMotionEvent(input: {
    credentialHash: string;
    publicCameraId: string;
    confidence: number;
    now: Date;
  }): Promise<{ created: boolean; householdId: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      // Lock the device before its credential/source, as registration does.
      // Waiting writers must check cooldown in a subsequent statement so they
      // see the event committed by the preceding writer, not its old snapshot.
      const identity = await client.query<{
        deviceId: string;
        householdId: string;
      }>(
        `SELECT d.id AS "deviceId", d.household_id AS "householdId"
         FROM cameras d JOIN device_credentials dc ON dc.camera_id = d.id
         WHERE dc.credential_hash = $1 AND dc.revoked_at IS NULL
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
        cooldownSeconds: number;
        quietHoursStartMinute: number | null;
        quietHoursEndMinute: number | null;
        quietHoursTimeZone: string | null;
      }>(
        `SELECT cs.id, cs.motion_enabled AS "motionEnabled",
                cs.motion_cooldown_seconds AS "cooldownSeconds",
                cs.motion_quiet_hours_start_minute AS "quietHoursStartMinute",
                cs.motion_quiet_hours_end_minute AS "quietHoursEndMinute",
                cs.motion_quiet_hours_time_zone AS "quietHoursTimeZone" FROM camera_sources cs
         JOIN device_credentials dc ON dc.camera_id = cs.device_id
         WHERE cs.device_id = $1 AND cs.public_camera_id = $2
           AND cs.enabled = true AND cs.removed_at IS NULL
           AND dc.credential_hash = $3 AND dc.revoked_at IS NULL
         FOR UPDATE OF cs FOR SHARE OF dc`,
        [device.deviceId, input.publicCameraId, input.credentialHash],
      );
      const sourceId = source.rows[0]?.id;
      if (!sourceId) {
        await client.query('ROLLBACK');
        return null;
      }
      if (!source.rows[0]!.motionEnabled) {
        await client.query('COMMIT');
        return { created: false, householdId: device.householdId };
      }
      const sourceSettings = source.rows[0]!;
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
        return { created: false, householdId: device.householdId };
      }
      const inserted = await client.query(
        `INSERT INTO motion_events (camera_source_id, confidence, occurred_at)
         SELECT $1, $2::real, $3 WHERE NOT EXISTS (
           SELECT 1 FROM motion_events recent WHERE recent.camera_source_id = $1
             AND recent.occurred_at > $3::timestamptz - ($4::int * interval '1 second')
         ) RETURNING id`,
        [
          sourceId,
          input.confidence.toFixed(4),
          input.now,
          source.rows[0]!.cooldownSeconds,
        ],
      );
      await client.query('COMMIT');
      return {
        created: (inserted.rowCount ?? 0) === 1,
        householdId: device.householdId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createPairingCode(
    householdId: string,
    codeHash: string,
    expiresAt: Date,
  ): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO pairing_codes (household_id, code_hash, expires_at)
       VALUES ($1, $2, $3) RETURNING id`,
      [householdId, codeHash, expiresAt],
    );
    return result.rows[0]!.id;
  }

  async revokePairingCode(
    householdId: string,
    pairingCodeId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE pairing_codes SET revoked_at = now()
       WHERE id = $1 AND household_id = $2 AND consumed_at IS NULL
         AND revoked_at IS NULL`,
      [pairingCodeId, householdId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async redeemPairingCode(input: {
    codeHash: string;
    credentialHash: string;
    installationId: string;
    name: string;
    ipAddress: string;
    now: Date;
  }): Promise<PairingRedemptionResult> {
    const client = await this.pool.connect();
    let pairingHouseholdId: string | undefined;
    try {
      await client.query('BEGIN');
      const code = await client.query<{ id: string; householdId: string }>(
        `SELECT id, household_id AS "householdId" FROM pairing_codes
         WHERE code_hash = $1 AND expires_at > $2 AND consumed_at IS NULL
           AND revoked_at IS NULL FOR UPDATE`,
        [input.codeHash, input.now],
      );
      const pairingCode = code.rows[0];
      if (!pairingCode) {
        await this.insertAudit(client, {
          eventType: 'pairing_failed',
          ipAddress: input.ipAddress,
          metadata: { reason: 'invalid_or_expired' },
          success: false,
        });
        await client.query('COMMIT');
        return null;
      }
      pairingHouseholdId = pairingCode.householdId;
      const registrations = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM cameras
         WHERE household_id = $1
           AND created_at > $2::timestamptz - interval '1 hour'`,
        [pairingCode.householdId, input.now],
      );
      if ((registrations.rows[0]?.count ?? 0) >= 10) {
        await this.insertAudit(client, {
          eventType: 'pairing_failed',
          householdId: pairingCode.householdId,
          ipAddress: input.ipAddress,
          metadata: { reason: 'rate_limited' },
          success: false,
        });
        await client.query('COMMIT');
        return DEVICE_REGISTRATION_RATE_LIMITED;
      }
      const device = await client.query<{
        id: string;
        publicDeviceId: string;
        name: string;
      }>(
        `INSERT INTO cameras (household_id, installation_id, name)
         VALUES ($1, $2, $3)
         RETURNING id, public_device_id AS "publicDeviceId", name`,
        [pairingCode.householdId, input.installationId, input.name],
      );
      const created = device.rows[0]!;
      const defaultCamera = await client.query<{ publicCameraId: string }>(
        `INSERT INTO camera_sources
           (device_id, display_name, source_key, facing)
         VALUES ($1, $2, 'legacy-default', 'rear')
         RETURNING public_camera_id AS "publicCameraId"`,
        [created.id, created.name],
      );
      await client.query(
        `INSERT INTO device_credentials (camera_id, credential_hash)
         VALUES ($1, $2)`,
        [created.id, input.credentialHash],
      );
      await client.query(
        `UPDATE pairing_codes SET consumed_at = $2, camera_id = $3 WHERE id = $1`,
        [pairingCode.id, input.now, created.id],
      );
      await this.insertAudit(client, {
        cameraId: created.id,
        eventType: 'pairing_succeeded',
        householdId: pairingCode.householdId,
        ipAddress: input.ipAddress,
        success: true,
      });
      await client.query('COMMIT');
      return {
        ...created,
        publicCameraId: defaultCamera.rows[0]!.publicCameraId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        await this.audit({
          eventType: 'pairing_failed',
          ...(pairingHouseholdId ? { householdId: pairingHouseholdId } : {}),
          ipAddress: input.ipAddress,
          metadata: { reason: 'registration_conflict' },
          success: false,
        });
        return null;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listCameras(householdId: string): Promise<CameraRecord[]> {
    const result = await this.pool.query<CameraRecord>(
      `SELECT cs.id, cs.device_id AS "deviceId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId",
              d.name AS "deviceName", d.platform,
              cs.display_name AS name, cs.source_key AS "sourceKey",
              cs.facing, cs.enabled, d.privacy_mode AS "privacyMode",
              cs.capabilities,
              COALESCE(cs.last_seen_at, d.last_seen_at) AS "lastSeenAt",
              COALESCE(dc.revoked_at, d.revoked_at) AS "credentialRevokedAt"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1 AND cs.removed_at IS NULL
       ORDER BY d.created_at, cs.created_at`,
      [householdId],
    );
    return result.rows;
  }

  async listDevices(householdId: string): Promise<DeviceRecord[]> {
    const result = await this.pool.query<DeviceRecord>(
      `SELECT d.id, d.public_device_id AS "publicDeviceId", d.name,
              d.platform, d.device_type AS "deviceType",
              d.last_seen_at AS "lastSeenAt",
              COALESCE(dc.revoked_at, d.revoked_at) AS "revokedAt",
              d.software_version AS "softwareVersion", d.enabled,
              d.privacy_mode AS "privacyMode", d.battery_percent AS "batteryPercent",
              d.battery_charging AS "batteryCharging", d.health_reported_at AS "healthReportedAt",
              d.capabilities
       FROM cameras d
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1
       ORDER BY d.created_at`,
      [householdId],
    );
    return result.rows;
  }

  async syncDeviceCameras(
    credentialHash: string,
    sources: CameraSourceInput[],
    now: Date,
  ): Promise<CameraRecord[] | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query<{ deviceId: string }>(
        `SELECT d.id AS "deviceId"
         FROM cameras d
         JOIN device_credentials dc ON dc.camera_id = d.id
         WHERE dc.credential_hash = $1 AND dc.revoked_at IS NULL
           AND d.revoked_at IS NULL
         FOR UPDATE`,
        [credentialHash],
      );
      const deviceId = identity.rows[0]?.deviceId;
      if (!deviceId) {
        await client.query('ROLLBACK');
        return null;
      }
      const rearSource = sources.find((source) => source.facing === 'rear');
      if (rearSource) {
        await client.query(
          `UPDATE camera_sources SET source_key = $2,
                  display_name = $3, updated_at = $4
           WHERE device_id = $1 AND source_key = 'legacy-default'
             AND NOT EXISTS (
               SELECT 1 FROM camera_sources
               WHERE device_id = $1 AND source_key = $2
             )`,
          [deviceId, rearSource.sourceKey, rearSource.name, now],
        );
      }
      for (const source of sources) {
        await client.query(
          `INSERT INTO camera_sources
             (device_id, display_name, source_key, facing, capabilities,
              last_seen_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (device_id, source_key) DO UPDATE SET
             facing = EXCLUDED.facing,
             capabilities = EXCLUDED.capabilities,
             last_seen_at = EXCLUDED.last_seen_at,
             updated_at = EXCLUDED.updated_at
           WHERE camera_sources.removed_at IS NULL`,
          [
            deviceId,
            source.name,
            source.sourceKey,
            source.facing,
            JSON.stringify(source.capabilities ?? {}),
            now,
          ],
        );
      }
      await client.query(
        `UPDATE cameras SET last_seen_at = $2, updated_at = $2 WHERE id = $1`,
        [deviceId, now],
      );
      await client.query('COMMIT');
      const household = await this.pool.query<{ householdId: string }>(
        `SELECT household_id AS "householdId" FROM cameras WHERE id = $1`,
        [deviceId],
      );
      return (await this.listCameras(household.rows[0]!.householdId)).filter(
        (camera) => camera.deviceId === deviceId,
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async registerBrowserDevice(input: {
    householdId: string;
    installationId: string;
    name: string;
    sources: CameraSourceInput[];
    now: Date;
  }): Promise<{ device: DeviceRecord; cameras: CameraRecord[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const device = await client.query<DeviceRecord>(
        `INSERT INTO cameras
           (household_id, installation_id, name, platform, device_type,
            last_seen_at, updated_at)
         VALUES ($1, $2, $3, 'browser', 'browser', $4, $4)
         ON CONFLICT (installation_id) DO UPDATE SET
           name = EXCLUDED.name, last_seen_at = EXCLUDED.last_seen_at,
           updated_at = EXCLUDED.updated_at
         WHERE cameras.household_id = EXCLUDED.household_id
           AND cameras.platform = 'browser'
         RETURNING id, public_device_id AS "publicDeviceId", name, platform,
                   device_type AS "deviceType", last_seen_at AS "lastSeenAt",
                   revoked_at AS "revokedAt",
                   software_version AS "softwareVersion", enabled,
                   capabilities`,
        [input.householdId, input.installationId, input.name, input.now],
      );
      const created = device.rows[0];
      if (!created) throw new Error('Browser device ownership conflict');
      for (const source of input.sources) {
        await client.query(
          `INSERT INTO camera_sources
             (device_id, display_name, source_key, facing, capabilities,
              last_seen_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (device_id, source_key) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             facing = EXCLUDED.facing,
             capabilities = EXCLUDED.capabilities,
             last_seen_at = EXCLUDED.last_seen_at,
             updated_at = EXCLUDED.updated_at
           WHERE camera_sources.removed_at IS NULL`,
          [
            created.id,
            source.name,
            source.sourceKey,
            source.facing,
            JSON.stringify(source.capabilities ?? {}),
            input.now,
          ],
        );
      }
      await client.query('COMMIT');
      return {
        device: created,
        cameras: (await this.listCameras(input.householdId)).filter(
          (camera) => camera.deviceId === created.id,
        ),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(
    credentialHash: string,
    now: Date,
    health?: { batteryPercent: number; batteryCharging: boolean },
  ): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE cameras c SET last_seen_at = $2, updated_at = $2,
         battery_percent = COALESCE($3::int, battery_percent), battery_charging = COALESCE($4::boolean, battery_charging),
         health_reported_at = CASE WHEN $3::int IS NULL THEN health_reported_at ELSE $2 END
       FROM device_credentials dc
       WHERE dc.camera_id = c.id AND dc.credential_hash = $1
         AND dc.revoked_at IS NULL AND c.revoked_at IS NULL
       RETURNING c.id`,
      [
        credentialHash,
        now,
        health?.batteryPercent ?? null,
        health?.batteryCharging ?? null,
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  async updateDevice(
    householdId: string,
    publicDeviceId: string,
    changes: { enabled?: boolean | undefined; name?: string | undefined },
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE cameras SET name = COALESCE($3, name),
         enabled = COALESCE($4, enabled), updated_at = now()
       WHERE household_id = $1 AND public_device_id = $2
         AND revoked_at IS NULL`,
      [
        householdId,
        publicDeviceId,
        changes.name ?? null,
        changes.enabled ?? null,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async updateCamera(
    householdId: string,
    publicCameraId: string,
    changes: {
      enabled?: boolean | undefined;
      name?: string | undefined;
    },
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE camera_sources cs SET
         display_name = COALESCE($3, cs.display_name),
         enabled = COALESCE($4, cs.enabled),
         updated_at = now()
       FROM cameras d
       WHERE cs.device_id = d.id AND d.household_id = $1
         AND cs.public_camera_id = $2 AND d.revoked_at IS NULL
         AND cs.removed_at IS NULL`,
      [
        householdId,
        publicCameraId,
        changes.name ?? null,
        changes.enabled ?? null,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async setPrivacyMode(
    householdId: string,
    publicDeviceId: string,
    enabled: boolean,
  ): Promise<string | null> {
    const result = await this.pool.query<{ deviceId: string }>(
      `UPDATE cameras SET privacy_mode = $3, updated_at = now()
       WHERE household_id = $1 AND public_device_id = $2
         AND platform = 'android' AND revoked_at IS NULL
       RETURNING id AS "deviceId"`,
      [householdId, publicDeviceId, enabled],
    );
    return result.rows[0]?.deviceId ?? null;
  }

  async revokeDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ cameraId: string }>(
      `WITH revoked_device AS (
         UPDATE cameras SET revoked_at = now(), updated_at = now()
         WHERE public_device_id = $1 AND household_id = $2
           AND revoked_at IS NULL
         RETURNING id
       ), revoked_credential AS (
         UPDATE device_credentials SET revoked_at = now()
         WHERE camera_id IN (SELECT id FROM revoked_device)
           AND revoked_at IS NULL
       )
       SELECT id AS "cameraId" FROM revoked_device`,
      [publicDeviceId, householdId],
    );
    return result.rows[0]?.cameraId ?? null;
  }

  async deleteDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ cameraId: string }>(
      `DELETE FROM cameras
       WHERE household_id = $1 AND public_device_id = $2
       RETURNING id AS "cameraId"`,
      [householdId, publicDeviceId],
    );
    return result.rows[0]?.cameraId ?? null;
  }

  async deleteCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE camera_sources cs SET removed_at = now(), enabled = false,
         updated_at = now()
       FROM cameras d
       WHERE cs.device_id = d.id AND d.household_id = $1
         AND cs.public_camera_id = $2 AND cs.removed_at IS NULL`,
      [householdId, publicCameraId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findDeviceByCredential(
    credentialHash: string,
  ): Promise<CameraIdentity | null> {
    const result = await this.pool.query<CameraIdentity>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId"
       FROM cameras d
       JOIN device_credentials dc ON dc.camera_id = d.id
       JOIN LATERAL (
         SELECT id, public_camera_id FROM camera_sources
         WHERE device_id = d.id
         ORDER BY created_at LIMIT 1
       ) cs ON true
       WHERE dc.credential_hash = $1 AND dc.revoked_at IS NULL
         AND d.revoked_at IS NULL`,
      [credentialHash],
    );
    return result.rows[0] ?? null;
  }

  async findCameraForDeviceCredential(
    credentialHash: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    const result = await this.pool.query<CameraIdentity>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE dc.credential_hash = $1 AND dc.revoked_at IS NULL
         AND d.revoked_at IS NULL AND cs.removed_at IS NULL
         AND cs.public_camera_id = $2`,
      [credentialHash, publicCameraId],
    );
    return result.rows[0] ?? null;
  }

  async findOwnedCamera(
    householdId: string,
    publicDeviceId: string,
  ): Promise<CameraIdentity | null> {
    const result = await this.pool.query<CameraIdentity>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1 AND cs.public_camera_id = $2
         AND cs.enabled = true AND d.revoked_at IS NULL
         AND d.enabled = true AND d.privacy_mode = false
         AND cs.removed_at IS NULL
         AND (d.platform = 'browser' OR dc.revoked_at IS NULL)`,
      [householdId, publicDeviceId],
    );
    return result.rows[0] ?? null;
  }

  async findManagedCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    const result = await this.pool.query<CameraIdentity>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1 AND cs.public_camera_id = $2
         AND d.revoked_at IS NULL AND cs.removed_at IS NULL
         AND (d.platform = 'browser' OR dc.revoked_at IS NULL)`,
      [householdId, publicCameraId],
    );
    return result.rows[0] ?? null;
  }

  private async insertAudit(
    executor: Pick<Pool | PoolClient, 'query'>,
    input: AuditInput,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO audit_events
       (user_id, household_id, camera_id, event_type, success, ip_address, metadata, viewer_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.userId ?? null,
        input.householdId ?? null,
        input.cameraId ?? null,
        input.eventType,
        input.success,
        input.ipAddress ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.viewerSessionId ?? null,
      ],
    );
  }
}
