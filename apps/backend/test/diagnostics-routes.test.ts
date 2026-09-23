import Fastify from 'fastify';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

import { registerActivityRoutes } from '../src/activity-routes.js';
import type { HouseholdEventHub } from '../src/household-events.js';
import type { SessionAuth } from '../src/session-auth.js';
import type { SignalingHub } from '../src/signaling.js';
import type { MilestoneStore } from '../src/store.js';

const app = Fastify();
const listAccessibleCameras = vi.fn();
const listAccessibleDevices = vi.fn();
registerActivityRoutes(app, {
  auth: {
    authenticateHouseholdAdmin: () =>
      Promise.resolve({
        householdId: 'household-1',
        userId: 'user-1',
        role: 'owner',
      }),
  } as unknown as SessionAuth,
  householdEvents: {} as HouseholdEventHub,
  signaling: {
    cameraStatus: () => ({
      producerConnected: true,
      viewerCount: 1,
      connectionIds: ['connection-1'],
    }),
  } as unknown as SignalingHub,
  store: {
    listAccessibleCameras,
    listAccessibleDevices,
  } as unknown as MilestoneStore,
});

beforeEach(() => {
  listAccessibleCameras.mockReset();
  listAccessibleDevices.mockReset();
});
afterAll(() => app.close());

it('returns the healthy diagnostics section when the other lookup fails', async () => {
  listAccessibleCameras.mockResolvedValue([
    {
      publicCameraId: 'camera-1',
      publicDeviceId: 'device-1',
      capabilities: {},
      facing: 'rear',
      sourceKey: 'browser:rear',
    },
  ]);
  listAccessibleDevices.mockRejectedValue(new Error('Database lookup failed'));

  const response = await app.inject({ method: 'GET', url: '/api/diagnostics' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    unavailable: ['devices'],
    devices: [],
    cameras: [{ cameraId: 'camera-1', viewerCount: 1 }],
  });
  expect(response.body).not.toContain('Database lookup failed');
});

it('returns a retryable error when both diagnostics lookups fail', async () => {
  listAccessibleCameras.mockRejectedValue(new Error('Camera lookup failed'));
  listAccessibleDevices.mockRejectedValue(new Error('Device lookup failed'));

  const response = await app.inject({ method: 'GET', url: '/api/diagnostics' });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ error: 'Diagnostics unavailable' });
});
