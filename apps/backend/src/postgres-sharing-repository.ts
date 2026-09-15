import type { Pool } from 'pg';

import type {
  HouseholdInvitationRecord,
  HouseholdMemberRecord,
  SessionRecord,
} from './store-contract.js';

type ShareRole = Exclude<SessionRecord['role'], 'owner'>;

export class PostgresSharingRepository {
  constructor(private readonly pool: Pool) {}

  async listMembers(householdId: string): Promise<HouseholdMemberRecord[]> {
    const members = await this.pool.query<
      Omit<HouseholdMemberRecord, 'grants'>
    >(
      `SELECT m.id, m.user_id AS "userId", u.email, m.role, m.status,
              m.expires_at AS "expiresAt"
       FROM household_members m JOIN users u ON u.id = m.user_id
       WHERE m.household_id = $1
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                lower(u.email), m.id`,
      [householdId],
    );
    const grants = await this.pool.query<{
      memberId: string;
      cameraId: string;
      cameraName: string;
      canListen: boolean;
      canTalk: boolean;
    }>(
      `SELECT cg.member_id AS "memberId", cs.public_camera_id AS "cameraId",
              cs.display_name AS "cameraName", cg.can_listen AS "canListen",
              cg.can_talk AS "canTalk"
       FROM camera_grants cg
       JOIN camera_sources cs ON cs.id = cg.camera_source_id
       WHERE cg.household_id = $1 ORDER BY cs.created_at, cs.id`,
      [householdId],
    );
    return members.rows.map((member) => ({
      ...member,
      grants: grants.rows
        .filter((grant) => grant.memberId === member.id)
        .map((grant) => ({
          cameraId: grant.cameraId,
          cameraName: grant.cameraName,
          canListen: grant.canListen,
          canTalk: grant.canTalk,
        })),
    }));
  }

  async listInvitations(
    householdId: string,
    now: Date,
  ): Promise<HouseholdInvitationRecord[]> {
    const result = await this.pool.query<HouseholdInvitationRecord>(
      `SELECT id, invited_email AS "invitedEmail", role, expires_at AS "expiresAt",
              created_at AS "createdAt"
       FROM household_invitations
       WHERE household_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
         AND expires_at > $2 ORDER BY created_at DESC, id DESC`,
      [householdId, now],
    );
    return result.rows;
  }

