import type { FastifyBaseLogger } from 'fastify';

import type { HouseholdEventHub } from './household-events.js';
import type { MilestoneStore } from './store.js';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_OFFLINE_AFTER_MS = 120_000;

export async function runPresenceActivitySweep(
  store: MilestoneStore,
  logger: FastifyBaseLogger,
  householdEvents: HouseholdEventHub,
  now = new Date(),
  offlineAfterMs = DEFAULT_OFFLINE_AFTER_MS,
): Promise<void> {
  const householdIds = await store.scanDevicePresenceActivity(
    now,
    offlineAfterMs,
  );
  for (const householdId of householdIds) {
    householdEvents.publish(householdId, { type: 'device-management-changed' });
  }
  if (householdIds.length > 0) {
    logger.info(
      { households: householdIds.length },
      'Recorded device offline activity',
    );
  }
}

export function startPresenceActivityJob(
  store: MilestoneStore,
  logger: FastifyBaseLogger,
  householdEvents: HouseholdEventHub,
  intervalMs = DEFAULT_INTERVAL_MS,
  offlineAfterMs = DEFAULT_OFFLINE_AFTER_MS,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runPresenceActivitySweep(
        store,
        logger,
        householdEvents,
        new Date(),
        offlineAfterMs,
      );
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
