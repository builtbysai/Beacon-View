import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

import { registerActivityRoutes } from '../src/activity-routes.js';
import type { HouseholdEventHub } from '../src/household-events.js';
import type { SessionAuth } from '../src/session-auth.js';
import type { SignalingHub } from '../src/signaling.js';
import type { MilestoneStore } from '../src/store.js';

const app = Fastify();
const listHouseholdActivity = vi.fn().mockResolvedValue({
  events: [
    {
      id: 'event-1',
      actorEmail: 'owner@example.com',
      householdId: 'household-1',
      publicDeviceId: 'device-1',
      cameraSourceId: 'source-1',
      deviceName: 'Hallway',
      sourceName: 'Rear camera',
      eventType: 'device_updated',
      occurredAt: new Date('2026-09-22T12:00:00.000Z'),
      success: true,
      metadata: { deviceName: 'Hallway' },
    },
  ],
  total: 1,
});

registerActivityRoutes(app, {
  auth: {
    authenticate: (request: FastifyRequest) =>
      Promise.resolve({
        householdId: 'household-1',
        role: request.headers['x-test-role'] ?? 'owner',
      }),
  } as unknown as SessionAuth,
  householdEvents: {} as HouseholdEventHub,
  signaling: {} as SignalingHub,
  store: { listHouseholdActivity } as unknown as MilestoneStore,
});

afterEach(() => vi.clearAllMocks());
afterAll(() => app.close());

it('does not expose household activity to a viewer', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/activity',
    headers: { 'x-test-role': 'viewer' },
  });

  expect(response.statusCode).toBe(403);
  expect(listHouseholdActivity).not.toHaveBeenCalled();
});

it('returns structured household activity to an owner', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/activity?limit=5&eventType=device_updated',
  });

  expect(response.statusCode).toBe(200);
  expect(listHouseholdActivity).toHaveBeenCalledWith('household-1', {
    limit: 5,
    eventTypes: ['device_updated'],
  });
  expect(response.json()).toEqual({
    events: [
      {
        id: 'event-1',
        actorEmail: 'owner@example.com',
        householdId: 'household-1',
        publicDeviceId: 'device-1',
        cameraSourceId: 'source-1',
        deviceName: 'Hallway',
        sourceName: 'Rear camera',
        eventType: 'device_updated',
        occurredAt: '2026-09-22T12:00:00.000Z',
        success: true,
        metadata: { deviceName: 'Hallway' },
      },
    ],
    total: 1,
  });
});
