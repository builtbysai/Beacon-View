import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { NotificationCipher } from './notification-crypto.js';
import {
  isQuietHoursActive,
  minuteToTimeOfDay,
  timeOfDayToMinute,
} from './motion-settings.js';
import type {
  NotificationCategory,
  NotificationDelivery,
  NotificationPreferenceRecord,
  NotificationSubscriptionInput,
  SecurityEventType,
} from './notification-types.js';
import {
  CAMERA_ONLINE_WINDOW_MS,
  offlineCandidateSince,
  offlineGraceElapsed,
} from './notification-presence.js';

/** A camera this low on battery, and not charging, needs attention. */
export const LOW_BATTERY_PERCENT = 15;
/** It counts as recovered once it is charging or back above this. */
export const LOW_BATTERY_CLEARED_PERCENT = 25;
/** From "severe" up, Android is already throttling or about to shut down. */
export const HOT_THERMAL_STATUSES: ReadonlySet<string> = new Set([
  'severe',
  'critical',
  'emergency',
  'shutdown',
]);

/**
 * One health condition across scans: raised once when it starts, held until
 * it clears. `since` is the stored marker (null when clear).
 */
export function nextHealthState(
  since: Date | null,
  active: boolean,
  cleared: boolean,
  now: Date,
): { changed: boolean; raised: boolean; since: Date | null } {
  if (active && !since) return { changed: true, raised: true, since: now };
  if (cleared && since) return { changed: true, raised: false, since: null };
  return { changed: false, raised: false, since };
}

