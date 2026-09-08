import { describe, expect, it, vi } from 'vitest';

import { runAuditRetentionSweep } from '../src/audit-retention.js';

describe('security audit retention', () => {
  it('removes audit events older than the fixed 90-day window', async () => {
    const purgeExpiredAuditEvents = vi.fn().mockResolvedValue(4);
    const logger = { error: vi.fn(), info: vi.fn() };

    await runAuditRetentionSweep(
      { purgeExpiredAuditEvents },
      logger as never,
      new Date('2026-09-07T00:00:00.000Z'),
    );

    expect(purgeExpiredAuditEvents).toHaveBeenCalledWith(
      new Date('2026-09-07T00:00:00.000Z'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { deletedCount: 4 },
      'Pruned expired security audit events',
    );
  });
});
