import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config.js';
import {
  NotificationSender,
  parseRetryAfter,
} from '../src/notification-delivery.js';
import type { NotificationDelivery } from '../src/notification-types.js';

describe('notification Retry-After handling', () => {
  it('accepts delay seconds and HTTP dates', () => {
    const now = Date.parse('2026-09-12T12:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter('Sat, 12 Sep 2026 12:01:00 GMT', now)).toBe(60_000);
  });

  it('ignores invalid values and caps provider delays', () => {
    expect(parseRetryAfter('invalid')).toBeUndefined();
    expect(parseRetryAfter('-1')).toBeUndefined();
    expect(parseRetryAfter('999999')).toBe(2 * 60 * 60 * 1_000);
  });
});

describe('desktop alert delivery', () => {
  const config = {} as AppConfig;
  function desktop(
    overrides: Partial<NotificationDelivery> = {},
  ): NotificationDelivery {
    return {
      attemptCount: 0,
      channel: 'desktop',
      id: 'outbox-1',
      providerMaterial: 'session-1',
      safePayload: {
        category: 'motion',
        eventId: 'event-1',
        route: 'activity',
        version: '1',
      },
      subscriptionId: 'subscription-1',
      ...overrides,
    };
  }

  it('delivers the generic alert to the subscribing session', async () => {
    const transport = vi.fn(() => 1);
    const outcome = await new NotificationSender(config, transport).send(
      desktop(),
    );
    expect(outcome).toEqual({ permanent: false, success: true });
    expect(transport).toHaveBeenCalledWith('session-1', {
      category: 'motion',
      eventId: 'event-1',
      route: '/activity',
      type: 'notification',
    });
  });

  it('retries while the app is offline, then lets a stale alert expire', async () => {
    const sender = new NotificationSender(config, () => 0);
    expect(await sender.send(desktop({ attemptCount: 1 }))).toEqual({
      permanent: false,
      success: false,
    });
    // Motion alerts are useful for about as long as a Web Push TTL (15 min).
    expect(await sender.send(desktop({ attemptCount: 2 }))).toEqual({
      expired: true,
      permanent: false,
      success: false,
    });
    const security = desktop({
      safePayload: {
        category: 'security',
        eventId: 'event-2',
        route: 'settings',
        version: '1',
      },
    });
    expect(await sender.send({ ...security, attemptCount: 2 })).toEqual({
      permanent: false,
      success: false,
    });
    expect(await sender.send({ ...security, attemptCount: 3 })).toEqual({
      expired: true,
      permanent: false,
      success: false,
    });
  });

  it('never reports a permanent failure, which would revoke the subscription', async () => {
    const sender = new NotificationSender(config);
    for (const attemptCount of [0, 1, 2, 3, 4])
      expect((await sender.send(desktop({ attemptCount }))).permanent).toBe(
        false,
      );
  });
});
