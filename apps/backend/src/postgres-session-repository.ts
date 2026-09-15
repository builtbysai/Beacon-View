import type { Pool } from 'pg';
import type {
  BrowserSessionRecord,
  HouseholdAccessRecord,
  SessionRecord,
} from './store-contract.js';
import type { PostgresNotificationRepository } from './postgres-notification-repository.js';

type CreateSessionInput = {
  userId: string;
  householdId?: string;
  tokenHash: string;
  csrfHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  reauthenticatedAt?: Date;
  userAgent?: string | null | undefined;
};

export class PostgresSessionRepository {
  constructor(
    private readonly pool: Pool,
    private readonly notifications?: PostgresNotificationRepository,
  ) {}

  async create(input: CreateSessionInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO browser_sessions
       (user_id, household_id, token_hash, csrf_hash, idle_expires_at, absolute_expires_at,
        reauthenticated_at, user_agent)
       VALUES ($1, COALESCE($2, (SELECT id FROM households WHERE owner_id = $1)), $3, $4, $5, $6, $7, $8)`,
      [
        input.userId,
        input.householdId ?? null,
        input.tokenHash,
        input.csrfHash,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.reauthenticatedAt ?? new Date(),
        input.userAgent ?? null,
      ],
    );
  }

  async findActive(
    tokenHash: string,
    now: Date,
  ): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRecord>(
      `UPDATE browser_sessions s
       SET last_seen_at = $2,
           idle_expires_at = LEAST($2 + interval '7 days', s.absolute_expires_at)
       FROM users u
       JOIN household_members m ON m.user_id = u.id
       JOIN households h ON h.id = m.household_id
       LEFT JOIN households owned ON owned.owner_id = u.id
       WHERE s.token_hash = $1 AND s.user_id = u.id
         AND m.household_id = s.household_id
         AND m.status = 'active'
         AND (m.expires_at IS NULL OR m.expires_at > $2)
         AND s.revoked_at IS NULL AND s.idle_expires_at > $2
         AND s.absolute_expires_at > $2
       RETURNING s.id, s.user_id AS "userId", u.email, u.avatar_url AS "avatarUrl",
                 h.id AS "householdId", owned.id AS "ownedHouseholdId",
                 m.role AS "role", s.token_hash AS "tokenHash",
                 s.csrf_hash AS "csrfHash", s.idle_expires_at AS "idleExpiresAt",
                 s.absolute_expires_at AS "absoluteExpiresAt",
                 s.reauthenticated_at AS "reauthenticatedAt", s.revoked_at AS "revokedAt"`,
      [tokenHash, now],
    );
    return result.rows[0] ?? null;
  }

  async refreshReauthentication(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE browser_sessions SET reauthenticated_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );
  }

  async revoke(id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE browser_sessions SET revoked_at = now() WHERE id = $1',
        [id],
      );
      await this.notifications?.revokeSession(client, id);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listActive(userId: string): Promise<BrowserSessionRecord[]> {
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

  async listHouseholds(
    userId: string,
    now: Date,
  ): Promise<HouseholdAccessRecord[]> {
    const result = await this.pool.query<HouseholdAccessRecord>(
      `SELECT h.id AS "householdId", h.name, m.role,
              m.expires_at AS "expiresAt"
       FROM household_members m
       JOIN households h ON h.id = m.household_id
       WHERE m.user_id = $1 AND m.status = 'active'
         AND (m.expires_at IS NULL OR m.expires_at > $2)
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                lower(h.name), h.id`,
      [userId, now],
    );
    return result.rows;
  }

  async switchHousehold(
    userId: string,
    sessionId: string,
    householdId: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE browser_sessions s SET household_id = $3, last_seen_at = $4
       WHERE s.id = $2 AND s.user_id = $1 AND s.revoked_at IS NULL
         AND s.idle_expires_at > $4 AND s.absolute_expires_at > $4
         AND EXISTS (
           SELECT 1 FROM household_members m
           WHERE m.user_id = $1 AND m.household_id = $3
             AND m.status = 'active'
             AND (m.expires_at IS NULL OR m.expires_at > $4)
         )`,
      [userId, sessionId, householdId, now],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async revokeAllOwned(userId: string): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `UPDATE browser_sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [userId],
      );
      for (const row of result.rows) {
        await this.notifications?.revokeSession(client, row.id);
      }
      await client.query('COMMIT');
      return result.rows.map((row) => row.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeOwned(userId: string, sessionId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE browser_sessions SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [sessionId, userId],
      );
      if ((result.rowCount ?? 0) === 1)
        await this.notifications?.revokeSession(client, sessionId);
      await client.query('COMMIT');
      return (result.rowCount ?? 0) === 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
