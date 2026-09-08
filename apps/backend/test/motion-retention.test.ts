import { describe, expect, it, vi } from 'vitest';
import { runMotionRetentionSweep } from '../src/motion-retention.js';

describe('motion metadata retention', () => {
  it('audits deletion counts without retaining event content', async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const purgeExpiredMotionEvents = vi
      .fn()
      .mockResolvedValue([{ householdId: 'household-1', deletedCount: 3 }]);
    const logger = { error: vi.fn(), info: vi.fn() };

    await runMotionRetentionSweep(
      { audit, purgeExpiredMotionEvents },
      logger as never,
      new Date('2026-09-06T00:00:00Z'),
    );

    expect(audit).toHaveBeenCalledWith({
      eventType: 'motion_history_retention_pruned',
      householdId: 'household-1',
      metadata: { deletedCount: '3' },
      success: true,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { householdId: 'household-1', deletedCount: 3 },
      'Pruned expired motion metadata',
    );
  });

  it('logs a failed sweep and leaves no partial audit trail', async () => {
    const audit = vi.fn();
    const error = new Error('database unavailable');
    const logger = { error: vi.fn(), info: vi.fn() };
    await runMotionRetentionSweep(
      { audit, purgeExpiredMotionEvents: vi.fn().mockRejectedValue(error) },
      logger as never,
    );
    expect(audit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { err: error },
      'Motion metadata retention sweep failed',
    );
  });
});
