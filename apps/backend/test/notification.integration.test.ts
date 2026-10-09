import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { hashSecret } from '../src/security.js';
import { PostgresStore } from '../src/store.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

const databaseUrl = testDatabaseUrl();
const store = databaseUrl
  ? new PostgresStore(databaseUrl, {
      encryptionKey: randomBytes(32).toString('base64url'),
      fingerprintKey: randomBytes(32).toString('base64url'),
    })
  : null;

async function fixture() {
  const owner = await store!.createAccount(
    'notifications@example.com',
    'irrelevant-test-hash',
    '127.0.0.1',
  );
  const now = new Date('2026-09-11T12:00:00Z');
  await store!.createSession({
    absoluteExpiresAt: new Date(now.getTime() + 86_400_000),
    csrfHash: hashSecret('notification-csrf'),
    idleExpiresAt: new Date(now.getTime() + 86_400_000),
    tokenHash: hashSecret('notification-session'),
    userId: owner.id,
  });
  const session = await store!.pool.query<{ id: string }>(
    'SELECT id FROM browser_sessions WHERE user_id=$1',
    [owner.id],
  );
  await store!.createPairingCode(
    owner.householdId,
    hashSecret('NOTIFY1234'),
    new Date(now.getTime() + 60_000),
  );
  const device = await store!.redeemPairingCode({
    codeHash: hashSecret('NOTIFY1234'),
    credentialHash: hashSecret('notification-device-credential'),
    installationId: randomUUID(),
    ipAddress: '127.0.0.1',
    name: 'Notification camera',
    now,
  });
  if (!device || typeof device === 'string') throw new Error('Expected device');
  return { device, now, owner, sessionId: session.rows[0]!.id };
}

