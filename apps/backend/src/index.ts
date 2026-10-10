import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';

import { buildApp, createPostgresStore } from './app.js';
import { startAuditRetentionJob } from './audit-retention.js';
import { parseConfig } from './config.js';
import { startHouseholdModeJob } from './household-mode-job.js';
import { startMotionRetentionJob } from './motion-retention.js';
import { startNotificationJob } from './notification-job.js';
import { startPresenceActivityJob } from './presence-activity-job.js';
import { startRecordingRecoveryJob } from './recording-recovery.js';
import { HouseholdEventHub } from './household-events.js';

loadEnvironment({
  override: false,
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});

const config = parseConfig(process.env);
const store = createPostgresStore(config);
const householdEvents = new HouseholdEventHub();
const app = buildApp(config, store, householdEvents);
let shuttingDown = false;
let stopRetentionJob: (() => void) | undefined;
let stopAuditRetentionJob: (() => void) | undefined;
let stopNotificationJob: (() => void) | undefined;
let stopPresenceActivityJob: (() => void) | undefined;
let stopRecordingRecoveryJob: (() => void) | undefined;
let stopHouseholdModeJob: (() => void) | undefined;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopRetentionJob?.();
  stopAuditRetentionJob?.();
  stopNotificationJob?.();
  stopPresenceActivityJob?.();
  stopRecordingRecoveryJob?.();
  stopHouseholdModeJob?.();

  app.log.info({ signal }, 'Shutdown requested');
  await app.close();
  process.exitCode = 0;
}

// Background work is isolated from request handling: log a stray rejection
// instead of ending every live camera session with the process.
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'Unhandled promise rejection');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      app.log.error({ err: error }, 'Graceful shutdown failed');
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  stopRetentionJob = startMotionRetentionJob(store, app.log);
  stopAuditRetentionJob = startAuditRetentionJob(store, app.log);
  stopNotificationJob = startNotificationJob(
    store,
    config,
    app.log,
    (sessionId, message) => householdEvents.sendToSession(sessionId, message),
  );
  stopPresenceActivityJob = startPresenceActivityJob(
    store,
    app.log,
    householdEvents,
  );
  stopRecordingRecoveryJob = startRecordingRecoveryJob(store, app.log);
  stopHouseholdModeJob = startHouseholdModeJob(app);
} catch (error) {
  app.log.fatal({ err: error }, 'Backend startup failed');
  process.exitCode = 1;
  await app.close();
}
