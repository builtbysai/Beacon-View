import type { FastifyBaseLogger } from 'fastify';

import {
  type RecordingKeyCipher,
  recordingKeyContext,
} from './recording-crypto.js';
import type { MilestoneStore } from './store.js';

const DAY = 24 * 60 * 60 * 1_000;

type RewrapStore = Pick<MilestoneStore, 'rewrapRecordingKeys'>;

/**
 * Moves every stored clip and thumbnail key onto the current server key and the
 * recording-bound form (V7). A row that already is, or that cannot be opened at
 * all (reported, never rewritten), is left alone. Safe to run repeatedly.
 */
export async function runRecordingKeyRewrap(
  store: RewrapStore,
  cipher: RecordingKeyCipher,
  logger: FastifyBaseLogger,
): Promise<void> {
  try {
    let unreadable = 0;
    const rewritten = await store.rewrapRecordingKeys((row) => {
      const context = recordingKeyContext(row.recordingId, row.purpose);
      try {
        const opened = cipher.unwrapDetailed(
          { ciphertext: row.ciphertext, iv: row.iv },
          context,
        );
        return opened.current ? null : cipher.wrap(opened.dataKey, context);
      } catch {
        unreadable += 1;
        return null;
      }
    });
    logger.info({ rewritten, unreadable }, 'Recording keys checked');
    if (unreadable > 0)
      logger.warn(
        { unreadable },
        'Some recording keys cannot be opened with the configured keys',
      );
  } catch (error) {
    logger.error({ err: error }, 'Recording key rewrap failed');
  }
}

export function startRecordingKeyRewrapJob(
  store: MilestoneStore,
  cipher: RecordingKeyCipher,
  logger: FastifyBaseLogger,
): () => void {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      await runRecordingKeyRewrap(store, cipher, logger);
    } finally {
      running = false;
    }
  }
  void run();
  const timer = setInterval(() => void run(), DAY);
  timer.unref();
  return () => clearInterval(timer);
}
