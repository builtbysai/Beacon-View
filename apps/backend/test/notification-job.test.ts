import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { runNotificationSweep } from '../src/notification-job.js';
import type {
  NotificationDelivery,
  NotificationDeliveryOutcome,
} from '../src/notification-types.js';
import type { MilestoneStore } from '../src/store.js';

function delivery(
  overrides: Partial<NotificationDelivery>,
): NotificationDelivery {
  return {
    attemptCount: 0,
    channel: 'fcm',
    id: 'event-id',
    providerMaterial: 'super-secret-provider-token',
    safePayload: { category: 'motion' },
    subscriptionId: 'subscription-id',
    ...overrides,
  };
}

describe('runNotificationSweep', () => {
  it('logs a safe per-run summary broken down by outcome, channel and category', async () => {
    const deliveries: NotificationDelivery[] = [
      delivery({ channel: 'fcm', id: 'd1', safePayload: { category: 'motion' } }),
      delivery({
        channel: 'fcm',
        id: 'd2',
        safePayload: { category: 'motion' },
      }),
      delivery({
        channel: 'web_push',
        id: 'd3',
        safePayload: { category: 'offline' },
      }),
      delivery({
        channel: 'web_push',
        id: 'd4',
        safePayload: { category: 'security' },
      }),
    ];
    const outcomes = new Map<string, NotificationDeliveryOutcome>([
      ['d1', { permanent: false, success: true }],
      ['d2', { permanent: false, success: false }],
      ['d3', { permanent: true, success: false }],
      ['d4', { permanent: false, success: true }],
    ]);
    const sender = {
      send: vi.fn((input: NotificationDelivery) =>
        Promise.resolve(outcomes.get(input.id)!),
      ),
    };
    const markDelivered = vi.fn(() => Promise.resolve());
    const markFailed = vi.fn(() => Promise.resolve());
    const store = {
      claimNotificationDeliveries: () => Promise.resolve(deliveries),
      markNotificationDelivered: markDelivered,
      markNotificationFailed: markFailed,
      scanNotificationPresence: () => Promise.resolve(),
    } as unknown as MilestoneStore;
    const info = vi.fn();
    const logger = { info } as unknown as FastifyBaseLogger;
    const now = new Date('2026-09-15T12:00:00Z');

    await runNotificationSweep(store, sender, logger, now, 120);

    expect(sender.send).toHaveBeenCalledTimes(4);
    expect(markDelivered).toHaveBeenCalledTimes(2);
    expect(markFailed).toHaveBeenCalledTimes(2);
    expect(markFailed).toHaveBeenCalledWith('d2', 'subscription-id', now, false, undefined);
    expect(markFailed).toHaveBeenCalledWith('d3', 'subscription-id', now, true, undefined);

    expect(info).toHaveBeenCalledTimes(1);
    const [summary, message] = info.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(message).toBe('Processed notification delivery batch');
    expect(summary).toEqual({
      byCategory: { motion: 2, offline: 1, security: 1 },
      byChannel: { fcm: 2, web_push: 2 },
      delivered: 2,
      deliveryCount: 4,
      failedPermanent: 1,
      failedRetryable: 1,
    });
    expect(JSON.stringify(summary)).not.toContain('super-secret-provider-token');
  });

  it('does not log anything for an empty sweep', async () => {
    const store = {
      claimNotificationDeliveries: () => Promise.resolve([]),
      scanNotificationPresence: () => Promise.resolve(),
    } as unknown as MilestoneStore;
    const info = vi.fn();
    const logger = { info } as unknown as FastifyBaseLogger;

    await runNotificationSweep(
      store,
      { send: vi.fn() },
      logger,
      new Date(),
      120,
    );

    expect(info).not.toHaveBeenCalled();
  });
});
