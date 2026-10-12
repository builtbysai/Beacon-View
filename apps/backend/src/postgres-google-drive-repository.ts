import type { Pool } from 'pg';

import { GoogleDriveTokenCipher } from './google-drive-crypto.js';

export interface GoogleDriveConnectionRecord {
  providerEmail: string | null;
  scopes: string;
  updatedAt: Date;
}

export class PostgresGoogleDriveRepository {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: GoogleDriveTokenCipher | null,
  ) {}

  get configured(): boolean {
    return this.cipher !== null;
  }

  /** The usable connection, or null. An expired connection is not usable. */
  async get(userId: string): Promise<GoogleDriveConnectionRecord | null> {
    const result = await this.pool.query<GoogleDriveConnectionRecord>(
      `SELECT provider_email AS "providerEmail", scopes,
              updated_at AS "updatedAt"
       FROM google_drive_connections
       WHERE user_id = $1 AND expired_at IS NULL`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async getRefreshToken(userId: string): Promise<string | null> {
    if (!this.cipher) return null;
    const result = await this.pool.query<{
      refreshTokenCiphertext: Buffer;
      refreshTokenIv: Buffer;
    }>(
      `SELECT refresh_token_ciphertext AS "refreshTokenCiphertext",
              refresh_token_iv AS "refreshTokenIv"
       FROM google_drive_connections
       WHERE user_id = $1 AND expired_at IS NULL`,
      [userId],
    );
    const row = result.rows[0];
    return row
      ? this.cipher.decrypt(row.refreshTokenCiphertext, row.refreshTokenIv)
      : null;
  }

  async upsert(input: {
    providerEmail: string | null;
    refreshToken: string;
    scopes: string;
    userId: string;
  }): Promise<void> {
    if (!this.cipher) throw new Error('Google Drive is not configured');
    const encrypted = this.cipher.encrypt(input.refreshToken);
    await this.pool.query(
      `INSERT INTO google_drive_connections
         (user_id, refresh_token_ciphertext, refresh_token_iv, provider_email, scopes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         refresh_token_iv = EXCLUDED.refresh_token_iv,
         provider_email = EXCLUDED.provider_email,
         scopes = EXCLUDED.scopes,
         expired_at = NULL,
         expiry_reminder_count = 0,
         expiry_reminded_at = NULL,
         updated_at = now()`,
      [
        input.userId,
        encrypted.ciphertext,
        encrypted.iv,
        input.providerEmail,
        input.scopes,
      ],
    );
  }

  /** Marks a connection Google no longer accepts. Returns true only the
   * first time, so the expiry is audited once. */
  async markExpired(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE google_drive_connections
       SET expired_at = now(), updated_at = now()
       WHERE user_id = $1 AND expired_at IS NULL`,
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Owners with a live connection, for the periodic check that finds a token Google stopped accepting. */
  async listLive(): Promise<Array<{ householdId: string; userId: string }>> {
    const result = await this.pool.query<{
      householdId: string;
      userId: string;
    }>(
      `SELECT c.user_id AS "userId", h.id AS "householdId"
       FROM google_drive_connections c
       JOIN households h ON h.owner_id = c.user_id
       WHERE c.expired_at IS NULL`,
    );
    return result.rows;
  }

  /** Expired connections whose owner is due another reminder. */
  async listReminderTargets(input: {
    gapMs: number;
    maxReminders: number;
    now: Date;
  }): Promise<Array<{ email: string; userId: string }>> {
    const result = await this.pool.query<{ email: string; userId: string }>(
      `SELECT c.user_id AS "userId", u.email
       FROM google_drive_connections c
       JOIN users u ON u.id = c.user_id
       WHERE c.expired_at IS NOT NULL AND c.expiry_reminder_count < $3
         AND (c.expiry_reminded_at IS NULL
              OR c.expiry_reminded_at <= $1::timestamptz - ($2 * interval '1 millisecond'))
       ORDER BY c.expired_at LIMIT 50`,
      [input.now, input.gapMs, input.maxReminders],
    );
    return result.rows;
  }

  async markReminderSent(userId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE google_drive_connections
       SET expiry_reminder_count = expiry_reminder_count + 1, expiry_reminded_at = $2
       WHERE user_id = $1 AND expired_at IS NOT NULL`,
      [userId, now],
    );
  }

  async isExpired(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM google_drive_connections
       WHERE user_id = $1 AND expired_at IS NOT NULL`,
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async remove(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM google_drive_connections WHERE user_id = $1',
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
