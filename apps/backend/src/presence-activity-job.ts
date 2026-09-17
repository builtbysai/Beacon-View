import type { FastifyBaseLogger } from 'fastify';

import type { MilestoneStore } from './store.js';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_OFFLINE_AFTER_MS = 120_000;

export async function runPresenceActivitySweep(
  store: MilestoneStore,
  logger: FastifyBaseLogger,
  now = new Date(),
  offlineAfterMs = DEFAULT_OFFLINE_AFTER_MS,
): Promise<void> {
  const created = await store.scanDevicePresenceActivity(now, offlineAfterMs);
  if (created > 0) {
    logger.info({ created }, 'Recorded device offline activity');
  }
}

export function startPresenceActivityJob(
  store: MilestoneStore,
  logger: FastifyBaseLogger,
  intervalMs = DEFAULT_INTERVAL_MS,
  offlineAfterMs = DEFAULT_OFFLINE_AFTER_MS,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runPresenceActivitySweep(store, logger, new Date(), offlineAfterMs);
    } catch (error) {
      logger.error({ err: error }, 'Device presence activity sweep failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
