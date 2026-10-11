import type { FastifyInstance } from 'fastify';

import { deliverAccountDeletedAlert } from './account-recovery-email.js';
import type { AppConfig } from './config.js';
import { revokeDriveRefreshToken } from './google-drive-client.js';
import type { HouseholdEventHub } from './household-events.js';
import {
  accountDeletionSchema,
  householdSelectionSchema,
  sessionParameterSchema,
} from './http-schemas.js';
import type { SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const REAUTHENTICATION_WINDOW = 10 * 60 * 1_000;

interface AccountRouteDependencies {
  auth: SessionAuth;
  config: AppConfig;
  householdEvents: HouseholdEventHub;
  signaling: SignalingHub;
  store: MilestoneStore;
}

export function registerAccountRoutes(
  app: FastifyInstance,
  dependencies: AccountRouteDependencies,
): void {
  const { auth, config, householdEvents, signaling, store } = dependencies;

  app.get('/api/auth/me', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const user = await store.findUserById(session.userId);
    return {
      user: {
        avatarUrl: session.avatarUrl,
        email: session.email,
        emailVerified: Boolean(user?.emailVerifiedAt),
        googleLinked: Boolean(user?.googleSubject),
        hasPassword: Boolean(user?.passwordHash),
        id: session.userId,
      },
      household: {
        id: session.householdId,
        role: session.role,
      },
    };
  });

  app.get('/api/account/households', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const households = await store.listHouseholdAccess(
      session.userId,
      new Date(),
    );
    return {
      currentHouseholdId: session.householdId,
      households: households.map((household) => ({
        expiresAt: household.expiresAt?.toISOString() ?? null,
        id: household.householdId,
        name: household.name,
        role: household.role,
      })),
    };
  });

  app.put('/api/account/household', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    const body = householdSelectionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid household selection' });
    }
    const switched = await store.switchSessionHousehold(
      session.userId,
      session.id,
      body.data.householdId,
      new Date(),
    );
    if (!switched) {
      return reply.code(404).send({ error: 'Household unavailable' });
    }
    // The session token itself is still fully valid here -- only its
    // active household changed -- so this must not read as a sign-out to
    // the client the way a real revocation does.
    householdEvents.refreshSession(session.id, 'Household changed');
    signaling.disconnectSession(session.id, 'household_changed');
    return reply.code(204).send();
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    await store.revokeSession(session.id);
    householdEvents.closeSession(session.id);
    signaling.disconnectSession(session.id);
    await store.audit({
      eventType: 'logout',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    auth.clearSessionCookies(reply);
    return reply.code(204).send();
  });

  app.get('/api/account/sessions', async (request, reply) => {
    const current = await auth.authenticate(request, reply);
    if (!current) return;
    const sessions = await store.listBrowserSessions(current.userId);
    return {
      sessions: sessions.map((session) => ({
        createdAt: session.createdAt.toISOString(),
        current: session.id === current.id,
        expiresAt: session.absoluteExpiresAt.toISOString(),
        id: session.id,
        lastSeenAt: session.lastSeenAt.toISOString(),
        userAgent: session.userAgent,
      })),
    };
  });

  app.delete('/api/account/sessions/:sessionId', async (request, reply) => {
    const current = await auth.authenticateStateChange(request, reply);
    if (!current) return;
    const parameters = sessionParameterSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    const revoked = await store.revokeBrowserSession(
      current.userId,
      parameters.data.sessionId,
    );
    if (!revoked) return reply.code(404).send({ error: 'Session not found' });
    await store.audit({
      eventType: 'browser_session_revoked',
      householdId: current.householdId,
      ipAddress: request.ip,
      success: true,
      userId: current.userId,
    });
    if (parameters.data.sessionId === current.id) {
      auth.clearSessionCookies(reply);
    }
    householdEvents.closeSession(parameters.data.sessionId);
    signaling.disconnectSession(parameters.data.sessionId);
    return reply.code(204).send();
  });

  app.delete('/api/account', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    const body = accountDeletionSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Account deletion was not confirmed' });
    }
    if (
      Date.now() - session.reauthenticatedAt.getTime() >
      REAUTHENTICATION_WINDOW
    ) {
      return reply.code(403).send({
        error: 'Sign in again, then retry account deletion within 10 minutes',
      });
    }
    const ownedHouseholdId = session.ownedHouseholdId;
    const browserSessions = await store.listBrowserSessions(session.userId);
    const cameras = ownedHouseholdId
      ? await store.listCameras(ownedHouseholdId)
      : [];
    const driveRefreshToken = await store.getGoogleDriveRefreshToken(
      session.userId,
    );
    // Remove the clip files from Drive while the connection still works; the
    // token is revoked right after, and the database rows go with the account.
    if (ownedHouseholdId && driveRefreshToken) {
      await app
        .removeHouseholdDriveFiles(ownedHouseholdId)
        .then((outcome) =>
          app.log.info(outcome, 'removed recording files from Drive'),
        )
        .catch((error: unknown) =>
          app.log.warn(
            { err: error },
            'could not remove Drive recording files',
          ),
        );
    }
    if (driveRefreshToken) {
      await revokeDriveRefreshToken(driveRefreshToken).catch(() => false);
    }
    for (const camera of cameras) {
      signaling.disconnectCamera(camera.publicCameraId, 'device_deleted');
    }
    const deleted = await store.deleteAccount(session.userId);
    if (!deleted) return reply.code(404).send({ error: 'Account not found' });
    await store.audit({
      eventType: 'account_deleted',
      ipAddress: request.ip,
      success: true,
    });
    if (config.RESEND_API_KEY && config.RESEND_FROM) {
      await deliverAccountDeletedAlert(config, session.email).catch(() => {});
    }
    auth.clearSessionCookies(reply);
    for (const browserSession of browserSessions) {
      householdEvents.closeSession(browserSession.id, 'Account deleted');
      signaling.disconnectSession(browserSession.id, 'account_deleted');
    }
    if (ownedHouseholdId) householdEvents.closeHousehold(ownedHouseholdId);
    return reply.code(204).send();
  });
}
