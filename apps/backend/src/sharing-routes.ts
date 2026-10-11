import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { canAssignRole } from './household-authorization.js';
import { deliverHouseholdInvitation } from './contact.js';
import type { AppConfig } from './config.js';
import type { HouseholdEventHub } from './household-events.js';
import { cameraParameterSchema } from './http-schemas.js';
import type { RateLimiter } from './rate-limit.js';
import { generateToken, hashSecret, normalizeEmail } from './security.js';
import type { SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;
const invitationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    expiresInHours: z.number().int().min(1).max(168).optional(),
    role: z.enum(['admin', 'viewer', 'guest']),
    // Only meaningful for role 'viewer' -- the permissions their default
    // grant (every current camera) is created with on acceptance.
    defaultCanListen: z.boolean().optional(),
    defaultCanTalk: z.boolean().optional(),
    defaultCanFlip: z.boolean().optional(),
    defaultCanPause: z.boolean().optional(),
    // Required for a viewer (V32): 'all' cameras, or exactly these cameras. The
    // owner decides at invite time; there is no silent default.
    cameraAccess: z
      .union([
        z.literal('all'),
        z
          .object({
            cameraIds: z.array(z.string().uuid()).min(1).max(100),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.role !== 'viewer' || value.cameraAccess !== undefined,
    {
      message: 'Choose which cameras a viewer can see',
      path: ['cameraAccess'],
    },
  );
const invitationParameterSchema = z.object({ invitationId: z.string().uuid() });
const invitationAcceptanceSchema = z
  .object({ token: z.string().min(32).max(512) })
  .strict();
const memberParameterSchema = z.object({ memberId: z.string().uuid() });
const grantsSchema = z
  .object({
    grants: z
      .array(
        z
          .object({
            cameraId: z.string().uuid(),
            canListen: z.boolean(),
            canTalk: z.boolean(),
            canFlip: z.boolean(),
            canPause: z.boolean(),
          })
          .strict(),
      )
      .max(24),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.grants.map((grant) => grant.cameraId)).size ===
      value.grants.length,
    { message: 'Duplicate camera grant' },
  );

export function registerSharingRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: SessionAuth;
    config: AppConfig;
    householdEvents: HouseholdEventHub;
    limiter: RateLimiter;
    signaling: SignalingHub;
    store: MilestoneStore;
  },
): void {
  const { auth, config, householdEvents, limiter, signaling, store } =
    dependencies;

  app.get('/api/household/sharing', async (request, reply) => {
    const session = await auth.authenticateHouseholdAdmin(request, reply);
    if (!session) return;
    const now = new Date();
    const [members, invitations] = await Promise.all([
      store.listHouseholdMembers(session.householdId),
      store.listHouseholdInvitations(session.householdId, now),
    ]);
    return {
      invitations: invitations.map((invitation) => ({
        ...invitation,
        createdAt: invitation.createdAt.toISOString(),
        expiresAt: invitation.expiresAt.toISOString(),
      })),
      members: members.map((member) => ({
        ...member,
        expiresAt: member.expiresAt?.toISOString() ?? null,
      })),
    };
  });

  app.post('/api/household/invitations', async (request, reply) => {
    const session = await auth.authenticateHouseholdAdminStateChange(
      request,
      reply,
    );
    if (!session) return;
    if (!limiter.take(`household-invite:${session.householdId}`, 20, HOUR))
      return reply.code(429).send({ error: 'Too many invitation changes' });
    const body = invitationSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Invalid household invitation' });
    if (
      !canAssignRole(
        { expiresAt: null, role: session.role, status: 'active' },
        body.data.role,
      )
    )
      return reply
        .code(403)
        .send({ error: 'You cannot invite that household role' });
    const selected =
      body.data.cameraAccess && body.data.cameraAccess !== 'all'
        ? [...new Set(body.data.cameraAccess.cameraIds)]
        : null;
    if (selected) {
      const known = new Set(
        (await store.listCameras(session.householdId)).map(
          (camera) => camera.publicCameraId,
        ),
      );
      if (!selected.every((id) => known.has(id)))
        return reply
          .code(400)
          .send({ error: 'Choose cameras in this household' });
    }
    const token = generateToken();
    const expiresAt = new Date(
      Date.now() + (body.data.expiresInHours ?? 48) * HOUR,
    );
    const id = await store.createHouseholdInvitation({
      cameraPublicIds: selected ?? [],
      cameraScope: selected ? 'selected' : 'all',
      defaultCanFlip: body.data.defaultCanFlip ?? false,
      defaultCanListen: body.data.defaultCanListen ?? false,
      defaultCanPause: body.data.defaultCanPause ?? false,
      defaultCanTalk: body.data.defaultCanTalk ?? false,
      expiresAt,
      householdId: session.householdId,
      invitedByUserId: session.userId,
      invitedEmail: normalizeEmail(body.data.email),
      role: body.data.role,
      tokenHash: hashSecret(token),
    });
    if (config.RESEND_API_KEY && config.RESEND_FROM) {
      try {
        await deliverHouseholdInvitation(config, {
          expiresAt,
          invitedBy: session.email,
          role: body.data.role,
          token,
          to: body.data.email,
        });
      } catch {
        await store.revokeHouseholdInvitation(session.householdId, id);
        return reply
          .code(503)
          .send({ error: 'Invitation email could not be delivered' });
      }
    }
    householdEvents.publish(session.householdId, {
      type: 'household-membership-changed',
    });
    await store.audit({
      eventType: 'household_invitation_created',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { invitationId: id, role: body.data.role },
      success: true,
      userId: session.userId,
    });
    return reply
      .code(201)
      .send({ expiresAt: expiresAt.toISOString(), id, token });
  });

  app.post(
    '/api/household/invitations/:invitationId/resend',
    async (request, reply) => {
      const session = await auth.authenticateHouseholdAdminStateChange(
        request,
        reply,
      );
      if (!session) return;
      if (!limiter.take(`household-invite:${session.householdId}`, 20, HOUR))
        return reply.code(429).send({ error: 'Too many invitation changes' });
      const parameters = invitationParameterSchema.safeParse(request.params);
      if (!parameters.success)
        return reply.code(404).send({ error: 'Invitation unavailable' });
      const pending = (
        await store.listHouseholdInvitations(session.householdId, new Date(0))
      ).find((item) => item.id === parameters.data.invitationId);
      if (
        !pending ||
        !canAssignRole(
          { expiresAt: null, role: session.role, status: 'active' },
          pending.role,
        )
      )
        return reply.code(404).send({ error: 'Invitation unavailable' });
      // Resending replaces the invitation outright (fresh token, fresh
      // expiry) rather than re-mailing the existing one, so a lost or
      // expired invite can be recovered the same way. The previous
      // invitation is only revoked after the replacement is confirmed
      // created and delivered, so a delivery failure never leaves the
      // household without a working pending invitation.
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 48 * HOUR);
      const id = await store.createHouseholdInvitation({
        cameraPublicIds: pending.cameraPublicIds,
        cameraScope: pending.cameraScope,
        defaultCanFlip: pending.defaultCanFlip,
        defaultCanListen: pending.defaultCanListen,
        defaultCanPause: pending.defaultCanPause,
        defaultCanTalk: pending.defaultCanTalk,
        expiresAt,
        householdId: session.householdId,
        invitedByUserId: session.userId,
        invitedEmail: pending.invitedEmail,
        role: pending.role,
        tokenHash: hashSecret(token),
      });
      if (config.RESEND_API_KEY && config.RESEND_FROM) {
        try {
          await deliverHouseholdInvitation(config, {
            expiresAt,
            invitedBy: session.email,
            role: pending.role,
            token,
            to: pending.invitedEmail,
          });
        } catch {
          await store.revokeHouseholdInvitation(session.householdId, id);
          return reply
            .code(503)
            .send({ error: 'Invitation email could not be delivered' });
        }
      }
      await store.revokeHouseholdInvitation(session.householdId, pending.id);
      await store.audit({
        eventType: 'household_invitation_resent',
        householdId: session.householdId,
        ipAddress: request.ip,
        metadata: {
          newInvitationId: id,
          previousInvitationId: pending.id,
          role: pending.role,
        },
        success: true,
        userId: session.userId,
      });
      return reply
        .code(201)
        .send({ expiresAt: expiresAt.toISOString(), id, token });
    },
  );

  app.post('/api/household/invitations/accept', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (!limiter.take(`household-invite-accept:${session.userId}`, 20, HOUR))
      return reply.code(429).send({ error: 'Too many invitation attempts' });
    const body = invitationAcceptanceSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Invitation unavailable' });
    const accepted = await store.acceptHouseholdInvitation({
      email: normalizeEmail(session.email),
      now: new Date(),
      tokenHash: hashSecret(body.data.token),
      userId: session.userId,
    });
    if (!accepted)
      return reply.code(400).send({ error: 'Invitation unavailable' });
    // Lets an admin's already-open People & access screen drop the now-
    // accepted invitation from "pending" and pick up the new member
    // without needing a manual reload.
    householdEvents.publish(accepted.householdId, {
      type: 'household-membership-changed',
    });
    await store.audit({
      eventType: 'household_invitation_accepted',
      householdId: accepted.householdId,
      ipAddress: request.ip,
      metadata: { role: accepted.role },
      success: true,
      userId: session.userId,
    });
    await store
      .recordSecurityEvent({
        now: new Date(),
        securityEventType: 'household_membership_changed',
        userId: session.userId,
      })
      .catch((error: unknown) =>
        app.log.warn({ err: error }, 'failed to record security event'),
      );
    return reply.code(200).send(accepted);
  });

  app.delete(
    '/api/household/invitations/:invitationId',
    async (request, reply) => {
      const session = await auth.authenticateHouseholdAdminStateChange(
        request,
        reply,
      );
      if (!session) return;
      const parameters = invitationParameterSchema.safeParse(request.params);
      if (!parameters.success)
        return reply.code(404).send({ error: 'Invitation unavailable' });
      const pending = (
        await store.listHouseholdInvitations(session.householdId, new Date(0))
      ).find((item) => item.id === parameters.data.invitationId);
      if (
        !pending ||
        !canAssignRole(
          { expiresAt: null, role: session.role, status: 'active' },
          pending.role,
        )
      )
        return reply.code(404).send({ error: 'Invitation unavailable' });
      const revoked = await store.revokeHouseholdInvitation(
        session.householdId,
        pending.id,
      );
      if (!revoked)
        return reply.code(404).send({ error: 'Invitation unavailable' });
      householdEvents.publish(session.householdId, {
        type: 'household-membership-changed',
      });
      await store.audit({
        eventType: 'household_invitation_revoked',
        householdId: session.householdId,
        ipAddress: request.ip,
        metadata: { invitationId: pending.id, role: revoked },
        success: true,
        userId: session.userId,
      });
      return reply.code(204).send();
    },
  );

  app.put('/api/household/members/:memberId/grants', async (request, reply) => {
    const session = await auth.authenticateHouseholdAdminStateChange(
      request,
      reply,
    );
    if (!session) return;
    const parameters = memberParameterSchema.safeParse(request.params);
    const body = grantsSchema.safeParse(request.body);
    if (!parameters.success || !body.success)
      return reply.code(400).send({ error: 'Invalid camera grants' });
    const member = (await store.listHouseholdMembers(session.householdId)).find(
      (item) => item.id === parameters.data.memberId,
    );
    if (
      !member ||
      !canAssignRole(
        { expiresAt: null, role: session.role, status: 'active' },
        member.role,
      )
    )
      return reply.code(404).send({ error: 'Household member unavailable' });
    const sessionIds = await store.replaceHouseholdMemberGrants({
      grants: body.data.grants,
      householdId: session.householdId,
      memberId: member.id,
    });
    if (!sessionIds)
      return reply.code(404).send({ error: 'Household member unavailable' });
    // The member's session stays valid -- only which cameras/controls it
    // can reach changed -- so this refreshes their connections rather than
    // signing them out.
    refreshSessions(
      sessionIds,
      householdEvents,
      signaling,
      'Camera grants changed',
    );
    householdEvents.publish(session.householdId, {
      type: 'household-membership-changed',
    });
    await store.audit({
      eventType: 'household_camera_grants_changed',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { memberId: member.id },
      success: true,
      userId: session.userId,
    });
    return reply.code(204).send();
  });

  app.delete('/api/household/members/:memberId', async (request, reply) => {
    const session = await auth.authenticateHouseholdAdminStateChange(
      request,
      reply,
    );
    if (!session) return;
    const parameters = memberParameterSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Household member unavailable' });
    const member = (await store.listHouseholdMembers(session.householdId)).find(
      (item) => item.id === parameters.data.memberId,
    );
    if (
      !member ||
      !canAssignRole(
        { expiresAt: null, role: session.role, status: 'active' },
        member.role,
      )
    )
      return reply.code(404).send({ error: 'Household member unavailable' });
    const sessionIds = await store.revokeHouseholdMember(
      session.householdId,
      member.id,
    );
    if (!sessionIds)
      return reply.code(404).send({ error: 'Household member unavailable' });
    // Unlike the grant/leave routes below, revokeHouseholdMember actually
    // invalidates these browser_sessions -- this really is a sign-out.
    closeSessions(
      sessionIds,
      householdEvents,
      signaling,
      'Household access revoked',
    );
    householdEvents.publish(session.householdId, {
      type: 'household-membership-changed',
    });
    await store.audit({
      eventType: 'household_member_revoked',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { memberId: member.id, role: member.role },
      success: true,
      userId: session.userId,
    });
    await store
      .recordSecurityEvent({
        now: new Date(),
        securityEventType: 'household_membership_changed',
        userId: member.userId,
      })
      .catch((error: unknown) =>
        app.log.warn({ err: error }, 'failed to record security event'),
      );
    return reply.code(204).send();
  });

  // Second, separate step after the revoke above: permanently drop an
  // already-revoked member from the list. Kept as its own endpoint rather
  // than folded into the DELETE above so it can never happen by accident --
  // it only succeeds once the member is already revoked, and there's no
  // undo for it.
  app.delete(
    '/api/household/members/:memberId/permanently',
    async (request, reply) => {
      const session = await auth.authenticateHouseholdAdminStateChange(
        request,
        reply,
      );
      if (!session) return;
      const parameters = memberParameterSchema.safeParse(request.params);
      if (!parameters.success)
        return reply.code(404).send({ error: 'Household member unavailable' });
      const member = (
        await store.listHouseholdMembers(session.householdId)
      ).find((item) => item.id === parameters.data.memberId);
      if (
        !member ||
        !canAssignRole(
          { expiresAt: null, role: session.role, status: 'active' },
          member.role,
        )
      )
        return reply.code(404).send({ error: 'Household member unavailable' });
      const removed = await store.permanentlyRemoveHouseholdMember(
        session.householdId,
        member.id,
      );
      if (!removed)
        return reply.code(409).send({
          error: 'Revoke this member first before removing them',
        });
      householdEvents.publish(session.householdId, {
        type: 'household-membership-changed',
      });
      await store.audit({
        eventType: 'household_member_removed',
        householdId: session.householdId,
        ipAddress: request.ip,
        metadata: { memberId: member.id, role: member.role },
        success: true,
        userId: session.userId,
      });
      return reply.code(204).send();
    },
  );

  // Self-service: a viewer or guest dropping their own access to a camera
  // someone shared with them. This only ever touches the caller's own
  // grant row -- it can't affect the camera itself or anyone else's access
  // to it, so unlike the routes above it needs no admin check at all.
  app.delete('/api/account/cameras/:cameraId', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    const parameters = cameraParameterSchema.safeParse(request.params);
    if (!parameters.success)
      return reply.code(404).send({ error: 'Camera not found' });
    const sessionIds = await store.leaveCamera(
      session.householdId,
      session.userId,
      parameters.data.cameraId,
    );
    if (!sessionIds) return reply.code(404).send({ error: 'Camera not found' });
    // Own choice, own session stays valid -- refresh, don't sign out.
    refreshSessions(
      sessionIds,
      householdEvents,
      signaling,
      'Camera access changed',
    );
    await store.audit({
      eventType: 'camera_access_left',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: { cameraId: parameters.data.cameraId },
      success: true,
      userId: session.userId,
    });
    return reply.code(204).send();
  });
}

function closeSessions(
  sessionIds: string[],
  householdEvents: HouseholdEventHub,
  signaling: SignalingHub,
  reason: string,
): void {
  for (const sessionId of sessionIds) {
    householdEvents.closeSession(sessionId, reason);
    signaling.disconnectSession(sessionId, 'authorization_changed');
  }
}

function refreshSessions(
  sessionIds: string[],
  householdEvents: HouseholdEventHub,
  signaling: SignalingHub,
  reason: string,
): void {
  for (const sessionId of sessionIds) {
    householdEvents.refreshSession(sessionId, reason);
    signaling.disconnectSession(sessionId, 'authorization_changed');
  }
}
