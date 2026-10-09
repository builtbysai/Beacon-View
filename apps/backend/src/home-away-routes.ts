import type { FastifyInstance } from 'fastify';

import { modeSettingsSchema, setModeSchema } from './home-away.js';
import type { HouseholdEventHub } from './household-events.js';
import type { HouseholdModeChange } from './postgres-household-mode-repository.js';
import type { SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Applies any schedule changes that are due (ADR 0094). */
    runHouseholdModeSchedule(now?: Date): Promise<number>;
  }
}

export function registerHouseholdModeRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: SessionAuth;
    householdEvents: HouseholdEventHub;
    signaling: SignalingHub;
    store: MilestoneStore;
  },
): void {
  const { auth, householdEvents, signaling, store } = dependencies;

  /** Tells cameras and open viewers what a mode change did. */
  function announce(change: HouseholdModeChange): void {
    for (const cameraId of change.paused)
      signaling.setPrivacyMode(cameraId, true);
    for (const cameraId of change.resumed)
      signaling.setPrivacyMode(cameraId, false);
    householdEvents.publish(change.householdId, {
      type: 'household-mode-changed',
    });
    if (change.paused.length > 0 || change.resumed.length > 0)
      householdEvents.publish(change.householdId, {
        type: 'device-management-changed',
      });
  }

  function present(change: HouseholdModeChange['record']) {
    return {
      mode: change.mode,
      source: change.source,
      changedAt: change.changedAt.toISOString(),
      settings: change.settings,
    };
  }

  app.get('/api/household/mode', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    const record = await store.getHouseholdMode(session.householdId);
    return {
      ...present(record),
      canChange: session.role === 'owner' || session.role === 'admin',
    };
  });

  app.put('/api/household/mode', async (request, reply) => {
    const session = await auth.authenticateHouseholdAdminStateChange(
      request,
      reply,
    );
    if (!session) return;
    const body = setModeSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Invalid household mode' });
    const change = await store.setHouseholdMode(
      session.householdId,
      body.data.mode,
      session.userId,
    );
    await store.audit({
      eventType: 'household_mode_changed',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: {
        mode: change.record.mode,
        source: 'manual',
        paused: String(change.paused.length),
        resumed: String(change.resumed.length),
      },
      success: true,
      userId: session.userId,
    });
    announce(change);
    return { ...present(change.record), canChange: true };
  });

  app.put('/api/household/mode-settings', async (request, reply) => {
    const session = await auth.authenticateHouseholdAdminStateChange(
      request,
      reply,
    );
    if (!session) return;
    const body = modeSettingsSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Invalid household mode settings' });
    const change = await store.saveHouseholdModeSettings(
      session.householdId,
      body.data,
    );
    await store.audit({
      eventType: 'household_mode_settings_changed',
      householdId: session.householdId,
      ipAddress: request.ip,
      metadata: {
        mode: change.record.mode,
        scheduled: String(body.data.schedule !== null),
      },
      success: true,
      userId: session.userId,
    });
    announce(change);
    return { ...present(change.record), canChange: true };
  });

  app.decorate('runHouseholdModeSchedule', async (now = new Date()) => {
    const changes = await store.scanHouseholdModeSchedules(now);
    for (const change of changes) {
      await store.audit({
        eventType: 'household_mode_changed',
        householdId: change.householdId,
        metadata: {
          mode: change.record.mode,
          source: 'schedule',
          paused: String(change.paused.length),
          resumed: String(change.resumed.length),
        },
        success: true,
      });
      announce(change);
    }
    return changes.length;
  });
}
