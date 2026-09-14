import type { Pool } from 'pg';
import { PostgresAuditRepository } from './postgres-audit-repository.js';
import {
  DEVICE_REGISTRATION_RATE_LIMITED,
  type PairingRedemptionResult,
} from './store-contract.js';

type PairingRedemptionInput = {
  codeHash: string;
  credentialHash: string;
  installationId: string;
  ipAddress: string;
  name: string;
  now: Date;
};

export class PostgresPairingRepository {
  constructor(
    private readonly pool: Pool,
    private readonly audit: PostgresAuditRepository,
  ) {}

  async createCode(
    householdId: string,
    codeHash: string,
    expiresAt: Date,
    targetDeviceId?: string,
  ): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO pairing_codes (household_id, code_hash, expires_at, camera_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [householdId, codeHash, expiresAt, targetDeviceId ?? null],
    );
    return result.rows[0]!.id;
  }

  async revokeCode(
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

  async redeem(
    input: PairingRedemptionInput,
  ): Promise<PairingRedemptionResult> {
    const client = await this.pool.connect();
    let pairingHouseholdId: string | undefined;
    try {
      await client.query('BEGIN');
      const code = await client.query<{
        id: string;
        householdId: string;
        targetDeviceId: string | null;
      }>(
        `SELECT id, household_id AS "householdId", camera_id AS "targetDeviceId"
         FROM pairing_codes
         WHERE code_hash = $1 AND expires_at > $2 AND consumed_at IS NULL
           AND revoked_at IS NULL FOR UPDATE`,
        [input.codeHash, input.now],
      );
      const pairingCode = code.rows[0];
      if (!pairingCode) {
        await this.audit.insert(client, {
          eventType: 'pairing_failed',
          ipAddress: input.ipAddress,
          metadata: { reason: 'invalid_or_expired' },
          success: false,
        });
        await client.query('COMMIT');
        return null;
      }
      pairingHouseholdId = pairingCode.householdId;
      if (pairingCode.targetDeviceId) {
        const device = await client.query<{
          id: string;
          publicDeviceId: string;
          name: string;
        }>(
          `UPDATE cameras SET revoked_at = NULL, enabled = true, updated_at = now()
           WHERE id = $1 AND household_id = $2 AND installation_id = $3
           RETURNING id, public_device_id AS "publicDeviceId", name`,
          [
            pairingCode.targetDeviceId,
            pairingCode.householdId,
            input.installationId,
          ],
        );
        const reconnected = device.rows[0];
        if (!reconnected) {
          await this.audit.insert(client, {
            eventType: 'pairing_failed',
            householdId: pairingCode.householdId,
            ipAddress: input.ipAddress,
            metadata: { reason: 'reconnect_device_mismatch' },
            success: false,
          });
          await client.query('COMMIT');
          return null;
        }
        await client.query(
          'DELETE FROM device_credentials WHERE camera_id = $1',
          [reconnected.id],
        );
        await client.query(
          `INSERT INTO device_credentials (camera_id, credential_hash)
           VALUES ($1, $2)`,
          [reconnected.id, input.credentialHash],
        );
        const camera = await client.query<{ publicCameraId: string }>(
          `SELECT public_camera_id AS "publicCameraId" FROM camera_sources
           WHERE device_id = $1
           ORDER BY created_at LIMIT 1`,
          [reconnected.id],
        );
        await client.query(
          `UPDATE pairing_codes SET consumed_at = $2 WHERE id = $1`,
          [pairingCode.id, input.now],
        );
        await this.audit.insert(client, {
          cameraId: reconnected.id,
          eventType: 'device_reconnected',
          householdId: pairingCode.householdId,
          ipAddress: input.ipAddress,
          success: true,
        });
        await client.query('COMMIT');
        return {
          ...reconnected,
          publicCameraId: camera.rows[0]!.publicCameraId,
        };
      }
      const registrations = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM cameras
         WHERE household_id = $1
           AND created_at > $2::timestamptz - interval '1 hour'`,
        [pairingCode.householdId, input.now],
      );
      if ((registrations.rows[0]?.count ?? 0) >= 10) {
        await this.audit.insert(client, {
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
      await this.audit.insert(client, {
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
        await this.audit.audit({
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
}