  async createInvitation(input: {
    householdId: string;
    invitedEmail: string;
    role: ShareRole;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE household_invitations SET revoked_at = now(), updated_at = now()
         WHERE household_id = $1 AND invited_email = $2
           AND accepted_at IS NULL AND revoked_at IS NULL`,
        [input.householdId, input.invitedEmail],
      );
      const result = await client.query<{ id: string }>(
        `INSERT INTO household_invitations
         (household_id, invited_email, role, token_hash, invited_by_user_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          input.householdId,
          input.invitedEmail,
          input.role,
          input.tokenHash,
          input.invitedByUserId,
          input.expiresAt,
        ],
      );
      await client.query('COMMIT');
      return result.rows[0]!.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptInvitation(input: {
    tokenHash: string;
    userId: string;
    email: string;
    now: Date;
  }): Promise<{ householdId: string; role: ShareRole } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const invitation = await client.query<{
        id: string;
        householdId: string;
        role: ShareRole;
        expiresAt: Date;
      }>(
        `SELECT id, household_id AS "householdId", role, expires_at AS "expiresAt"
         FROM household_invitations
         WHERE token_hash = $1 AND invited_email = $2 AND accepted_at IS NULL
           AND revoked_at IS NULL AND expires_at > $3 FOR UPDATE`,
        [input.tokenHash, input.email, input.now],
      );
      const pending = invitation.rows[0];
      if (!pending) {
        await client.query('ROLLBACK');
        return null;
      }
      const membership = await client.query(
        `INSERT INTO household_members
         (household_id, user_id, role, status, expires_at, revoked_at, joined_at, updated_at)
         VALUES ($1,$2,$3,'active',$4,NULL,$5,$5)
         ON CONFLICT (household_id, user_id) DO UPDATE SET
           role = excluded.role, status = 'active', expires_at = excluded.expires_at,
           revoked_at = NULL, updated_at = excluded.updated_at
         WHERE household_members.role <> 'owner' RETURNING id`,
        [
          pending.householdId,
          input.userId,
          pending.role,
          pending.role === 'guest' ? pending.expiresAt : null,
          input.now,
        ],
      );
      if (!membership.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      // A viewer is meant to see the whole household by default -- camera
      // access is something an admin *restricts* for them afterward, not
      // something granted one-by-one before it does anything. Guests stay
      // opt-in per camera: their access is meant to be narrow and deliberate.
      if (pending.role === 'viewer') {
        await client.query(
          `INSERT INTO camera_grants
           (household_id, member_id, camera_source_id, can_listen, can_talk)
           SELECT $1, $2, cs.id, false, false FROM camera_sources cs
           JOIN cameras d ON d.id = cs.device_id
           WHERE d.household_id = $1 AND cs.enabled = true
             AND cs.removed_at IS NULL AND d.revoked_at IS NULL
           ON CONFLICT (member_id, camera_source_id) DO NOTHING`,
          [pending.householdId, membership.rows[0]!.id],
        );
      }
      await client.query(
        'UPDATE household_invitations SET accepted_at=$2, updated_at=$2 WHERE id=$1',
        [pending.id, input.now],
      );
      await client.query('COMMIT');
      return { householdId: pending.householdId, role: pending.role };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeInvitation(
    householdId: string,
    invitationId: string,
  ): Promise<ShareRole | null> {
    const result = await this.pool.query<{ role: ShareRole }>(
      `UPDATE household_invitations SET revoked_at=now(), updated_at=now()
       WHERE id=$2 AND household_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING role`,
      [householdId, invitationId],
    );
    return result.rows[0]?.role ?? null;
  }

  async replaceGrants(input: {
    householdId: string;
    memberId: string;
    grants: Array<{ cameraId: string; canListen: boolean; canTalk: boolean }>;
  }): Promise<string[] | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const member = await client.query(
        `SELECT 1 FROM household_members WHERE id=$2 AND household_id=$1
         AND status='active' AND role IN ('viewer','guest') FOR UPDATE`,
        [input.householdId, input.memberId],
      );
      if (!member.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('DELETE FROM camera_grants WHERE member_id=$1', [
        input.memberId,
      ]);
      for (const grant of input.grants) {
        const inserted = await client.query(
          `INSERT INTO camera_grants
           (household_id, member_id, camera_source_id, can_listen, can_talk)
           SELECT $1,$2,cs.id,$4,$5 FROM camera_sources cs
           JOIN cameras d ON d.id=cs.device_id
           WHERE cs.public_camera_id=$3 AND d.household_id=$1
             AND cs.enabled=true AND d.revoked_at IS NULL`,
          [
            input.householdId,
            input.memberId,
            grant.cameraId,
            grant.canListen,
            grant.canTalk,
          ],
        );
        if ((inserted.rowCount ?? 0) !== 1) {
          await client.query('ROLLBACK');
          return null;
        }
      }
      const sessions = await client.query<{ id: string }>(
        `SELECT s.id FROM browser_sessions s JOIN household_members m ON m.user_id=s.user_id
         WHERE m.id=$1 AND s.household_id=$2 AND s.revoked_at IS NULL`,
        [input.memberId, input.householdId],
      );
      await client.query('COMMIT');
      return sessions.rows.map((session) => session.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeMember(
    householdId: string,
    memberId: string,
  ): Promise<string[] | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const member = await client.query<{ userId: string }>(
        `UPDATE household_members SET status='revoked', revoked_at=now(), updated_at=now()
         WHERE id=$2 AND household_id=$1 AND role <> 'owner' AND status='active'
         RETURNING user_id AS "userId"`,
        [householdId, memberId],
      );
      if (!member.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const sessions = await client.query<{ id: string }>(
        `UPDATE browser_sessions SET revoked_at=now()
         WHERE user_id=$1 AND household_id=$2 AND revoked_at IS NULL RETURNING id`,
        [member.rows[0].userId, householdId],
      );
      if (sessions.rows.length > 0) {
        await client.query(
          `UPDATE notification_subscriptions SET revoked_at=now(), updated_at=now()
           WHERE session_id = ANY($1::uuid[]) AND revoked_at IS NULL`,
          [sessions.rows.map((session) => session.id)],
        );
      }
      await client.query('COMMIT');
      return sessions.rows.map((session) => session.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
