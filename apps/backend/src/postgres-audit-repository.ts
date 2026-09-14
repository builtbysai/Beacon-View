import type { Pool, PoolClient } from 'pg';
import type { AccessHistoryRecord, AuditInput } from './store-contract.js';

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

  async listAccessHistory(householdId: string): Promise<AccessHistoryRecord[]> {
    const result = await this.pool.query<AccessHistoryRecord>(
      `SELECT ae.id, u.email AS "actorEmail",
              COALESCE(d.name, ae.metadata ->> 'deviceName') AS "deviceName",
              ae.event_type AS "eventType", ae.occurred_at AS "occurredAt",
              ae.success, ae.viewer_session_id AS "viewerSessionId",
              ae.metadata
       FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.user_id
       LEFT JOIN cameras d ON d.id = ae.camera_id
       WHERE ae.household_id = $1
          AND ae.event_type IN (
            'camera_source_deleted', 'device_credential_revoked',
            'device_deleted', 'device_self_removed',
            'live_view_started', 'live_view_rejected',
            'privacy_disabled', 'privacy_enabled'
          )
       ORDER BY ae.occurred_at DESC
       LIMIT 50`,
      [householdId],
    );
    return result.rows;
  }
}
