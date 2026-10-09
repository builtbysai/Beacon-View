import Fastify from 'fastify';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

import { registerDeviceRuntimeRoutes } from '../src/device-runtime-routes.js';
import type { HouseholdEventHub } from '../src/household-events.js';
import type { SessionAuth } from '../src/session-auth.js';
import type { SignalingHub } from '../src/signaling.js';
import type { MilestoneStore } from '../src/store.js';

const app = Fastify();
const publish = vi.fn();
const identity = {
  cameraId: 'source-db-id',
  deviceId: 'device-db-id',
  householdId: 'household-id',
  publicCameraId: 'source-public-id',
  publicDeviceId: 'device-public-id',
  lastSeenAt: new Date(),
  batteryPercent: 82,
  batteryCharging: true,
  thermalStatus: null,
};
const findDeviceByCredential = vi.fn().mockResolvedValue(identity);
const recordDeviceRecoveredIfOffline = vi.fn().mockResolvedValue(false);
registerDeviceRuntimeRoutes(app, {
  auth: {} as SessionAuth,
  householdEvents: { publish } as unknown as HouseholdEventHub,
  signaling: {} as SignalingHub,
  store: {
    findDeviceByCredential,
    heartbeat: vi.fn().mockResolvedValue('device-db-id'),
    recordDeviceRecoveredIfOffline,
  } as unknown as MilestoneStore,
});

afterEach(() => {
  vi.clearAllMocks();
  findDeviceByCredential.mockResolvedValue({
    ...identity,
    lastSeenAt: new Date(),
  });
  recordDeviceRecoveredIfOffline.mockResolvedValue(false);
});
afterAll(() => app.close());

async function heartbeat() {
  return app.inject({
    method: 'POST',
    url: '/api/device/heartbeat',
    headers: { authorization: 'Bearer device-test-token' },
    payload: { batteryPercent: 82, batteryCharging: true },
  });
}

it('does not broadcast an unchanged heartbeat', async () => {
  expect((await heartbeat()).statusCode).toBe(204);
  expect(publish).not.toHaveBeenCalled();
});

it('broadcasts a stale-to-online transition and a recorded recovery', async () => {
  findDeviceByCredential.mockResolvedValueOnce({
    ...identity,
    lastSeenAt: new Date(Date.now() - 91_000),
  });
  recordDeviceRecoveredIfOffline.mockResolvedValueOnce(true);
  expect((await heartbeat()).statusCode).toBe(204);
  expect(publish).toHaveBeenCalledWith('household-id', {
    cameraId: 'source-public-id',
    type: 'camera-presence-changed',
  });
  expect(publish).toHaveBeenCalledWith('household-id', {
    type: 'device-management-changed',
  });
});

it('broadcasts a device health change', async () => {
  findDeviceByCredential.mockResolvedValueOnce({
    ...identity,
    batteryPercent: 81,
  });
  expect((await heartbeat()).statusCode).toBe(204);
  expect(publish).toHaveBeenCalledTimes(1);
});
