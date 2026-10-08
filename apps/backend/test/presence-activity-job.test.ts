import { expect, it, vi } from 'vitest';

import type { HouseholdEventHub } from '../src/household-events.js';
import { runPresenceActivitySweep } from '../src/presence-activity-job.js';
import type { MilestoneStore } from '../src/store.js';
import type { FastifyBaseLogger } from 'fastify';

it('broadcasts one household refresh for each household with an offline transition', async () => {
  const publish = vi.fn();
  const now = new Date('2026-09-22T12:00:00Z');
  const scanDevicePresenceActivity = vi
    .fn()
    .mockResolvedValue(['household-one', 'household-two']);
  await runPresenceActivitySweep(
    { scanDevicePresenceActivity } as unknown as MilestoneStore,
    { info: vi.fn() } as unknown as FastifyBaseLogger,
    { publish } as unknown as HouseholdEventHub,
    now,
  );
  expect(scanDevicePresenceActivity).toHaveBeenCalledWith(now, 120_000);
  expect(publish.mock.calls).toEqual([
    ['household-one', { type: 'device-management-changed' }],
    ['household-two', { type: 'device-management-changed' }],
  ]);
});
