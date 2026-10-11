import type { FastifyBaseLogger } from 'fastify';

import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;

type CredentialRetentionStore = Pick<MilestoneStore, 'purgeExpiredCredentials'>;

/** Removes sessions, tokens, pairing codes and links that ended long ago (V5),
 * so those tables do not grow for the life of the database. */
export async function runCredentialRetentionSweep(
  store: CredentialRetentionStore,
  logger: FastifyBaseLogger,
  now = new Date(),
): Promise<void> {
  try {
    const deleted = await store.purgeExpiredCredentials(now);
    logger.info({ deleted }, 'Pruned expired credentials');
  } catch (error) {
    logger.error({ err: error }, 'Expired credential sweep failed');
  }
}

export function startCredentialRetentionJob(
  store: MilestoneStore,
  logger: FastifyBaseLogger,
): () => void {
  let running = false;
  async function purge() {
    if (running) return;
    running = true;
    try {
      await runCredentialRetentionSweep(store, logger);
    } finally {
      running = false;
    }
  }
  void purge();
  const timer = setInterval(() => void purge(), HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