export class PostgresNotificationRepository {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: NotificationCipher | null,
  ) {}

  get configured(): boolean {
    return this.cipher !== null;
  }

  async upsertSubscription(
    input: NotificationSubscriptionInput,
  ): Promise<string> {
    if (!this.cipher)
      throw new Error('Notification transport is not configured');
    const encrypted = this.cipher.encrypt(input.providerMaterial);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${input.userId}:${input.installationId}:${input.channel}`],
      );
      await client.query(
        `UPDATE notification_subscriptions SET revoked_at = now(), updated_at = now()
         WHERE revoked_at IS NULL AND (provider_fingerprint = $1 OR
           (user_id = $2 AND installation_id = $3 AND channel = $4))`,
        [
          encrypted.providerFingerprint,
          input.userId,
          input.installationId,
          input.channel,
        ],
      );
      const result = await client.query<{ id: string }>(
        `INSERT INTO notification_subscriptions
         (user_id, session_id, installation_id, channel, provider_ciphertext, provider_iv,
          wrapped_key, wrapped_key_iv, provider_fingerprint, key_version, device_label,
          consented_at, last_registered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
        [
          input.userId,
          input.sessionId,
          input.installationId,
          input.channel,
          encrypted.providerCiphertext,
          encrypted.providerIv,
          encrypted.wrappedKey,
          encrypted.wrappedKeyIv,
          encrypted.providerFingerprint,
          encrypted.keyVersion,
          input.deviceLabel,
          input.consentedAt,
        ],
      );
      await client.query('COMMIT');
      return result.rows[0]!.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSubscription(
    userId: string,
    sessionId: string,
    id: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE notification_subscriptions SET revoked_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND session_id = $3 AND revoked_at IS NULL`,
      [id, userId, sessionId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async revokeSession(
    client: Pool | PoolClient,
    sessionId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE notification_subscriptions SET revoked_at = now(), updated_at = now()
       WHERE session_id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
  }

  /** What an alert the user was sent is about, so opening it can go to the
   * right camera. Scoped to the user, so an event ID guessed or shared
   * reveals nothing (ADR 0090). */
  async findEventForUser(
    userId: string,
    eventId: string,
  ): Promise<{ category: string; publicCameraId: string | null } | null> {
    const result = await this.pool.query<{
      category: string;
      publicCameraId: string | null;
    }>(
      `SELECT ne.category, cs.public_camera_id AS "publicCameraId"
       FROM notification_events ne
       LEFT JOIN camera_sources cs ON cs.id = ne.camera_source_id
       WHERE ne.id = $1 AND ne.user_id = $2`,
      [eventId, userId],
    );
    return result.rows[0] ?? null;
  }

  async listPreferences(
    userId: string,
    householdId: string,
  ): Promise<NotificationPreferenceRecord[]> {
    const result = await this.pool.query<{
      deviceId: string;
      deviceName: string;
      motionEnabled: boolean;
      offlineEnabled: boolean;
      quietStartMinute: number | null;
      quietEndMinute: number | null;
      quietTimeZone: string | null;
    }>(
      `SELECT d.public_device_id AS "deviceId", d.name AS "deviceName",
              coalesce(np.motion_enabled, false) AS "motionEnabled",
              coalesce(np.offline_enabled, false) AS "offlineEnabled",
              np.quiet_start_minute AS "quietStartMinute",
              np.quiet_end_minute AS "quietEndMinute", np.quiet_time_zone AS "quietTimeZone"
       FROM cameras d
       LEFT JOIN notification_preferences np ON np.user_id = $1 AND np.device_id = d.id
       WHERE d.household_id = $2 AND d.revoked_at IS NULL
       ORDER BY d.created_at, d.id`,
      [userId, householdId],
    );
    return result.rows.map((row) => ({
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      motionEnabled: row.motionEnabled,
      offlineEnabled: row.offlineEnabled,
      quietHours:
        row.quietStartMinute === null
          ? null
          : {
              start: minuteToTimeOfDay(row.quietStartMinute),
              end: minuteToTimeOfDay(row.quietEndMinute!),
              timeZone: row.quietTimeZone!,
            },
    }));
  }

  async updatePreference(input: {
    userId: string;
    householdId: string;
    publicDeviceId: string;
    motionEnabled: boolean;
    offlineEnabled: boolean;
    quietHours: { start: string; end: string; timeZone: string } | null;
  }): Promise<NotificationPreferenceRecord | null> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO notification_preferences
       (user_id, device_id, motion_enabled, offline_enabled, quiet_start_minute, quiet_end_minute, quiet_time_zone)
       SELECT $1, d.id, $4, $5, $6, $7, $8 FROM cameras d
       WHERE d.public_device_id = $3 AND d.household_id = $2 AND d.revoked_at IS NULL
       ON CONFLICT (user_id, device_id) DO UPDATE SET motion_enabled = excluded.motion_enabled,
         offline_enabled = excluded.offline_enabled, quiet_start_minute = excluded.quiet_start_minute,
         quiet_end_minute = excluded.quiet_end_minute, quiet_time_zone = excluded.quiet_time_zone,
         updated_at = now() RETURNING device_id AS id`,
      [
        input.userId,
        input.householdId,
        input.publicDeviceId,
        input.motionEnabled,
        input.offlineEnabled,
        input.quietHours ? timeOfDayToMinute(input.quietHours.start) : null,
        input.quietHours ? timeOfDayToMinute(input.quietHours.end) : null,
        input.quietHours?.timeZone ?? null,
      ],
    );
    if (!result.rows[0]) return null;
    if (!input.offlineEnabled) {
      await this.pool.query(
        'DELETE FROM notification_presence_state WHERE device_id = $1 AND user_id = $2',
        [result.rows[0].id, input.userId],
      );
    }
    return (
      (await this.listPreferences(input.userId, input.householdId)).find(
        (item) => item.deviceId === input.publicDeviceId,
      ) ?? null
    );
  }

  async enqueueMotion(
    client: PoolClient,
    input: {
      motionEventId: string;
      sourceId: string;
      deviceId: string;
      now: Date;
    },
  ): Promise<void> {
    const preference = await client.query<{
      userId: string;
      motionEnabled: boolean;
      quietStartMinute: number | null;
      quietEndMinute: number | null;
      quietTimeZone: string | null;
    }>(
      `SELECT np.user_id AS "userId", np.motion_enabled AS "motionEnabled", np.quiet_start_minute AS "quietStartMinute",
              quiet_end_minute AS "quietEndMinute", quiet_time_zone AS "quietTimeZone"
       FROM notification_preferences np
       JOIN cameras d ON d.id = np.device_id
       JOIN household_members hm ON hm.household_id = d.household_id AND hm.user_id = np.user_id
       WHERE np.device_id = $1 AND d.revoked_at IS NULL AND hm.status = 'active'
         AND hm.role IN ('owner', 'admin') AND (hm.expires_at IS NULL OR hm.expires_at > $2)`,
      [input.deviceId, input.now],
    );
    for (const setting of preference.rows) {
      if (!setting.motionEnabled) continue;
      if (
        setting.quietStartMinute !== null &&
        isQuietHoursActive(
          {
            start: minuteToTimeOfDay(setting.quietStartMinute),
            end: minuteToTimeOfDay(setting.quietEndMinute!),
            timeZone: setting.quietTimeZone!,
          },
          input.now,
        )
      )
        continue;
      await this.#enqueueEvent(client, {
        category: 'motion',
        deduplicationKey: `motion:${input.motionEventId}`,
        deviceId: input.deviceId,
        sourceId: input.sourceId,
        userId: setting.userId,
        now: input.now,
      });
    }
  }

  /**
   * Health alerts (ADR 0093): a camera that is low on battery or overheating
   * raises one alert per episode, for owners and admins who have the camera's
   * "offline and needs attention" alerts on. Hysteresis keeps a battery that
   * hovers around the limit from alerting repeatedly, and quiet hours silence
   * the alert without making it fire later.
   */
  async scanHealth(now: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(1111846222) AS acquired`,
      );
      if (!locked.rows[0]?.acquired) {
        await client.query('ROLLBACK');
        return;
      }
      const devices = await client.query<{
        id: string;
        userId: string;
        batteryPercent: number | null;
        batteryCharging: boolean | null;
        thermalStatus: string | null;
        lowBatterySince: Date | null;
        overheatingSince: Date | null;
        quietStartMinute: number | null;
        quietEndMinute: number | null;
        quietTimeZone: string | null;
      }>(
        `SELECT d.id, np.user_id AS "userId", d.battery_percent AS "batteryPercent",
                d.battery_charging AS "batteryCharging", d.thermal_status AS "thermalStatus",
                nps.low_battery_since AS "lowBatterySince", nps.overheating_since AS "overheatingSince",
                np.quiet_start_minute AS "quietStartMinute", np.quiet_end_minute AS "quietEndMinute",
                np.quiet_time_zone AS "quietTimeZone"
         FROM cameras d
         JOIN notification_preferences np ON np.device_id = d.id
         JOIN household_members hm ON hm.household_id = d.household_id AND hm.user_id = np.user_id
         LEFT JOIN notification_presence_state nps ON nps.device_id = d.id AND nps.user_id = np.user_id
         WHERE np.offline_enabled = true AND d.enabled = true AND d.revoked_at IS NULL
           AND d.health_reported_at IS NOT NULL
           AND d.health_reported_at > $1::timestamptz - interval '10 minutes'
           AND hm.status = 'active' AND hm.role IN ('owner', 'admin')
           AND (hm.expires_at IS NULL OR hm.expires_at > $1)
           AND EXISTS (SELECT 1 FROM device_credentials dc WHERE dc.camera_id = d.id AND dc.revoked_at IS NULL)
         FOR UPDATE OF d`,
        [now],
      );
      for (const device of devices.rows) {
        const lowBattery = nextHealthState(
          device.lowBatterySince,
          device.batteryPercent !== null &&
            device.batteryCharging === false &&
            device.batteryPercent <= LOW_BATTERY_PERCENT,
          device.batteryCharging === true ||
            (device.batteryPercent !== null &&
              device.batteryPercent >= LOW_BATTERY_CLEARED_PERCENT),
          now,
        );
        const overheating = nextHealthState(
          device.overheatingSince,
          device.thermalStatus !== null &&
            HOT_THERMAL_STATUSES.has(device.thermalStatus),
          device.thermalStatus !== null &&
            !HOT_THERMAL_STATUSES.has(device.thermalStatus),
          now,
        );
        if (lowBattery.changed || overheating.changed) {
          const quiet = this.#isQuiet(device, now);
          for (const [state, kind] of [
            [lowBattery, 'battery'],
            [overheating, 'heat'],
          ] as const) {
            if (state.raised && !quiet)
              await this.#enqueueEvent(client, {
                category: 'health',
                deduplicationKey: `${kind}:${device.id}:${now.toISOString()}`,
                deviceId: device.id,
                userId: device.userId,
                now,
              });
          }
          await client.query(
            `INSERT INTO notification_presence_state
             (user_id, device_id, low_battery_since, overheating_since, updated_at)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (user_id, device_id) DO UPDATE SET
               low_battery_since = $3, overheating_since = $4, updated_at = $5`,
            [
              device.userId,
              device.id,
              lowBattery.since,
              overheating.since,
              now,
            ],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async scanPresence(now: Date, graceSeconds: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(1111846221) AS acquired`,
      );
      if (!locked.rows[0]?.acquired) {
        await client.query('ROLLBACK');
        return;
      }
      const devices = await client.query<{
        id: string;
        userId: string;
        lastSeenAt: Date;
        candidateSince: Date | null;
        offlineSince: Date | null;
        offlineEventId: string | null;
        quietStartMinute: number | null;
        quietEndMinute: number | null;
        quietTimeZone: string | null;
      }>(
        `SELECT d.id, np.user_id AS "userId", d.last_seen_at AS "lastSeenAt",
                nps.candidate_since AS "candidateSince", nps.offline_since AS "offlineSince",
                nps.offline_event_id AS "offlineEventId", np.quiet_start_minute AS "quietStartMinute",
                np.quiet_end_minute AS "quietEndMinute", np.quiet_time_zone AS "quietTimeZone"
         FROM cameras d
         JOIN notification_preferences np ON np.device_id = d.id
         JOIN household_members hm ON hm.household_id = d.household_id AND hm.user_id = np.user_id
         LEFT JOIN notification_presence_state nps ON nps.device_id = d.id AND nps.user_id = np.user_id
         WHERE np.offline_enabled = true AND d.last_seen_at IS NOT NULL AND d.enabled = true
           AND d.privacy_mode = false AND d.revoked_at IS NULL
           AND hm.status = 'active' AND hm.role IN ('owner', 'admin')
           AND (hm.expires_at IS NULL OR hm.expires_at > $1)
           AND EXISTS (SELECT 1 FROM device_credentials dc WHERE dc.camera_id = d.id AND dc.revoked_at IS NULL)
         FOR UPDATE OF d`,
        [now],
      );
      for (const device of devices.rows) {
        const boundary = device.lastSeenAt.getTime() + CAMERA_ONLINE_WINDOW_MS;
        if (now.getTime() <= boundary) {
          if (device.offlineSince) {
            const quiet = this.#isQuiet(device, now);
            const eventId =
              device.offlineEventId && !quiet
                ? await this.#enqueueEvent(client, {
                    category: 'recovered',
                    deduplicationKey: `recovered:${device.id}:${device.offlineSince.toISOString()}`,
                    deviceId: device.id,
                    userId: device.userId,
                    now,
                  })
                : null;
            await client.query(
              `INSERT INTO notification_presence_state (user_id, device_id, offline_event_id, updated_at)
               VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, device_id) DO UPDATE SET candidate_since = NULL,
               offline_since = NULL, offline_event_id = $3, updated_at = $4`,
              [device.userId, device.id, eventId, now],
            );
          } else {
            await client.query(
              `INSERT INTO notification_presence_state (user_id, device_id, updated_at) VALUES ($1,$2,$3)
               ON CONFLICT (user_id, device_id) DO UPDATE SET candidate_since = NULL, updated_at = $3`,
              [device.userId, device.id, now],
            );
          }
          continue;
        }
        const candidateSince =
          device.candidateSince ?? offlineCandidateSince(device.lastSeenAt);
        if (
          !device.offlineSince &&
          offlineGraceElapsed(candidateSince, now, graceSeconds)
        ) {
          const eventId = this.#isQuiet(device, now)
            ? null
            : await this.#enqueueEvent(client, {
                category: 'offline',
                deduplicationKey: `offline:${device.id}:${candidateSince.toISOString()}`,
                deviceId: device.id,
                userId: device.userId,
                now,
              });
          await client.query(
            `INSERT INTO notification_presence_state
             (user_id, device_id, candidate_since, offline_event_id, offline_since, updated_at) VALUES ($1,$2,$3,$4,$5,$5)
             ON CONFLICT (user_id, device_id) DO UPDATE SET candidate_since=$3, offline_event_id=$4, offline_since=$5, updated_at=$5`,
            [device.userId, device.id, candidateSince, eventId, now],
          );
        } else if (!device.candidateSince) {
          await client.query(
            `INSERT INTO notification_presence_state (user_id, device_id, candidate_since, updated_at) VALUES ($1,$2,$3,$4)
             ON CONFLICT (user_id, device_id) DO UPDATE SET candidate_since=$3, updated_at=$4`,
            [device.userId, device.id, candidateSince, now],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  #isQuiet(
    setting: {
      quietStartMinute: number | null;
      quietEndMinute: number | null;
      quietTimeZone: string | null;
    },
    now: Date,
  ): boolean {
    return (
      setting.quietStartMinute !== null &&
      isQuietHoursActive(
        {
          start: minuteToTimeOfDay(setting.quietStartMinute),
          end: minuteToTimeOfDay(setting.quietEndMinute!),
          timeZone: setting.quietTimeZone!,
        },
        now,
      )
    );
  }

  async claimDeliveries(
    now: Date,
    limit = 20,
  ): Promise<NotificationDelivery[]> {
    if (!this.cipher) return [];
    const result = await this.pool.query<{
      id: string;
      subscriptionId: string;
      channel: 'fcm' | 'web_push';
      providerCiphertext: Buffer;
      providerIv: Buffer;
      wrappedKey: Buffer;
      wrappedKeyIv: Buffer;
      keyVersion: number;
      safePayload: Record<string, string>;
      attemptCount: number;
    }>(
      `WITH candidates AS (
         SELECT no.id FROM notification_outbox no JOIN notification_subscriptions ns ON ns.id = no.subscription_id
         JOIN notification_events ne ON ne.id = no.event_id
         JOIN browser_sessions bs ON bs.id = ns.session_id
         WHERE no.delivered_at IS NULL AND no.terminal_at IS NULL AND no.next_attempt_at <= $1
           AND (no.claimed_until IS NULL OR no.claimed_until < $1) AND ns.revoked_at IS NULL
           AND bs.revoked_at IS NULL AND bs.idle_expires_at > $1 AND bs.absolute_expires_at > $1
           AND (ne.category = 'security' OR EXISTS (
             SELECT 1 FROM cameras d
             JOIN household_members hm ON hm.household_id = d.household_id AND hm.user_id = ne.user_id
             WHERE d.id = ne.device_id AND d.revoked_at IS NULL AND hm.status = 'active'
               AND hm.role IN ('owner', 'admin')
               AND (hm.expires_at IS NULL OR hm.expires_at > $1)
           ))
         ORDER BY no.next_attempt_at, no.id FOR UPDATE OF no SKIP LOCKED LIMIT $2
       ) UPDATE notification_outbox no SET claimed_until = $1::timestamptz + interval '1 minute'
       FROM candidates c, notification_subscriptions ns WHERE no.id = c.id AND ns.id = no.subscription_id
       RETURNING no.id, no.subscription_id AS "subscriptionId", ns.channel,
         ns.provider_ciphertext AS "providerCiphertext", ns.provider_iv AS "providerIv",
         ns.wrapped_key AS "wrappedKey", ns.wrapped_key_iv AS "wrappedKeyIv", ns.key_version AS "keyVersion",
         no.safe_payload AS "safePayload", no.attempt_count AS "attemptCount"`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      subscriptionId: row.subscriptionId,
      channel: row.channel,
      providerMaterial: this.cipher!.decrypt(row),
      safePayload: row.safePayload,
      attemptCount: row.attemptCount,
    }));
  }

  async markDelivered(
    id: string,
    subscriptionId: string,
    now: Date,
  ): Promise<void> {
    await this.pool.query(
      `WITH delivered AS (UPDATE notification_outbox SET delivered_at=$2, claimed_until=NULL WHERE id=$1 RETURNING subscription_id)
       UPDATE notification_subscriptions SET last_success_at=$2, updated_at=$2
       WHERE id=$3 AND EXISTS (SELECT 1 FROM delivered)`,
      [id, now, subscriptionId],
    );
  }

  /** Ends a delivery whose alert went stale while its device was offline.
   * Unlike a permanent failure, the subscription itself stays active. */
  async markExpired(id: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE notification_outbox SET attempt_count=attempt_count+1,
         claimed_until=NULL, terminal_at=$2
       WHERE id=$1 AND delivered_at IS NULL AND terminal_at IS NULL`,
      [id, now],
    );
  }

  async markFailed(
    id: string,
    subscriptionId: string,
    now: Date,
    permanent: boolean,
    retryAfterMs?: number,
  ): Promise<void> {
    const providerRetryAt = retryAfterMs
      ? new Date(now.getTime() + retryAfterMs)
      : null;
    await this.pool.query(
      `WITH failed AS (
         UPDATE notification_outbox SET attempt_count=attempt_count+1, claimed_until=NULL,
           terminal_at=CASE WHEN $3 OR attempt_count+1 >= 5 THEN $2::timestamptz ELSE NULL::timestamptz END,
           next_attempt_at=GREATEST(CASE attempt_count+1 WHEN 1 THEN $2::timestamptz+interval '1 minute'
             WHEN 2 THEN $2::timestamptz+interval '5 minutes' WHEN 3 THEN $2::timestamptz+interval '30 minutes'
             WHEN 4 THEN $2::timestamptz+interval '2 hours' ELSE $2::timestamptz+interval '8 hours' END,
             COALESCE($4::timestamptz, $2::timestamptz))
         WHERE id=$1 RETURNING subscription_id
       )
       UPDATE notification_subscriptions SET revoked_at=$2, updated_at=$2
       WHERE id=$5 AND $3::boolean AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM failed WHERE subscription_id=$5)`,
      [id, now, permanent, providerRetryAt, subscriptionId],
    );
  }

  /** Security events have no per-device preference row to join against, so
   * unlike motion/offline/recovered there is nothing in Beacon for a user to
   * mute them with -- they always reach every active subscription. */
  async recordSecurityEvent(input: {
    userId: string;
    securityEventType: SecurityEventType;
    now: Date;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const eventId = randomUUID();
      const safePayload = {
        version: '1',
        eventId,
        category: 'security' as const,
        route: 'settings',
      };
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO notification_events
         (id, user_id, category, deduplication_key, safe_payload, occurred_at)
         VALUES ($1, $2, 'security', $3, $4, $5)
         RETURNING id`,
        [
          eventId,
          input.userId,
          `security:${input.securityEventType}:${eventId}`,
          JSON.stringify(safePayload),
          input.now,
        ],
      );
      const persistedId = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO notification_outbox (event_id, subscription_id, safe_payload)
         SELECT $1, ns.id, $2 FROM notification_subscriptions ns
         JOIN browser_sessions bs ON bs.id = ns.session_id
         WHERE ns.user_id=$3 AND ns.revoked_at IS NULL AND bs.revoked_at IS NULL
           AND bs.idle_expires_at > $4 AND bs.absolute_expires_at > $4 ON CONFLICT DO NOTHING`,
        [persistedId, JSON.stringify(safePayload), input.userId, input.now],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #enqueueEvent(
    client: PoolClient,
    input: {
      category: NotificationCategory;
      deduplicationKey: string;
      deviceId: string;
      sourceId?: string;
      userId: string;
      now: Date;
    },
  ): Promise<string | null> {
    const eligible = await client.query(
      `SELECT 1 FROM notification_subscriptions ns
       JOIN browser_sessions bs ON bs.id = ns.session_id
       WHERE ns.user_id=$1 AND ns.revoked_at IS NULL AND bs.revoked_at IS NULL
         AND bs.idle_expires_at > $2 AND bs.absolute_expires_at > $2 LIMIT 1`,
      [input.userId, input.now],
    );
    if (!eligible.rows[0]) return null;
    const eventId = randomUUID();
    const safePayload = {
      version: '1',
      eventId,
      category: input.category,
      route: 'activity',
    };
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO notification_events
       (id,user_id,device_id,camera_source_id,category,deduplication_key,safe_payload,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, deduplication_key) DO NOTHING RETURNING id`,
      [
        eventId,
        input.userId,
        input.deviceId,
        input.sourceId ?? null,
        input.category,
        input.deduplicationKey,
        JSON.stringify(safePayload),
        input.now,
      ],
    );
    const persistedId = inserted.rows[0]?.id;
    if (!persistedId) {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM notification_events WHERE user_id=$1 AND deduplication_key=$2',
        [input.userId, input.deduplicationKey],
      );
      return existing.rows[0]!.id;
    }
    await client.query(
      `INSERT INTO notification_outbox (event_id, subscription_id, safe_payload)
       SELECT $1, ns.id, $2 FROM notification_subscriptions ns
       JOIN browser_sessions bs ON bs.id = ns.session_id
       WHERE ns.user_id=$3 AND ns.revoked_at IS NULL AND bs.revoked_at IS NULL
         AND bs.idle_expires_at > $4 AND bs.absolute_expires_at > $4 ON CONFLICT DO NOTHING`,
      [persistedId, JSON.stringify(safePayload), input.userId, input.now],
    );
    return persistedId;
  }
}
