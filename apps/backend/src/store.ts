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
  publicDeviceId: string;
  name: string;
  lastSeenAt: Date | null;
  credentialRevokedAt: Date | null;
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
  CameraRecord | null | typeof DEVICE_REGISTRATION_RATE_LIMITED;

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
  heartbeat(credentialHash: string, now: Date): Promise<string | null>;
  revokeDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null>;
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
      const camera = await client.query<CameraRecord>(
        `INSERT INTO cameras (household_id, installation_id, name)
         VALUES ($1, $2, $3)
         RETURNING id, public_device_id AS "publicDeviceId", name,
                   last_seen_at AS "lastSeenAt", NULL::timestamptz AS "credentialRevokedAt"`,
        [pairingCode.householdId, input.installationId, input.name],
      );
      const created = camera.rows[0]!;
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
      return created;
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
      `SELECT c.id, c.public_device_id AS "publicDeviceId", c.name,
              c.last_seen_at AS "lastSeenAt", dc.revoked_at AS "credentialRevokedAt"
       FROM cameras c
       JOIN device_credentials dc ON dc.camera_id = c.id
       WHERE c.household_id = $1 ORDER BY c.created_at`,
      [householdId],
    );
    return result.rows;
  }

  async heartbeat(credentialHash: string, now: Date): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE cameras c SET last_seen_at = $2, updated_at = $2
       FROM device_credentials dc
       WHERE dc.camera_id = c.id AND dc.credential_hash = $1
         AND dc.revoked_at IS NULL RETURNING c.id`,
      [credentialHash, now],
    );
    return result.rows[0]?.id ?? null;
  }

  async revokeDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ cameraId: string }>(
      `UPDATE device_credentials dc SET revoked_at = now()
       FROM cameras c
       WHERE dc.camera_id = c.id AND c.public_device_id = $1
         AND c.household_id = $2 AND dc.revoked_at IS NULL
       RETURNING c.id AS "cameraId"`,
      [publicDeviceId, householdId],
    );
    return result.rows[0]?.cameraId ?? null;
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
