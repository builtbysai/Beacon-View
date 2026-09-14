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

  async get(userId: string): Promise<GoogleDriveConnectionRecord | null> {
    const result = await this.pool.query<GoogleDriveConnectionRecord>(
      `SELECT provider_email AS "providerEmail", scopes,
              updated_at AS "updatedAt"
       FROM google_drive_connections WHERE user_id = $1`,
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
       FROM google_drive_connections WHERE user_id = $1`,
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

  async remove(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM google_drive_connections WHERE user_id = $1',
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
