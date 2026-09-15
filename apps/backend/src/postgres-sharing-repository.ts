import type { Pool } from 'pg';

import type {
  AccessibleCameraRecord,
  CameraAccess,
  CameraRecord,
  GuestLinkRecord,
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
      canFlip: boolean;
      canPause: boolean;
    }>(
      `SELECT cg.member_id AS "memberId", cs.public_camera_id AS "cameraId",
              cs.display_name AS "cameraName", cg.can_listen AS "canListen",
              cg.can_talk AS "canTalk", cg.can_flip AS "canFlip",
              cg.can_pause AS "canPause"
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
          canFlip: grant.canFlip,
          canPause: grant.canPause,
        })),
    }));
  }

  async listInvitations(
    householdId: string,
    now: Date,
  ): Promise<HouseholdInvitationRecord[]> {
    const result = await this.pool.query<HouseholdInvitationRecord>(
      `SELECT id, invited_email AS "invitedEmail", role, expires_at AS "expiresAt",
              created_at AS "createdAt", default_can_listen AS "defaultCanListen",
              default_can_talk AS "defaultCanTalk", default_can_flip AS "defaultCanFlip",
              default_can_pause AS "defaultCanPause"
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
    defaultCanListen?: boolean;
    defaultCanTalk?: boolean;
    defaultCanFlip?: boolean;
    defaultCanPause?: boolean;
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
         (household_id, invited_email, role, token_hash, invited_by_user_id, expires_at,
          default_can_listen, default_can_talk, default_can_flip, default_can_pause)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          input.householdId,
          input.invitedEmail,
          input.role,
          input.tokenHash,
          input.invitedByUserId,
          input.expiresAt,
          input.defaultCanListen ?? false,
          input.defaultCanTalk ?? false,
          input.defaultCanFlip ?? false,
          input.defaultCanPause ?? false,
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
        defaultCanListen: boolean;
        defaultCanTalk: boolean;
        defaultCanFlip: boolean;
        defaultCanPause: boolean;
      }>(
        `SELECT id, household_id AS "householdId", role, expires_at AS "expiresAt",
                default_can_listen AS "defaultCanListen", default_can_talk AS "defaultCanTalk",
                default_can_flip AS "defaultCanFlip", default_can_pause AS "defaultCanPause"
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
      const membership = await client.query<{ id: string }>(
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
      // something granted one-by-one before it does anything. Which
      // controls come with that default view is whatever the inviter chose
      // when creating the invitation. Guests stay opt-in per camera: their
      // access is meant to be narrow and deliberate.
      if (pending.role === 'viewer') {
        await client.query(
          `INSERT INTO camera_grants
           (household_id, member_id, camera_source_id, can_listen, can_talk, can_flip, can_pause)
           SELECT $1, $2, cs.id, $3, $4, $5, $6 FROM camera_sources cs
           JOIN cameras d ON d.id = cs.device_id
           WHERE d.household_id = $1 AND cs.enabled = true
             AND cs.removed_at IS NULL AND d.revoked_at IS NULL
           ON CONFLICT (member_id, camera_source_id) DO NOTHING`,
          [
            pending.householdId,
            membership.rows[0].id,
            pending.defaultCanListen,
            pending.defaultCanTalk,
            pending.defaultCanFlip,
            pending.defaultCanPause,
          ],
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
    grants: Array<{
      cameraId: string;
      canListen: boolean;
      canTalk: boolean;
      canFlip: boolean;
      canPause: boolean;
    }>;
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
           (household_id, member_id, camera_source_id, can_listen, can_talk, can_flip, can_pause)
           SELECT $1,$2,cs.id,$4,$5,$6,$7 FROM camera_sources cs
           JOIN cameras d ON d.id=cs.device_id
           WHERE cs.public_camera_id=$3 AND d.household_id=$1
             AND cs.enabled=true AND d.revoked_at IS NULL`,
          [
            input.householdId,
            input.memberId,
            grant.cameraId,
            grant.canListen,
            grant.canTalk,
            grant.canFlip,
            grant.canPause,
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

  // Purges an already-revoked member from the list entirely (their grants
  // cascade-delete with the row). Requires status='revoked' as a safety
  // gate -- this is a deliberate second step after revokeMember, not a way
  // to skip straight from active to gone, since there's no undo for it.
  async permanentlyRemoveMember(
    householdId: string,
    memberId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM household_members
       WHERE id=$2 AND household_id=$1 AND role <> 'owner' AND status='revoked'`,
      [householdId, memberId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // A viewer/guest dropping their own access to one camera someone else
  // shared with them -- unlike revokeMember, the household membership
  // itself is untouched, so only that one grant goes away, not their whole
  // access to the household or its other cameras.
  async leaveCamera(
    householdId: string,
    userId: string,
    publicCameraId: string,
  ): Promise<string[] | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const deleted = await client.query(
        `DELETE FROM camera_grants cg
         USING household_members m, camera_sources cs
         WHERE cg.member_id = m.id AND cg.camera_source_id = cs.id
           AND m.household_id = $1 AND m.user_id = $2 AND m.status = 'active'
           AND cs.public_camera_id = $3
         RETURNING cg.id`,
        [householdId, userId, publicCameraId],
      );
      if (deleted.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const sessions = await client.query<{ id: string }>(
        `SELECT id FROM browser_sessions
         WHERE user_id = $1 AND household_id = $2 AND revoked_at IS NULL`,
        [userId, householdId],
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

  async createGuestLink(input: {
    householdId: string;
    tokenHash: string;
    label?: string;
    canListen: boolean;
    canTalk: boolean;
    canFlip: boolean;
    canPause: boolean;
    createdByUserId: string;
    expiresAt: Date;
    publicCameraIds: string[];
  }): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const link = await client.query<{ id: string }>(
        `INSERT INTO guest_links
         (household_id, token_hash, label, can_listen, can_talk, can_flip, can_pause,
          created_by_user_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          input.householdId,
          input.tokenHash,
          input.label ?? null,
          input.canListen,
          input.canTalk,
          input.canFlip,
          input.canPause,
          input.createdByUserId,
          input.expiresAt,
        ],
      );
      const guestLinkId = link.rows[0]!.id;
      const inserted = await client.query(
        `INSERT INTO guest_link_cameras (guest_link_id, camera_source_id)
         SELECT $1, cs.id FROM camera_sources cs
         JOIN cameras d ON d.id = cs.device_id
         WHERE cs.public_camera_id = ANY($2::uuid[]) AND d.household_id = $3
           AND cs.enabled = true AND cs.removed_at IS NULL AND d.revoked_at IS NULL`,
        [guestLinkId, input.publicCameraIds, input.householdId],
      );
      if ((inserted.rowCount ?? 0) !== input.publicCameraIds.length) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
      return guestLinkId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listGuestLinks(
    householdId: string,
    now: Date,
  ): Promise<GuestLinkRecord[]> {
    const result = await this.pool.query<GuestLinkRecord>(
      `SELECT gl.id, gl.label, gl.can_listen AS "canListen",
              gl.can_talk AS "canTalk", gl.can_flip AS "canFlip",
              gl.can_pause AS "canPause", gl.expires_at AS "expiresAt",
              gl.revoked_at AS "revokedAt", gl.created_at AS "createdAt",
              array_agg(cs.public_camera_id) AS "cameraIds"
       FROM guest_links gl
       JOIN guest_link_cameras glc ON glc.guest_link_id = gl.id
       JOIN camera_sources cs ON cs.id = glc.camera_source_id
       WHERE gl.household_id = $1 AND gl.revoked_at IS NULL AND gl.expires_at > $2
       GROUP BY gl.id
       ORDER BY gl.created_at DESC, gl.id DESC`,
      [householdId, now],
    );
    return result.rows;
  }

  async revokeGuestLink(
    householdId: string,
    guestLinkId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE guest_links SET revoked_at = now(), updated_at = now()
       WHERE id = $2 AND household_id = $1 AND revoked_at IS NULL`,
      [householdId, guestLinkId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findGuestAccessibleCamera(
    tokenHash: string,
    publicCameraId: string,
    now: Date,
  ): Promise<CameraAccess | null> {
    const result = await this.pool.query<CameraAccess>(
      `SELECT cs.id AS "cameraId", d.id AS "deviceId",
              d.household_id AS "householdId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId",
              gl.can_listen AS "canListen", gl.can_talk AS "canTalk",
              gl.can_flip AS "canFlip", gl.can_pause AS "canPause"
       FROM guest_links gl
       JOIN guest_link_cameras glc ON glc.guest_link_id = gl.id
       JOIN camera_sources cs ON cs.id = glc.camera_source_id
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE gl.token_hash = $1 AND cs.public_camera_id = $2
         AND gl.revoked_at IS NULL AND gl.expires_at > $3
         AND cs.enabled = true AND d.revoked_at IS NULL
         AND d.enabled = true AND d.privacy_mode = false
         AND cs.removed_at IS NULL
         AND (d.platform = 'browser' OR dc.revoked_at IS NULL)`,
      [tokenHash, publicCameraId, now],
    );
    return result.rows[0] ?? null;
  }

  async listGuestAccessibleCameras(
    tokenHash: string,
    now: Date,
  ): Promise<{ householdId: string; cameras: AccessibleCameraRecord[] } | null> {
    const link = await this.pool.query<{
      householdId: string;
      canListen: boolean;
      canTalk: boolean;
      canFlip: boolean;
      canPause: boolean;
    }>(
      `SELECT household_id AS "householdId", can_listen AS "canListen",
              can_talk AS "canTalk", can_flip AS "canFlip", can_pause AS "canPause"
       FROM guest_links
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [tokenHash, now],
    );
    const found = link.rows[0];
    if (!found) return null;
    const cameras = await this.pool.query<CameraRecord>(
      `SELECT cs.id, cs.device_id AS "deviceId",
              cs.public_camera_id AS "publicCameraId",
              d.public_device_id AS "publicDeviceId",
              d.name AS "deviceName", d.platform,
              cs.display_name AS name, cs.source_key AS "sourceKey",
              cs.facing, cs.enabled, d.privacy_mode AS "privacyMode",
              cs.capabilities,
              COALESCE(cs.last_seen_at, d.last_seen_at) AS "lastSeenAt",
              COALESCE(dc.revoked_at, d.revoked_at) AS "credentialRevokedAt",
              d.paired_by_user_id AS "pairedByUserId"
       FROM guest_links gl
       JOIN guest_link_cameras glc ON glc.guest_link_id = gl.id
       JOIN camera_sources cs ON cs.id = glc.camera_source_id
       JOIN cameras d ON d.id = cs.device_id
       LEFT JOIN device_credentials dc ON dc.camera_id = d.id
       WHERE gl.token_hash = $1 AND cs.removed_at IS NULL
       ORDER BY d.created_at, cs.created_at`,
      [tokenHash],
    );
    return {
      householdId: found.householdId,
      cameras: cameras.rows.map((camera) => ({
        ...camera,
        canFlip: found.canFlip,
        canListen: found.canListen,
        canPause: found.canPause,
        canTalk: found.canTalk,
      })),
    };
  }
}
