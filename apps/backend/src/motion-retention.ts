import type { FastifyBaseLogger } from 'fastify';
import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;

type RetentionStore = Pick<
  MilestoneStore,
  'audit' | 'purgeExpiredMotionEvents'
>;

export async function runMotionRetentionSweep(
  store: RetentionStore,
  logger: FastifyBaseLogger,
  now = new Date(),
): Promise<void> {
  try {
    for (const result of await store.purgeExpiredMotionEvents(now)) {
      await store.audit({
        eventType: 'motion_history_retention_pruned',
        householdId: result.householdId,
        metadata: { deletedCount: String(result.deletedCount) },
        success: true,
      });
      logger.info(
        {
          householdId: result.householdId,
          deletedCount: result.deletedCount,
        },
        'Pruned expired motion metadata',
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Motion metadata retention sweep failed');
  }
}

export function startMotionRetentionJob(
  store: MilestoneStore,
  logger: FastifyBaseLogger,
): () => void {
  let running = false;
  async function purge() {
    if (running) return;
    running = true;
    try {
      await runMotionRetentionSweep(store, logger);
    } finally {
      running = false;
    }
  }
  void purge();
  const timer = setInterval(() => void purge(), HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
