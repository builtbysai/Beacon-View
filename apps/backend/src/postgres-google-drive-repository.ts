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
