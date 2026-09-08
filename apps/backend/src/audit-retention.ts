import type { FastifyBaseLogger } from 'fastify';

import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;

type AuditRetentionStore = Pick<MilestoneStore, 'purgeExpiredAuditEvents'>;

export async function runAuditRetentionSweep(
  store: AuditRetentionStore,
  logger: FastifyBaseLogger,
  now = new Date(),
): Promise<void> {
  try {
    const deletedCount = await store.purgeExpiredAuditEvents(now);
    logger.info({ deletedCount }, 'Pruned expired security audit events');
  } catch (error) {
    logger.error({ err: error }, 'Security audit retention sweep failed');
  }
}

export function startAuditRetentionJob(
  store: MilestoneStore,
  logger: FastifyBaseLogger,
): () => void {
  let running = false;
  async function purge() {
    if (running) return;
    running = true;
    try {
      await runAuditRetentionSweep(store, logger);
    } finally {
      running = false;
    }
  }
  void purge();
  const timer = setInterval(() => void purge(), HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
