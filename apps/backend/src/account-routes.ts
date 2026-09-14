import type { FastifyInstance } from 'fastify';

import type { HouseholdEventHub } from './household-events.js';
import {
  accountDeletionSchema,
  sessionParameterSchema,
} from './http-schemas.js';
import type { SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const REAUTHENTICATION_WINDOW = 10 * 60 * 1_000;

interface AccountRouteDependencies {
  auth: SessionAuth;
  householdEvents: HouseholdEventHub;
  signaling: SignalingHub;
  store: MilestoneStore;
}

export function registerAccountRoutes(
  app: FastifyInstance,
  dependencies: AccountRouteDependencies,
): void {
  const { auth, householdEvents, signaling, store } = dependencies;

  app.get('/api/auth/me', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    return {
      user: {
        avatarUrl: session.avatarUrl,
        email: session.email,
        id: session.userId,
      },
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    await store.revokeSession(session.id);
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
    const cameras = await store.listCameras(session.householdId);
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
    auth.clearSessionCookies(reply);
    householdEvents.closeHousehold(session.householdId);
    return reply.code(204).send();
  });
}
