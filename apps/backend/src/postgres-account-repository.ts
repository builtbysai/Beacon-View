import type { Pool } from 'pg';
import { PostgresAuditRepository } from './postgres-audit-repository.js';
import type { UserRecord } from './store-contract.js';

export class PostgresAccountRepository {
  constructor(
    private readonly pool: Pool,
    private readonly audit: PostgresAuditRepository,
  ) {}

  async createWithPassword(
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
      await this.audit.insert(client, {
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

  async findByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRecord>(
      `SELECT u.id, u.email, u.password_hash AS "passwordHash", u.google_subject AS "googleSubject",
              u.avatar_url AS "avatarUrl", h.id AS "householdId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async createWithGoogle(
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
      await this.audit.insert(client, {
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

  async findByGoogleSubject(googleSubject: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRecord>(
      `SELECT u.id, u.email, u.password_hash AS "passwordHash", u.google_subject AS "googleSubject",
              u.avatar_url AS "avatarUrl", h.id AS "householdId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.google_subject = $1`,
      [googleSubject],
    );
    return result.rows[0] ?? null;
  }

  async delete(userId: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM users WHERE id = $1', [
      userId,
    ]);
    return (result.rowCount ?? 0) === 1;
  }
}
