import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { deliverDriveExpiredReminder } from './account-recovery-email.js';
import type { AppConfig } from './config.js';
import type { DriveHealth } from './drive-connection-health.js';
import type { MilestoneStore } from './store.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1_000;
/** Reminders go out when a connection expires and then at this spacing. */
export const DRIVE_REMINDER_GAP_MS = 3 * 24 * 60 * 60 * 1_000;
/** Including the first, so an abandoned connection stops nagging after about two weeks. */
export const DRIVE_MAX_REMINDERS = 5;

/**
 * One sweep (ADR 0116): find connections Google stopped accepting without waiting for someone to
 * record a clip, then email the owner a reminder to reconnect. Returns how many reminders went out.
 */
export async function runDriveExpirySweep(
  store: MilestoneStore,
  driveHealth: DriveHealth,
  config: Pick<AppConfig, 'RESEND_API_KEY' | 'RESEND_FROM' | 'WEB_ORIGIN'>,
  logger: Pick<FastifyBaseLogger, 'warn' | 'info'>,
  now: Date = new Date(),
  send: typeof deliverDriveExpiredReminder = deliverDriveExpiredReminder,
): Promise<number> {
  for (const connection of await store.listLiveGoogleDriveConnections()) {
    // Marks the connection expired (and audits it) when Google rejects the token.
    await driveHealth
      .problem(connection.userId, connection.householdId, 'any')
      .catch((error: unknown) =>
        logger.warn({ err: error }, 'Drive connection check failed'),
      );
  }
  if (!config.RESEND_API_KEY || !config.RESEND_FROM) return 0;
  let sent = 0;
  const targets = await store.listGoogleDriveReminderTargets({
    gapMs: DRIVE_REMINDER_GAP_MS,
    maxReminders: DRIVE_MAX_REMINDERS,
    now,
  });
  for (const target of targets) {
    try {
      await send(config, target.email);
      await store.markGoogleDriveReminderSent(target.userId, now);
      sent += 1;
    } catch (error) {
      // Tried again on the next sweep.
      logger.warn({ err: error }, 'Drive reminder email failed');
    }
  }
  return sent;
}

export function startDriveExpiryJob(
  app: FastifyInstance,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await app.runDriveExpirySweep();
      if (sent > 0)
        app.log.info({ sent }, 'Sent Google Drive reconnect reminders');
    } catch (error) {
      app.log.error({ err: error }, 'Google Drive expiry sweep failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  // The first sweep waits a minute so a restart does not stack on startup work.
  setTimeout(() => void run(), 60_000).unref();
  return () => clearInterval(timer);
}
