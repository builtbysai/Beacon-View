import type { Pool } from 'pg';

export class PostgresAccountRecoveryRepository {
  constructor(private readonly pool: Pool) {}

  async createEmailVerificationToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [input.userId, input.tokenHash, input.expiresAt],
    );
  }

  async consumeEmailVerificationToken(
    tokenHash: string,
    now: Date,
  ): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ userId: string }>(
        `UPDATE email_verification_tokens SET consumed_at = $2
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
         RETURNING user_id AS "userId"`,
        [tokenHash, now],
      );
      const userId = result.rows[0]?.userId ?? null;
      if (userId) {
        await client.query(
          `UPDATE users SET email_verified_at = $2
           WHERE id = $1 AND email_verified_at IS NULL`,
          [userId, now],
        );
      }
      await client.query('COMMIT');
      return userId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [input.userId, input.tokenHash, input.expiresAt],
    );
  }

  async consumePasswordResetToken(
    tokenHash: string,
    now: Date,
  ): Promise<string | null> {
    const result = await this.pool.query<{ userId: string }>(
      `UPDATE password_reset_tokens SET consumed_at = $2
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
       RETURNING user_id AS "userId"`,
      [tokenHash, now],
    );
    const userId = result.rows[0]?.userId ?? null;
    // Other reset links sent earlier must not outlive the one just used (V46).
    if (userId)
      await this.pool.query(
        `UPDATE password_reset_tokens SET consumed_at = $2
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [userId, now],
      );
    return userId;
  }
}
