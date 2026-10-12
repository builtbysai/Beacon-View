import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { registerNotificationRoutes } from '../src/notification-routes.js';
import { createSessionAuth } from '../src/session-auth.js';
import { hashSecret } from '../src/security.js';
import type { AppConfig } from '../src/config.js';
import type { MilestoneStore } from '../src/store.js';
import { RateLimiter } from '../src/rate-limit.js';

const deviceId = '8dc18bea-7a3b-48ad-b48a-48d00f975f54';
const session = {
  id: 'session',
  userId: 'owner',
  householdId: 'household',
  role: 'owner',
  csrfHash: hashSecret('csrf'),
};
const findSession = vi.fn();
const snoozeMotionAlerts = vi.fn();
const audit = vi.fn();
const config = {
  SESSION_COOKIE_NAME: 'session',
  WEB_ORIGIN: 'https://beacon.test',
} as AppConfig;
const store = {
  findSession,
  snoozeMotionAlerts,
  audit,
} as unknown as MilestoneStore;
const app = Fastify();
const limiter = new RateLimiter();
await app.register(cookie);
registerNotificationRoutes(app, {
  auth: createSessionAuth(config, store),
  store,
  config,
  limiter,
});
beforeEach(() => {
  findSession.mockReset().mockResolvedValue(session);
  snoozeMotionAlerts.mockReset().mockResolvedValue({
    deviceId,
    motionSnoozedUntil: '2026-10-09T13:00:00Z',
  });
  audit.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  limiter.close();
  await app.close();
});
const headers = {
  cookie: 'session=session-token; beacon_csrf=csrf',
  origin: 'https://beacon.test',
  'x-csrf-token': 'csrf',
};
const url = `/api/notification-preferences/${deviceId}/motion-snooze`;

it('binds the personal snooze to the authenticated account and household', async () => {
  for (const minutes of [0, 15, 30, 60]) {
    const response = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: { minutes },
    });
    expect(response.statusCode).toBe(200);
    expect(snoozeMotionAlerts).toHaveBeenLastCalledWith({
      userId: 'owner',
      householdId: 'household',
      publicDeviceId: deviceId,
      minutes,
      now: expect.any(Date) as Date,
    });
  }
  expect(audit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      eventType: 'notification_preference_changed',
      userId: 'owner',
    }),
  );
});

it('rejects invalid durations and identity fields without changing preferences', async () => {
  for (const payload of [
    { minutes: -1 },
    { minutes: 120 },
    { minutes: '15' },
    { minutes: 15, userId: 'other' },
    { until: '2099-01-01' },
  ]) {
    expect(
      (await app.inject({ method: 'PUT', url, headers, payload })).statusCode,
    ).toBe(400);
  }
  expect(snoozeMotionAlerts).not.toHaveBeenCalled();
});

it('requires a current manager session and CSRF for cookie requests', async () => {
  findSession.mockResolvedValueOnce(null);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url,
        headers,
        payload: { minutes: 15 },
      })
    ).statusCode,
  ).toBe(401);
  findSession.mockResolvedValueOnce({ ...session, role: 'guest' });
  expect(
    (
      await app.inject({
        method: 'PUT',
        url,
        headers,
        payload: { minutes: 15 },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url,
        headers: {
          cookie: 'session=token; beacon_csrf=csrf',
          origin: 'https://beacon.test',
        },
        payload: { minutes: 15 },
      })
    ).statusCode,
  ).toBe(403);
  expect(snoozeMotionAlerts).not.toHaveBeenCalled();
});

it('does not expose or mutate a foreign camera', async () => {
  snoozeMotionAlerts.mockResolvedValueOnce(null);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url,
        headers,
        payload: { minutes: 15 },
      })
    ).statusCode,
  ).toBe(404);
  expect(audit).not.toHaveBeenCalled();
});
