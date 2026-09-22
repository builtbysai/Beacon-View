import type { Pool, PoolClient } from 'pg';
import { HOUSEHOLD_ACTIVITY_EVENT_TYPES } from './store-contract.js';
import type {
  AccessHistoryOptions,
  AccessHistoryPage,
  AuditInput,
  HouseholdActivityOptions,
  HouseholdActivityPage,
} from './store-contract.js';

const ACCESS_HISTORY_EVENT_TYPES = [
  'camera_source_deleted',
  'device_credential_revoked',
  'device_deleted',
  'device_self_removed',
  'live_view_started',
  'live_view_rejected',
  'privacy_disabled',
  'privacy_enabled',
] as const;

const ACCESS_HISTORY_MAX_LIMIT = 50;
const ACCESS_HISTORY_DEFAULT_LIMIT = 20;

type QueryExecutor = Pick<Pool | PoolClient, 'query'>;

export class PostgresAuditRepository {
  constructor(private readonly pool: Pool) {}

  async insert(executor: QueryExecutor, input: AuditInput): Promise<void> {
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

  async audit(input: AuditInput): Promise<void> {
    await this.insert(this.pool, input);
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM audit_events
       WHERE occurred_at < $1::timestamptz - interval '90 days'`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  private async withPresenceLock<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('beacon-device-presence'))",
      );
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async scanDevicePresenceActivity(
    now: Date,
    offlineAfterMs: number,
  ): Promise<number> {
    return this.withPresenceLock(async (client) => {
      const result = await client.query(
        `INSERT INTO audit_events
       (household_id, camera_id, event_type, success, metadata, occurred_at)
       SELECT d.household_id, d.id, 'device_offline', true,
              jsonb_build_object('deviceId', d.public_device_id::text, 'deviceName', d.name),
              $1
       FROM cameras d
       WHERE d.enabled = true AND d.privacy_mode = false AND d.revoked_at IS NULL
         AND d.last_seen_at IS NOT NULL
         AND d.last_seen_at < $1::timestamptz - ($2::bigint * interval '1 millisecond')
         AND EXISTS (
           SELECT 1 FROM device_credentials dc
           WHERE dc.camera_id = d.id AND dc.revoked_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM audit_events ae
           WHERE ae.camera_id = d.id AND ae.event_type = 'device_offline'
             AND ae.occurred_at > d.last_seen_at
         )`,
        [now, offlineAfterMs],
      );
      return result.rowCount ?? 0;
    });
  }

  async recordDeviceRecoveredIfOffline(input: {
    cameraId: string;
    householdId: string;
    publicDeviceId: string;
    now: Date;
  }): Promise<boolean> {
    return this.withPresenceLock(async (client) => {
      const result = await client.query(
        `INSERT INTO audit_events
       (household_id, camera_id, event_type, success, metadata, occurred_at)
       SELECT $1, $2, 'device_recovered', true,
              jsonb_build_object('deviceId', $3::text), $4
       WHERE EXISTS (
         SELECT 1 FROM audit_events offline
         WHERE offline.camera_id = $2 AND offline.event_type = 'device_offline'
           AND NOT EXISTS (
             SELECT 1 FROM audit_events recovered
             WHERE recovered.camera_id = $2
               AND recovered.event_type = 'device_recovered'
               AND recovered.occurred_at > offline.occurred_at
           )
       )`,
        [input.householdId, input.cameraId, input.publicDeviceId, input.now],
      );
      return (result.rowCount ?? 0) === 1;
    });
  }

  async listHouseholdActivity(
    householdId: string,
    options: HouseholdActivityOptions = {},
  ): Promise<HouseholdActivityPage> {
    const limit = Math.min(Math.max(1, options.limit ?? 20), 50);
    const offset = Math.max(0, options.offset ?? 0);
    const requestedTypes = options.eventTypes?.length
      ? options.eventTypes
      : HOUSEHOLD_ACTIVITY_EVENT_TYPES;
    const [rows, count] = await Promise.all([
      this.pool.query<HouseholdActivityPage['events'][number]>(
        `SELECT ae.id, u.email AS "actorEmail",
                COALESCE(d.name, ae.metadata ->> 'deviceName') AS "deviceName",
                ae.event_type AS "eventType", ae.occurred_at AS "occurredAt",
                ae.success, ae.metadata
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.user_id
         LEFT JOIN cameras d ON d.id = ae.camera_id
         WHERE ae.household_id = $1
           AND ae.event_type = ANY($2::text[])
         ORDER BY ae.occurred_at DESC, ae.id DESC
         LIMIT $3 OFFSET $4`,
        [householdId, requestedTypes, limit, offset],
      ),
      this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM audit_events ae
         WHERE ae.household_id = $1
           AND ae.event_type = ANY($2::text[])`,
        [householdId, requestedTypes],
      ),
    ]);
    return { events: rows.rows, total: Number(count.rows[0]!.count) };
  }

  async listAccessHistory(
    householdId: string,
    options: AccessHistoryOptions = {},
  ): Promise<AccessHistoryPage> {
    const limit = Math.min(
      Math.max(1, options.limit ?? ACCESS_HISTORY_DEFAULT_LIMIT),
      ACCESS_HISTORY_MAX_LIMIT,
    );
    const offset = Math.max(0, options.offset ?? 0);
    const [rows, count] = await Promise.all([
      this.pool.query<AccessHistoryPage['events'][number]>(
        `SELECT ae.id, u.email AS "actorEmail",
                COALESCE(d.name, ae.metadata ->> 'deviceName') AS "deviceName",
                ae.event_type AS "eventType", ae.occurred_at AS "occurredAt",
                ae.success, ae.viewer_session_id AS "viewerSessionId",
                ae.metadata
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.user_id
         LEFT JOIN cameras d ON d.id = ae.camera_id
         WHERE ae.household_id = $1
            AND ae.event_type = ANY($2::text[])
         ORDER BY ae.occurred_at DESC
         LIMIT $3 OFFSET $4`,
        [householdId, ACCESS_HISTORY_EVENT_TYPES, limit, offset],
      ),
      this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM audit_events ae
         WHERE ae.household_id = $1
            AND ae.event_type = ANY($2::text[])`,
        [householdId, ACCESS_HISTORY_EVENT_TYPES],
      ),
    ]);
    return { events: rows.rows, total: Number(count.rows[0]!.count) };
  }
}
