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
      await client.query(
        `INSERT INTO household_members (household_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [householdId, userId],
      );
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
        emailVerifiedAt: null,
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
              u.avatar_url AS "avatarUrl", u.email_verified_at AS "emailVerifiedAt",
              h.id AS "householdId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findById(userId: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRecord>(
      `SELECT u.id, u.email, u.password_hash AS "passwordHash", u.google_subject AS "googleSubject",
              u.avatar_url AS "avatarUrl", u.email_verified_at AS "emailVerifiedAt",
              h.id AS "householdId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
      userId,
      passwordHash,
    ]);
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
      const user = await client.query<{ id: string; emailVerifiedAt: Date }>(
        `INSERT INTO users (email, google_subject, avatar_url, email_verified_at)
         VALUES ($1, $2, $3, now()) RETURNING id, email_verified_at AS "emailVerifiedAt"`,
        [email, googleSubject, avatarUrl],
      );
      const userId = user.rows[0]!.id;
      const household = await client.query<{ id: string }>(
        `INSERT INTO households (name, owner_id) VALUES ('My Household', $1) RETURNING id`,
        [userId],
      );
      const householdId = household.rows[0]!.id;
      await client.query(
        `INSERT INTO household_members (household_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [householdId, userId],
      );
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
        emailVerifiedAt: user.rows[0]!.emailVerifiedAt,
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
              u.avatar_url AS "avatarUrl", u.email_verified_at AS "emailVerifiedAt",
              h.id AS "householdId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.google_subject = $1`,
      [googleSubject],
    );
    return result.rows[0] ?? null;
  }

  async delete(userId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Invitations are historical management records, but their author FK is
      // intentionally restrictive. Remove invitations authored by the account
      // before cascading the user deletion so account removal cannot get stuck
      // after household sharing has been used.
      await client.query(
        'DELETE FROM household_invitations WHERE invited_by_user_id = $1',
        [userId],
      );
      const result = await client.query('DELETE FROM users WHERE id = $1', [
        userId,
      ]);
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
