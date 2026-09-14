import type { Pool } from 'pg';
import type { BrowserSessionRecord, SessionRecord } from './store-contract.js';

type CreateSessionInput = {
  userId: string;
  tokenHash: string;
  csrfHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  reauthenticatedAt?: Date;
  userAgent?: string | null | undefined;
};

export class PostgresSessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateSessionInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO browser_sessions
       (user_id, token_hash, csrf_hash, idle_expires_at, absolute_expires_at,
        reauthenticated_at, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.userId,
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
       FROM users u, households h
       WHERE s.token_hash = $1 AND s.user_id = u.id AND h.owner_id = u.id
         AND s.revoked_at IS NULL AND s.idle_expires_at > $2
         AND s.absolute_expires_at > $2
       RETURNING s.id, s.user_id AS "userId", u.email, u.avatar_url AS "avatarUrl",
                 h.id AS "householdId", s.token_hash AS "tokenHash",
                 s.csrf_hash AS "csrfHash", s.idle_expires_at AS "idleExpiresAt",
                 s.absolute_expires_at AS "absoluteExpiresAt",
                 s.reauthenticated_at AS "reauthenticatedAt", s.revoked_at AS "revokedAt"`,
      [tokenHash, now],
    );
    return result.rows[0] ?? null;
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE browser_sessions SET revoked_at = now() WHERE id = $1',
      [id],
    );
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

  async revokeOwned(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE browser_sessions SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
    return (result.rowCount ?? 0) === 1;
  }
}
