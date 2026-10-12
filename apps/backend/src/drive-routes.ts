import type { FastifyInstance } from 'fastify';

import { runDriveExpirySweep } from './drive-expiry-job.js';

import type { AppConfig } from './config.js';
import { type DriveHealth, driveProblem } from './drive-connection-health.js';
import {
  GOOGLE_DRIVE_RECORDING_SCOPE,
  revokeDriveRefreshToken,
  verifyDriveAppDataAccess,
  verifyDriveRecordingAccess,
} from './google-drive-client.js';
import type { SessionAuth } from './session-auth.js';
import type { MilestoneStore } from './store.js';

declare module 'fastify' {
  interface FastifyInstance {
    runDriveExpirySweep(now?: Date): Promise<number>;
  }
}

export function registerDriveRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: SessionAuth;
    config: AppConfig;
    driveHealth: DriveHealth;
    store: MilestoneStore;
  },
): void {
  const { auth, config, driveHealth, store } = dependencies;

  app.decorate('runDriveExpirySweep', (now = new Date()) =>
    runDriveExpirySweep(store, driveHealth, config, app.log, now),
  );

  app.get('/api/drive/status', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    reply.header('Cache-Control', 'no-store');
    const configured =
      store.googleDriveConfigured() &&
      Boolean(
        config.GOOGLE_OAUTH_CLIENT_ID &&
        config.GOOGLE_OAUTH_CLIENT_SECRET &&
        config.GOOGLE_OAUTH_REDIRECT_URI,
      );
    // Re-checks a live connection at most hourly, so a token Google stopped
    // accepting shows as expired before anyone tries to record (ADR 0086).
    const problem = configured
      ? await driveHealth.problem(session.userId, session.householdId, 'any')
      : null;
    const connection =
      problem === null
        ? await store.getGoogleDriveConnection(session.userId)
        : null;
    return {
      connected: Boolean(connection),
      configured,
      // Google stopped accepting the connection; the owner must reconnect.
      expired: problem === 'drive_reconnect_required',
      recordingsConnected: Boolean(
        connection && hasScope(connection.scopes, GOOGLE_DRIVE_RECORDING_SCOPE),
      ),
      providerEmail: connection?.providerEmail ?? null,
      updatedAt: connection?.updatedAt.toISOString() ?? null,
    };
  });

  app.delete('/api/drive/connection', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    const refreshToken = await store.getGoogleDriveRefreshToken(session.userId);
    const providerRevoked = refreshToken
      ? await revokeDriveRefreshToken(refreshToken).catch(() => false)
      : false;
    const removed = await store.removeGoogleDriveConnection(session.userId);
    driveHealth.forget(session.userId);
    if (removed) {
      await store.audit({
        eventType: 'google_drive_disconnected',
        householdId: session.householdId,
        ipAddress: request.ip,
        metadata: {
          providerRevocation: refreshToken
            ? providerRevoked
              ? 'succeeded'
              : 'failed'
            : 'not_applicable',
        },
        success: true,
        userId: session.userId,
      });
    }
    return reply.code(204).send();
  });

  app.post('/api/drive/verify', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    try {
      const accessToken = await driveHealth.accessToken(
        session.userId,
        session.householdId,
        'any',
      );
      await verifyDriveAppDataAccess(accessToken);
      const connection = await store.getGoogleDriveConnection(session.userId);
      if (
        connection &&
        hasScope(connection.scopes, GOOGLE_DRIVE_RECORDING_SCOPE)
      )
        await verifyDriveRecordingAccess(accessToken);
      return reply.code(204).send();
    } catch (error) {
      const problem = driveProblem(error);
      if (problem?.code === 'drive_not_connected')
        return reply
          .code(404)
          .send({ ...problem, error: 'Google Drive is not connected' });
      if (problem) return reply.code(409).send(problem);
      return reply.code(503).send({
        error: 'Google Drive verification failed. Try again shortly.',
      });
    }
  });
}

function hasScope(scopes: string, expected: string): boolean {
  return scopes.split(/\s+/u).includes(expected);
}
