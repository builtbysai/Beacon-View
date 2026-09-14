import { OAuth2Client } from 'google-auth-library';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import { refreshDriveAccessToken } from './google-drive-client.js';
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
      providerEmail: connection?.providerEmail ?? null,
      updatedAt: connection?.updatedAt.toISOString() ?? null,
    };
  });

  app.delete('/api/drive/connection', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    const removed = await store.removeGoogleDriveConnection(session.userId);
    if (removed) {
      await store.audit({
        eventType: 'google_drive_disconnected',
        householdId: session.householdId,
        ipAddress: request.ip,
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
      await refreshDriveAccessToken(client, refreshToken);
      return reply.code(204).send();
    } catch {
      return reply
        .code(503)
        .send({ error: 'Google Drive verification failed' });
    }
  });
}
