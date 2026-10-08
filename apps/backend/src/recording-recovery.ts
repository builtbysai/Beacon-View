import type { FastifyBaseLogger } from 'fastify';

import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;

type RecordingRecoveryStore = Pick<MilestoneStore, 'recoverStaleRecordings'>;

export async function runRecordingRecoverySweep(
  store: RecordingRecoveryStore,
  logger: FastifyBaseLogger,
  now = new Date(),
): Promise<void> {
  try {
    const recoveredCount = await store.recoverStaleRecordings(now);
    logger.info({ recoveredCount }, 'Marked stale recordings as failed');
  } catch (error) {
    logger.error({ err: error }, 'Recording recovery sweep failed');
  }
}

export function startRecordingRecoveryJob(
  store: MilestoneStore,
  logger: FastifyBaseLogger,
): () => void {
  let running = false;
  async function recover() {
    if (running) return;
    running = true;
    try {
      await runRecordingRecoverySweep(store, logger);
    } finally {
      running = false;
    }
  }
  void recover();
  const timer = setInterval(() => void recover(), HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
