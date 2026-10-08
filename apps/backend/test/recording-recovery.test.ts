import { describe, expect, it, vi } from 'vitest';

import { runRecordingRecoverySweep } from '../src/recording-recovery.js';

describe('recording recovery', () => {
  it('marks stale recording work as failed', async () => {
    const recoverStaleRecordings = vi.fn().mockResolvedValue(3);
    const logger = { error: vi.fn(), info: vi.fn() };
    const now = new Date('2026-09-25T12:00:00.000Z');

    await runRecordingRecoverySweep(
      { recoverStaleRecordings },
      logger as never,
      now,
    );

    expect(recoverStaleRecordings).toHaveBeenCalledWith(now);
    expect(logger.info).toHaveBeenCalledWith(
      { recoveredCount: 3 },
      'Marked stale recordings as failed',
    );
  });

  it('logs a failed sweep without rejecting the job', async () => {
    const error = new Error('database unavailable');
    const logger = { error: vi.fn(), info: vi.fn() };

    await runRecordingRecoverySweep(
      { recoverStaleRecordings: vi.fn().mockRejectedValue(error) },
      logger as never,
    );

    expect(logger.error).toHaveBeenCalledWith(
      { err: error },
      'Recording recovery sweep failed',
    );
  });
});
