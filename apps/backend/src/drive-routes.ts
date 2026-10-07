import { OAuth2Client } from 'google-auth-library';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import {
  DRIVE_HEALTH_CHECK_INTERVAL_MS,
  expireDriveConnection,
} from './drive-connection-health.js';
import {
  DriveReconnectRequiredError,
  GOOGLE_DRIVE_RECORDING_SCOPE,
  refreshDriveAccessToken,
  revokeDriveRefreshToken,
  verifyDriveAppDataAccess,
  verifyDriveRecordingAccess,
} from './google-drive-client.js';
import type { SessionAuth } from './session-auth.js';
import type { MilestoneStore } from './store.js';

export function registerDriveRoutes(
  app: FastifyInstance,
  dependencies: { auth: SessionAuth; config: AppConfig; store: MilestoneStore },
): void {
  const { auth, config, store } = dependencies;
  // When each user's Drive token was last confirmed live (in memory; a
  // restart just means one extra check).
  const lastHealthCheck = new Map<string, number>();

  /** Returns false when Google rejected the token and the connection was
   * dropped. Transient failures count as healthy -- only an explicit
   * invalid_grant ends a connection. */
  async function driveTokenAlive(
    userId: string,
    householdId: string,
  ): Promise<boolean> {
    const checkedAt = lastHealthCheck.get(userId) ?? 0;
    if (Date.now() - checkedAt < DRIVE_HEALTH_CHECK_INTERVAL_MS) return true;
    const refreshToken = await store.getGoogleDriveRefreshToken(userId);
    if (!refreshToken || !config.GOOGLE_OAUTH_CLIENT_ID) return true;
    try {
      await refreshDriveAccessToken(
        new OAuth2Client(
          config.GOOGLE_OAUTH_CLIENT_ID,
          config.GOOGLE_OAUTH_CLIENT_SECRET,
          config.GOOGLE_OAUTH_REDIRECT_URI,
        ),
        refreshToken,
      );
      lastHealthCheck.set(userId, Date.now());
      return true;
    } catch (error) {
      if (!(error instanceof DriveReconnectRequiredError)) return true;
      lastHealthCheck.delete(userId);
      await expireDriveConnection(store, userId, householdId);
      return false;
    }
  }

  app.get('/api/drive/status', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    reply.header('Cache-Control', 'no-store');
    let connection = await store.getGoogleDriveConnection(session.userId);
    let expired = false;
    if (
      connection &&
      !(await driveTokenAlive(session.userId, session.householdId))
    ) {
      connection = null;
      expired = true;
    }
    const configured =
      store.googleDriveConfigured() &&
      Boolean(
        config.GOOGLE_OAUTH_CLIENT_ID &&
        config.GOOGLE_OAUTH_CLIENT_SECRET &&
        config.GOOGLE_OAUTH_REDIRECT_URI,
      );
    return {
      connected: Boolean(connection),
      configured,
      // Google stopped accepting the connection; the owner must reconnect.
      expired,
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
    const refreshToken = await store.getGoogleDriveRefreshToken(session.userId);
    if (!refreshToken || !config.GOOGLE_OAUTH_CLIENT_ID) {
      return reply.code(404).send({ error: 'Google Drive is not connected' });
    }
    try {
      const client = new OAuth2Client(
        config.GOOGLE_OAUTH_CLIENT_ID,
        config.GOOGLE_OAUTH_CLIENT_SECRET,
        config.GOOGLE_OAUTH_REDIRECT_URI,
      );
      const accessToken = await refreshDriveAccessToken(client, refreshToken);
      await verifyDriveAppDataAccess(accessToken);
      const connection = await store.getGoogleDriveConnection(session.userId);
      if (
        connection &&
        hasScope(connection.scopes, GOOGLE_DRIVE_RECORDING_SCOPE)
      )
        await verifyDriveRecordingAccess(accessToken);
      return reply.code(204).send();
    } catch {
      return reply
        .code(503)
        .send({ error: 'Google Drive verification failed' });
    }
  });
}

function hasScope(scopes: string, expected: string): boolean {
  return scopes.split(/\s+/u).includes(expected);
}
