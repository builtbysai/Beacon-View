import { OAuth2Client } from 'google-auth-library';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import {
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

  app.get('/api/drive/status', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    reply.header('Cache-Control', 'no-store');
    const connection = await store.getGoogleDriveConnection(session.userId);
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
