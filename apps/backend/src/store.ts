import { Pool, type PoolClient } from 'pg';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  householdId: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  email: string;
  householdId: string;
  tokenHash: string;
  csrfHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
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
  name: string;
  lastSeenAt: Date | null;
  credentialRevokedAt: Date | null;
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
}

export const DEVICE_REGISTRATION_RATE_LIMITED =
  'device_registration_rate_limited' as const;

export type PairingRedemptionResult =
  PairedDeviceRecord | null | typeof DEVICE_REGISTRATION_RATE_LIMITED;

export interface MilestoneStore {
  close(): Promise<void>;
  createAccount(
    email: string,
    passwordHash: string,
    ipAddress: string,
  ): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    csrfHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  revokeSession(id: string): Promise<void>;
  audit(input: AuditInput): Promise<void>;
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
    name: string,
  ): Promise<boolean>;
  updateCamera(
    householdId: string,
    publicCameraId: string,
    changes: {
      enabled?: boolean | undefined;
      name?: string | undefined;
    },
  ): Promise<boolean>;
  heartbeat(credentialHash: string, now: Date): Promise<string | null>;
  revokeDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null>;
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
}

export class PostgresStore implements MilestoneStore {
  readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async close(): Promise<void> {
    await this.pool.end();
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
      return { email, householdId, id: userId, passwordHash };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRecord>(
      `SELECT u.id, u.email, u.password_hash AS "passwordHash",
              h.id AS "householdId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    csrfHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO browser_sessions
       (user_id, token_hash, csrf_hash, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.userId,
        input.tokenHash,
        input.csrfHash,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
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
       RETURNING s.id, s.user_id AS "userId", u.email,
                 h.id AS "householdId", s.token_hash AS "tokenHash",
                 s.csrf_hash AS "csrfHash", s.idle_expires_at AS "idleExpiresAt",
                 s.absolute_expires_at AS "absoluteExpiresAt", s.revoked_at AS "revokedAt"`,
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

  async audit(input: AuditInput): Promise<void> {
    await this.insertAudit(this.pool, input);
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
              cs.facing, cs.enabled,
              COALESCE(cs.last_seen_at, d.last_seen_at) AS "lastSeenAt",
              COALESCE(dc.revoked_at, d.revoked_at) AS "credentialRevokedAt"
       FROM camera_sources cs
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE d.household_id = $1
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
              d.software_version AS "softwareVersion"
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
             updated_at = EXCLUDED.updated_at`,
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
                   software_version AS "softwareVersion"`,
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
             updated_at = EXCLUDED.updated_at`,
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

  async heartbeat(credentialHash: string, now: Date): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE cameras c SET last_seen_at = $2, updated_at = $2
       FROM device_credentials dc
       WHERE dc.camera_id = c.id AND dc.credential_hash = $1
         AND dc.revoked_at IS NULL AND c.revoked_at IS NULL
       RETURNING c.id`,
      [credentialHash, now],
    );
    return result.rows[0]?.id ?? null;
  }

  async updateDevice(
    householdId: string,
    publicDeviceId: string,
    name: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE cameras SET name = $3, updated_at = now()
       WHERE household_id = $1 AND public_device_id = $2
         AND revoked_at IS NULL`,
      [householdId, publicDeviceId, name],
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
         AND cs.public_camera_id = $2 AND d.revoked_at IS NULL`,
      [
        householdId,
        publicCameraId,
        changes.name ?? null,
        changes.enabled ?? null,
      ],
    );
    return (result.rowCount ?? 0) === 1;
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
         WHERE device_id = d.id AND enabled = true
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
         AND d.revoked_at IS NULL AND cs.enabled = true
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
         AND (d.platform = 'browser' OR dc.revoked_at IS NULL)`,
      [householdId, publicDeviceId],
    );
    return result.rows[0] ?? null;
  }

  private async insertAudit(
    executor: Pick<Pool | PoolClient, 'query'>,
    input: AuditInput,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO audit_events
       (user_id, household_id, camera_id, event_type, success, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.userId ?? null,
        input.householdId ?? null,
        input.cameraId ?? null,
        input.eventType,
        input.success,
        input.ipAddress ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}
