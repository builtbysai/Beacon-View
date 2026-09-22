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

    const preferences = await store!.listNotificationPreferences(owner.id);

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
      publicDeviceId: device.publicDeviceId,
      motionEnabled: true,
      offlineEnabled: false,
      quietHours,
    });
    expect(
      (await store!.listNotificationPreferences(owner.id))[0]?.quietHours,
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
});