describe.skipIf(!store)('notification transport persistence', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => store?.close());

  it('encrypts subscriptions, atomically deduplicates motion outbox rows, and revokes with the session', async () => {
    const { device, now, owner, sessionId } = await fixture();
    const providerToken = 'provider-token-that-must-not-be-stored-in-plaintext';
    await store!.upsertNotificationSubscription({
      channel: 'fcm',
      consentedAt: now,
      deviceLabel: 'Pixel test',
      installationId: randomUUID(),
      providerMaterial: providerToken,
      sessionId,
      userId: owner.id,
    });
    await store!.updateNotificationPreference({
      userId: owner.id,
      householdId: owner.householdId,
      publicDeviceId: device.publicDeviceId,
      motionEnabled: true,
      offlineEnabled: false,
      quietHours: null,
    });
    await Promise.all([
      store!.createMotionEvent({
        credentialHash: hashSecret('notification-device-credential'),
        publicCameraId: device.publicCameraId,
        confidence: 0.8,
        now,
      }),
      store!.createMotionEvent({
        credentialHash: hashSecret('notification-device-credential'),
        publicCameraId: device.publicCameraId,
        confidence: 0.8,
        now,
      }),
    ]);
    const persisted = await store!.pool.query<{
      ciphertext: string;
      eventCount: number;
      outboxCount: number;
    }>(
      `SELECT encode((SELECT provider_ciphertext FROM notification_subscriptions LIMIT 1), 'base64') AS ciphertext,
              (SELECT count(*)::int FROM notification_events) AS "eventCount",
              (SELECT count(*)::int FROM notification_outbox) AS "outboxCount"`,
    );
    expect(persisted.rows[0]!.ciphertext).not.toContain(providerToken);
    expect(persisted.rows[0]).toMatchObject({ eventCount: 1, outboxCount: 1 });
    await store!.revokeSession(sessionId);
    const active = await store!.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notification_subscriptions WHERE revoked_at IS NULL',
    );
    expect(active.rows[0]!.count).toBe(0);
  });

  it('defaults a newly paired device to motion and offline notifications on, before the owner ever visits Settings', async () => {
    const { device, owner } = await fixture();

    const preferences = await store!.listNotificationPreferences(
      owner.id,
      owner.householdId,
    );

    expect(preferences).toEqual([
      expect.objectContaining({
        deviceId: device.publicDeviceId,
        motionEnabled: true,
        offlineEnabled: true,
      }),
    ]);
  });

  it('persists notification quiet hours and suppresses only alerts inside the selected time zone window', async () => {
    const { device, now, owner, sessionId } = await fixture();
    await store!.upsertNotificationSubscription({
      channel: 'fcm',
      consentedAt: now,
      deviceLabel: 'Quiet hours test',
      installationId: randomUUID(),
      providerMaterial: 'quiet-hours-provider-token',
      sessionId,
      userId: owner.id,
    });
    const quietHours = {
      start: '07:00',
      end: '09:00',
      timeZone: 'America/New_York',
    };
    await store!.updateNotificationPreference({
      userId: owner.id,
      householdId: owner.householdId,
      publicDeviceId: device.publicDeviceId,
      motionEnabled: true,
      offlineEnabled: false,
      quietHours,
    });
    expect(
      (await store!.listNotificationPreferences(owner.id, owner.householdId))[0]
        ?.quietHours,
    ).toEqual(quietHours);

    await store!.createMotionEvent({
      credentialHash: hashSecret('notification-device-credential'),
      publicCameraId: device.publicCameraId,
      confidence: 0.8,
      now,
    });
    expect(
      (await store!.pool.query('SELECT id FROM motion_events')).rowCount,
    ).toBe(1);
    expect(
      (await store!.pool.query('SELECT id FROM notification_events')).rowCount,
    ).toBe(0);

    await store!.createMotionEvent({
      credentialHash: hashSecret('notification-device-credential'),
      publicCameraId: device.publicCameraId,
      confidence: 0.8,
      now: new Date(now.getTime() + 2 * 60 * 60 * 1_000),
    });
    expect(
      (await store!.pool.query('SELECT id FROM notification_events')).rowCount,
    ).toBe(1);
  });

  it('atomically terminals an invalid delivery and revokes its provider registration', async () => {
    const { device, now, owner, sessionId } = await fixture();
    const subscriptionId = await store!.upsertNotificationSubscription({
      channel: 'fcm',
      consentedAt: now,
      deviceLabel: 'Invalid provider test',
      installationId: randomUUID(),
      providerMaterial: 'provider-registration-that-is-now-invalid',
      sessionId,
      userId: owner.id,
    });
    await store!.updateNotificationPreference({
      userId: owner.id,
      householdId: owner.householdId,
      publicDeviceId: device.publicDeviceId,
      motionEnabled: true,
      offlineEnabled: false,
      quietHours: null,
    });
    await store!.createMotionEvent({
      credentialHash: hashSecret('notification-device-credential'),
      publicCameraId: device.publicCameraId,
      confidence: 0.8,
      now,
    });
    await store!.pool.query(
      'UPDATE notification_outbox SET next_attempt_at=$1',
      [now],
    );
    const [delivery] = await store!.claimNotificationDeliveries(now);
    expect(delivery).toBeDefined();
    await store!.markNotificationFailed(
      delivery!.id,
      subscriptionId,
      new Date(now.getTime() + 1_000),
      true,
    );
    const state = await store!.pool.query<{
      revoked: boolean;
      terminal: boolean;
    }>(
      `SELECT ns.revoked_at IS NOT NULL AS revoked, no.terminal_at IS NOT NULL AS terminal
       FROM notification_subscriptions ns JOIN notification_outbox no ON no.subscription_id=ns.id
       WHERE ns.id=$1`,
      [subscriptionId],
    );
    expect(state.rows[0]).toEqual({ revoked: true, terminal: true });
  });

  it('tells an alert’s owner which camera it was about, and no one else', async () => {
    const { device, now, owner, sessionId } = await fixture();
    await store!.upsertNotificationSubscription({
      channel: 'fcm',
      consentedAt: now,
      deviceLabel: 'Pixel test',
      installationId: randomUUID(),
      providerMaterial: 'provider-token-for-alert-lookup-testing',
      sessionId,
      userId: owner.id,
    });
    await store!.updateNotificationPreference({
      userId: owner.id,
      householdId: owner.householdId,
      publicDeviceId: device.publicDeviceId,
      motionEnabled: true,
      offlineEnabled: false,
      quietHours: null,
    });
    await store!.createMotionEvent({
      credentialHash: hashSecret('notification-device-credential'),
      publicCameraId: device.publicCameraId,
      confidence: 0.8,
      now,
    });
    const created = await store!.pool.query<{ id: string }>(
      "SELECT id FROM notification_events WHERE category='motion'",
    );
    const eventId = created.rows[0]!.id;
    expect(await store!.findNotificationEvent(owner.id, eventId)).toEqual({
      category: 'motion',
      publicCameraId: device.publicCameraId,
    });
    const stranger = await store!.createAccount(
      'stranger@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    expect(await store!.findNotificationEvent(stranger.id, eventId)).toBeNull();
    expect(
      await store!.findNotificationEvent(owner.id, randomUUID()),
    ).toBeNull();
  });

  describe('health alerts (ADR 0093)', () => {
    async function watched(
      quietHours: {
        end: string;
        start: string;
        timeZone: string;
      } | null = null,
    ) {
      const setup = await fixture();
      await store!.upsertNotificationSubscription({
        channel: 'fcm',
        consentedAt: setup.now,
        deviceLabel: 'Pixel test',
        installationId: randomUUID(),
        providerMaterial: 'provider-token-for-health-alert-testing',
        sessionId: setup.sessionId,
        userId: setup.owner.id,
      });
      await store!.updateNotificationPreference({
        userId: setup.owner.id,
        householdId: setup.owner.householdId,
        publicDeviceId: setup.device.publicDeviceId,
        motionEnabled: false,
        offlineEnabled: true,
        quietHours,
      });
      let minute = 0;
      const report = async (
        battery: number | null,
        charging: boolean | null,
        thermal: string | null,
        ageMinutes = 0,
      ) => {
        minute += 1;
        const at = new Date(setup.now.getTime() + minute * 60_000);
        await store!.pool.query(
          `UPDATE cameras SET battery_percent=$2, battery_charging=$3, thermal_status=$4,
             health_reported_at=$5 WHERE id=$1`,
          [
            setup.device.id,
            battery,
            charging,
            thermal,
            new Date(at.getTime() - ageMinutes * 60_000),
          ],
        );
        await store!.scanNotificationHealth(at);
      };
      const alerts = async () =>
        (
          await store!.pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM notification_events WHERE category='health'",
          )
        ).rows[0]!.n;
      return { alerts, report, setup };
    }

    it('alerts once when the battery runs low, not again while it stays low, and again after a recovery', async () => {
      const { alerts, report } = await watched();
      await report(40, false, 'none');
      expect(await alerts()).toBe(0);
      await report(12, false, 'none');
      expect(await alerts()).toBe(1);
      await report(11, false, 'none');
      await report(9, false, 'none');
      expect(await alerts()).toBe(1);
      // Hovering just above the limit is not a recovery.
      await report(20, false, 'none');
      await report(14, false, 'none');
      expect(await alerts()).toBe(1);
      // Charging (or climbing well past the limit) clears it.
      await report(14, true, 'none');
      await report(10, false, 'none');
      expect(await alerts()).toBe(2);
      await report(60, false, 'none');
      await report(8, false, 'none');
      expect(await alerts()).toBe(3);
    });

    it('does not alert for a low battery that is charging', async () => {
      const { alerts, report } = await watched();
      await report(5, true, 'none');
      expect(await alerts()).toBe(0);
    });

    it('alerts once per overheating episode and clears when it cools to moderate', async () => {
      const { alerts, report } = await watched();
      await report(80, false, 'moderate');
      expect(await alerts()).toBe(0);
      await report(80, false, 'severe');
      await report(80, false, 'critical');
      expect(await alerts()).toBe(1);
      // Easing from critical to severe is still hot.
      await report(80, false, 'severe');
      expect(await alerts()).toBe(1);
      await report(80, false, 'moderate');
      await report(80, false, 'emergency');
      expect(await alerts()).toBe(2);
    });

    it('ignores health that has gone stale (the offline alert covers a silent camera)', async () => {
      const { alerts, report } = await watched();
      await report(5, false, 'critical', 11);
      expect(await alerts()).toBe(0);
    });

    it('stays silent during quiet hours and does not fire the same episode afterwards', async () => {
      // The fixture clock is 12:00 UTC; these quiet hours cover the whole day.
      const { alerts, report } = await watched({
        end: '23:59',
        start: '00:00',
        timeZone: 'UTC',
      });
      await report(5, false, 'none');
      expect(await alerts()).toBe(0);
      await report(5, false, 'none');
      expect(await alerts()).toBe(0);
    });

    it('only tells people who turned the camera’s attention alerts on', async () => {
      const setup = await fixture();
      await store!.upsertNotificationSubscription({
        channel: 'fcm',
        consentedAt: setup.now,
        deviceLabel: 'Pixel test',
        installationId: randomUUID(),
        providerMaterial: 'provider-token-for-health-optout-testing',
        sessionId: setup.sessionId,
        userId: setup.owner.id,
      });
      await store!.updateNotificationPreference({
        userId: setup.owner.id,
        householdId: setup.owner.householdId,
        publicDeviceId: setup.device.publicDeviceId,
        motionEnabled: true,
        offlineEnabled: false,
        quietHours: null,
      });
      await store!.pool.query(
        `UPDATE cameras SET battery_percent=3, battery_charging=false,
           thermal_status='critical', health_reported_at=$2 WHERE id=$1`,
        [setup.device.id, setup.now],
      );
      await store!.scanNotificationHealth(setup.now);
      expect(
        (
          await store!.pool.query(
            "SELECT id FROM notification_events WHERE category='health'",
          )
        ).rowCount,
      ).toBe(0);
    });
  });

  it('waits for the presence window plus grace, emits one offline transition, and recovers once', async () => {
    const { device, now, owner, sessionId } = await fixture();
    await store!.upsertNotificationSubscription({
      channel: 'fcm',
      consentedAt: now,
      deviceLabel: 'Pixel test',
      installationId: randomUUID(),
      providerMaterial: 'another-provider-token-for-presence-testing',
      sessionId,
      userId: owner.id,
    });
    await store!.updateNotificationPreference({
      userId: owner.id,
      householdId: owner.householdId,
      publicDeviceId: device.publicDeviceId,
      motionEnabled: false,
      offlineEnabled: true,
      quietHours: null,
    });
    await store!.pool.query('UPDATE cameras SET last_seen_at=$2 WHERE id=$1', [
      device.id,
      now,
    ]);
    await store!.scanNotificationPresence(
      new Date(now.getTime() + 209_999),
      120,
    );
    expect(
      (await store!.pool.query('SELECT id FROM notification_events')).rowCount,
    ).toBe(0);
    await store!.scanNotificationPresence(
      new Date(now.getTime() + 210_000),
      120,
    );
    await store!.scanNotificationPresence(
      new Date(now.getTime() + 300_000),
      120,
    );
    expect(
      (
        await store!.pool.query(
          "SELECT id FROM notification_events WHERE category='offline'",
        )
      ).rowCount,
    ).toBe(1);
    await store!.pool.query('UPDATE cameras SET last_seen_at=$2 WHERE id=$1', [
      device.id,
      new Date(now.getTime() + 300_000),
    ]);
    await store!.scanNotificationPresence(
      new Date(now.getTime() + 300_001),
      120,
    );
    await store!.scanNotificationPresence(
      new Date(now.getTime() + 300_002),
      120,
    );
    expect(
      (
        await store!.pool.query(
          "SELECT id FROM notification_events WHERE category='recovered'",
        )
      ).rowCount,
    ).toBe(1);
  });

  it('records device presence activity once per offline and recovery transition', async () => {
    const { device, now, owner } = await fixture();
    await store!.pool.query('UPDATE cameras SET last_seen_at=$2 WHERE id=$1', [
      device.id,
      now,
    ]);
    expect(
      await store!.scanDevicePresenceActivity(
        new Date(now.getTime() + 119_999),
        120_000,
      ),
    ).toEqual([]);
    const offlineAt = new Date(now.getTime() + 120_001);
    expect(
      (
        await Promise.all([
          store!.scanDevicePresenceActivity(offlineAt, 120_000),
          store!.scanDevicePresenceActivity(offlineAt, 120_000),
        ])
      ).flat(),
    ).toEqual([owner.householdId]);
    const recovery = {
      cameraId: device.id,
      householdId: owner.householdId,
      publicDeviceId: device.publicDeviceId,
      now: new Date(now.getTime() + 120_002),
    };
    expect(
      (
        await Promise.all([
          store!.recordDeviceRecoveredIfOffline(recovery),
          store!.recordDeviceRecoveredIfOffline(recovery),
        ])
      ).filter(Boolean),
    ).toHaveLength(1);
    await store!.pool.query('UPDATE cameras SET last_seen_at=$2 WHERE id=$1', [
      device.id,
      new Date(now.getTime() + 120_002),
    ]);
    expect(
      await store!.scanDevicePresenceActivity(
        new Date(now.getTime() + 240_004),
        120_000,
      ),
    ).toEqual([owner.householdId]);
    expect(
      (
        await store!.listHouseholdActivity(owner.householdId, {
          eventTypes: ['device_offline', 'device_recovered'],
        })
      ).events.map((event) => event.eventType),
    ).toEqual(['device_offline', 'device_recovered', 'device_offline']);
  });

  it('delivers a security event to every active subscription with no preference to disable it', async () => {
    const { now, owner, sessionId } = await fixture();
    await store!.upsertNotificationSubscription({
      channel: 'fcm',
      consentedAt: now,
      deviceLabel: 'Security event test',
      installationId: randomUUID(),
      providerMaterial: 'security-event-provider-token',
      sessionId,
      userId: owner.id,
    });
    // Deliberately no notification_preferences row at all, and no motion/
    // offline opt-in -- unlike motion/offline/recovered, a security event
    // has nothing it could join against to be silenced by.
    await store!.recordSecurityEvent({
      now,
      securityEventType: 'sign_in',
      userId: owner.id,
    });
    const rows = await store!.pool.query<{
      category: string;
      outboxCount: number;
    }>(
      `SELECT category, (SELECT count(*)::int FROM notification_outbox WHERE event_id = e.id) AS "outboxCount"
       FROM notification_events e WHERE user_id = $1`,
      [owner.id],
    );
    expect(rows.rows).toEqual([{ category: 'security', outboxCount: 1 }]);
  });

  it('persists an administrator preference for the active household and delivers that user motion alerts', async () => {
    const { device, now, owner } = await fixture();
    const admin = await store!.createAccount(
      'notifications-admin@example.com',
      'irrelevant-test-hash',
      '127.0.0.2',
    );
    await store!.pool.query(
      `INSERT INTO household_members (household_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [owner.householdId, admin.id],
    );
    await store!.createSession({
      absoluteExpiresAt: new Date(now.getTime() + 86_400_000),
      csrfHash: hashSecret('notification-admin-csrf'),
      idleExpiresAt: new Date(now.getTime() + 86_400_000),
      tokenHash: hashSecret('notification-admin-session'),
      userId: admin.id,
    });
    const session = await store!.pool.query<{ id: string }>(
      'SELECT id FROM browser_sessions WHERE user_id=$1',
      [admin.id],
    );
    await store!.upsertNotificationSubscription({
      channel: 'web_push',
      consentedAt: now,
      deviceLabel: 'Admin browser',
      installationId: randomUUID(),
      providerMaterial: JSON.stringify({
        endpoint: 'https://push.example/admin',
      }),
      sessionId: session.rows[0]!.id,
      userId: admin.id,
    });
    expect(
      await store!.listNotificationPreferences(admin.id, owner.householdId),
    ).toEqual([
      expect.objectContaining({
        deviceId: device.publicDeviceId,
        motionEnabled: false,
      }),
    ]);
    await store!.updateNotificationPreference({
      userId: admin.id,
      householdId: owner.householdId,
      publicDeviceId: device.publicDeviceId,
      motionEnabled: true,
      offlineEnabled: false,
      quietHours: null,
    });
    await store!.createMotionEvent({
      credentialHash: hashSecret('notification-device-credential'),
      publicCameraId: device.publicCameraId,
      confidence: 0.8,
      now,
    });
    const deliveredFor = await store!.pool.query<{ userId: string }>(
      `SELECT DISTINCT ne.user_id AS "userId"
       FROM notification_events ne JOIN notification_outbox no ON no.event_id=ne.id`,
    );
    expect(deliveredFor.rows).toEqual([{ userId: admin.id }]);

    await store!.pool.query(
      `INSERT INTO notification_presence_state (user_id, device_id)
       VALUES ($1,$3),($2,$3)`,
      [owner.id, admin.id, device.id],
    );
    await store!.updateNotificationPreference({
      userId: admin.id,
      householdId: owner.householdId,
      publicDeviceId: device.publicDeviceId,
      motionEnabled: true,
      offlineEnabled: false,
      quietHours: null,
    });
    expect(
      (
        await store!.pool.query<{ userId: string }>(
          `SELECT user_id AS "userId" FROM notification_presence_state
           WHERE device_id=$1 ORDER BY user_id`,
          [device.id],
        )
      ).rows,
    ).toEqual([{ userId: owner.id }]);

    // The admin still has an active session and subscription in their own
    // household. Revoking this household must stop both queued and new alerts.
    await store!.pool.query(
      `UPDATE household_members SET status='revoked', revoked_at=$3
       WHERE household_id=$1 AND user_id=$2`,
      [owner.householdId, admin.id, now],
    );
    await store!.pool.query(
      'UPDATE notification_outbox SET next_attempt_at=$1',
      [now],
    );
    expect(await store!.claimNotificationDeliveries(now)).toEqual([]);
    await store!.createMotionEvent({
      credentialHash: hashSecret('notification-device-credential'),
      publicCameraId: device.publicCameraId,
      confidence: 0.8,
      now: new Date(now.getTime() + 1000),
    });
    expect(
      (
        await store!.pool.query(
          'SELECT id FROM notification_events WHERE user_id=$1',
          [admin.id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('records a security event that reaches no subscriber without error', async () => {
    const { now, owner } = await fixture();
    await expect(
      store!.recordSecurityEvent({
        now,
        securityEventType: 'device_revoked',
        userId: owner.id,
      }),
    ).resolves.toBeUndefined();
    const rows = await store!.pool.query<{ outboxCount: number }>(
      `SELECT count(*)::int AS "outboxCount" FROM notification_outbox`,
    );
    expect(rows.rows[0]!.outboxCount).toBe(0);
  });

  it('never delivers a distinct security event to a revoked subscription', async () => {
    const { now, owner, sessionId } = await fixture();
    await store!.upsertNotificationSubscription({
      channel: 'fcm',
      consentedAt: now,
      deviceLabel: 'Revoked before security event',
      installationId: randomUUID(),
      providerMaterial: 'soon-to-be-revoked-provider-token',
      sessionId,
      userId: owner.id,
    });
    await store!.revokeSession(sessionId);
    await store!.recordSecurityEvent({
      now,
      securityEventType: 'household_membership_changed',
      userId: owner.id,
    });
    const rows = await store!.pool.query<{ outboxCount: number }>(
      `SELECT count(*)::int AS "outboxCount" FROM notification_outbox`,
    );
    expect(rows.rows[0]!.outboxCount).toBe(0);
  });

  it('accepts a desktop subscription, delivers its session ID to the sender, and expires stale alerts without revoking it', async () => {
    const { now, owner, sessionId } = await fixture();
    const subscriptionId = await store!.upsertNotificationSubscription({
      channel: 'desktop',
      consentedAt: now,
      deviceLabel: 'Beacon desktop app',
      installationId: randomUUID(),
      providerMaterial: sessionId,
      sessionId,
      userId: owner.id,
    });
    await store!.recordSecurityEvent({
      now,
      securityEventType: 'sign_in',
      userId: owner.id,
    });
    // Outbox rows default to the database clock; align with the fixture's.
    await store!.pool.query(
      'UPDATE notification_outbox SET next_attempt_at=$1',
      [now],
    );
    const [delivery] = await store!.claimNotificationDeliveries(now);
    expect(delivery).toMatchObject({
      channel: 'desktop',
      providerMaterial: sessionId,
      subscriptionId,
    });
    expect(delivery!.safePayload).toMatchObject({ category: 'security' });

    await store!.markNotificationExpired(delivery!.id, now);
    const outbox = await store!.pool.query<{ terminal: boolean }>(
      'SELECT terminal_at IS NOT NULL AS terminal FROM notification_outbox WHERE id=$1',
      [delivery!.id],
    );
    expect(outbox.rows).toEqual([{ terminal: true }]);
    const subscription = await store!.pool.query<{ revoked: boolean }>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM notification_subscriptions WHERE id=$1',
      [subscriptionId],
    );
    expect(subscription.rows).toEqual([{ revoked: false }]);
  });
});
