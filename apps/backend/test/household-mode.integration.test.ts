import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MODE_SETTINGS, type ModeSettings } from '../src/home-away.js';
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
    'modes@example.com',
    'irrelevant-test-hash',
    '127.0.0.1',
  );
  const now = new Date('2026-10-08T12:00:00Z');
  const sessionToken = 'modes-session';
  await store!.createSession({
    absoluteExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    csrfHash: hashSecret('modes-csrf'),
    idleExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    tokenHash: hashSecret(sessionToken),
    userId: owner.id,
  });
  const session = await store!.pool.query<{ id: string }>(
    'SELECT id FROM browser_sessions WHERE user_id=$1',
    [owner.id],
  );
  await store!.upsertNotificationSubscription({
    channel: 'fcm',
    consentedAt: now,
    deviceLabel: 'Test phone',
    installationId: randomUUID(),
    providerMaterial: 'modes-provider-token',
    sessionId: session.rows[0]!.id,
    userId: owner.id,
  });
  await store!.createPairingCode(
    owner.householdId,
    hashSecret('MODES12345'),
    new Date(now.getTime() + 60_000),
  );
  const device = await store!.redeemPairingCode({
    codeHash: hashSecret('MODES12345'),
    credentialHash: hashSecret('modes-device-credential'),
    installationId: randomUUID(),
    ipAddress: '127.0.0.1',
    name: 'Hall camera',
    now,
  });
  if (!device || typeof device === 'string') throw new Error('Expected device');
  await store!.updateNotificationPreference({
    userId: owner.id,
    householdId: owner.householdId,
    publicDeviceId: device.publicDeviceId,
    motionEnabled: true,
    offlineEnabled: true,
    quietHours: null,
  });
  return { device, now, owner };
}

const settings = (overrides: Partial<ModeSettings> = {}): ModeSettings => ({
  ...DEFAULT_MODE_SETTINGS,
  ...overrides,
});

const privacy = async (deviceId: string) =>
  (
    await store!.pool.query<{ privacyMode: boolean; pausedByMode: boolean }>(
      `SELECT privacy_mode AS "privacyMode", paused_by_mode AS "pausedByMode"
       FROM cameras WHERE public_device_id = $1`,
      [deviceId],
    )
  ).rows[0]!;

const alertCount = async () =>
  (
    await store!.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM notification_events WHERE category = 'motion'`,
    )
  ).rows[0]!.count;

async function motion(
  now: Date,
  device: { publicCameraId: string },
): Promise<void> {
  await store!.createMotionEvent({
    credentialHash: hashSecret('modes-device-credential'),
    publicCameraId: device.publicCameraId,
    confidence: 0.8,
    now,
  });
}

describe.skipIf(!store)('household Home and Away modes', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => store?.close());

  it('is Away with the defaults until a household changes anything', async () => {
    const { owner } = await fixture();
    expect(await store!.getHouseholdMode(owner.householdId)).toMatchObject({
      mode: 'away',
      settings: DEFAULT_MODE_SETTINGS,
    });
  });

  it('mutes motion alerts while Home, keeps the motion event, and alerts again when Away', async () => {
    const { device, now, owner } = await fixture();
    await store!.setHouseholdMode(owner.householdId, 'home', owner.id, now);
    await motion(now, device);
    expect(await alertCount()).toBe(0);
    const kept = await store!.pool.query(
      'SELECT id FROM motion_events WHERE camera_source_id IS NOT NULL',
    );
    expect(kept.rowCount).toBe(1);

    await store!.setHouseholdMode(owner.householdId, 'away', owner.id, now);
    await motion(new Date(now.getTime() + 3_600_000), device);
    expect(await alertCount()).toBe(1);
  });

  it('lets Home keep motion alerts when the household chose not to mute them', async () => {
    const { device, now, owner } = await fixture();
    await store!.saveHouseholdModeSettings(
      owner.householdId,
      settings({ muteMotionWhenHome: false }),
      now,
    );
    await store!.setHouseholdMode(owner.householdId, 'home', owner.id, now);
    await motion(now, device);
    expect(await alertCount()).toBe(1);
  });

  it('does not touch cameras unless Home was set to pause them', async () => {
    const { device, now, owner } = await fixture();
    const change = await store!.setHouseholdMode(
      owner.householdId,
      'home',
      owner.id,
      now,
    );
    expect(change.paused).toEqual([]);
    expect(await privacy(device.publicDeviceId)).toMatchObject({
      privacyMode: false,
    });
  });

  it('pauses Android cameras at Home and resumes only those Home paused, only when opted in', async () => {
    const { device, now, owner } = await fixture();
    await store!.saveHouseholdModeSettings(
      owner.householdId,
      settings({ pauseCamerasWhenHome: true, resumeCamerasWhenAway: true }),
      now,
    );
    const home = await store!.setHouseholdMode(
      owner.householdId,
      'home',
      owner.id,
      now,
    );
    expect(home.paused).toEqual([device.publicCameraId]);
    expect(await privacy(device.publicDeviceId)).toEqual({
      privacyMode: true,
      pausedByMode: true,
    });

    const away = await store!.setHouseholdMode(
      owner.householdId,
      'away',
      owner.id,
      now,
    );
    expect(away.resumed).toEqual([device.publicCameraId]);
    expect(await privacy(device.publicDeviceId)).toEqual({
      privacyMode: false,
      pausedByMode: false,
    });
  });

  it('never resumes a camera by itself unless the household opted in', async () => {
    const { device, now, owner } = await fixture();
    await store!.saveHouseholdModeSettings(
      owner.householdId,
      settings({ pauseCamerasWhenHome: true }),
      now,
    );
    await store!.setHouseholdMode(owner.householdId, 'home', owner.id, now);
    const away = await store!.setHouseholdMode(
      owner.householdId,
      'away',
      owner.id,
      now,
    );
    expect(away.resumed).toEqual([]);
    // Still paused, and no longer marked as Home's: a later opt-in must not
    // resume it retroactively.
    expect(await privacy(device.publicDeviceId)).toEqual({
      privacyMode: true,
      pausedByMode: false,
    });
  });

  it('does not resume a camera a person paused themselves', async () => {
    const { device, now, owner } = await fixture();
    await store!.saveHouseholdModeSettings(
      owner.householdId,
      settings({ pauseCamerasWhenHome: true, resumeCamerasWhenAway: true }),
      now,
    );
    await store!.setPrivacyMode(owner.householdId, device.publicDeviceId, true);
    const home = await store!.setHouseholdMode(
      owner.householdId,
      'home',
      owner.id,
      now,
    );
    expect(home.paused).toEqual([]); // already paused by a person
    const away = await store!.setHouseholdMode(
      owner.householdId,
      'away',
      owner.id,
      now,
    );
    expect(away.resumed).toEqual([]);
    expect(await privacy(device.publicDeviceId)).toMatchObject({
      privacyMode: true,
    });
  });

  it("clears Home's claim on a camera when a person changes its privacy mode", async () => {
    const { device, now, owner } = await fixture();
    await store!.saveHouseholdModeSettings(
      owner.householdId,
      settings({ pauseCamerasWhenHome: true, resumeCamerasWhenAway: true }),
      now,
    );
    await store!.setHouseholdMode(owner.householdId, 'home', owner.id, now);
    await store!.setPrivacyMode(owner.householdId, device.publicDeviceId, true);
    expect(await privacy(device.publicDeviceId)).toEqual({
      privacyMode: true,
      pausedByMode: false,
    });
    const away = await store!.setHouseholdMode(
      owner.householdId,
      'away',
      owner.id,
      now,
    );
    expect(away.resumed).toEqual([]);
  });

  describe('schedule', () => {
    const evenings = {
      windows: [
        {
          days: [0, 1, 2, 3, 4, 5, 6],
          start: '18:00',
          end: '23:00',
          timeZone: 'UTC',
        },
      ],
    };

    it('applies a saved schedule at once and then follows it', async () => {
      const { now, owner } = await fixture();
      const evening = new Date('2026-10-08T19:00:00Z');
      const saved = await store!.saveHouseholdModeSettings(
        owner.householdId,
        settings({ schedule: evenings }),
        evening,
      );
      expect(saved.record).toMatchObject({ mode: 'home', source: 'schedule' });

      expect(
        await store!.scanHouseholdModeSchedules(
          new Date('2026-10-08T20:00:00Z'),
        ),
      ).toEqual([]);
      const morning = await store!.scanHouseholdModeSchedules(
        new Date('2026-10-08T23:30:00Z'),
      );
      expect(morning).toHaveLength(1);
      expect(morning[0]!.record).toMatchObject({
        mode: 'away',
        source: 'schedule',
      });
      void now;
    });

    it('lets a manual change stand until the schedule next changes its mind', async () => {
      const { owner } = await fixture();
      await store!.saveHouseholdModeSettings(
        owner.householdId,
        settings({ schedule: evenings }),
        new Date('2026-10-08T19:00:00Z'),
      );
      // Someone marks the house Away during the Home window.
      await store!.setHouseholdMode(
        owner.householdId,
        'away',
        owner.id,
        new Date('2026-10-08T19:30:00Z'),
      );
      // A scan inside the same window must not undo it.
      expect(
        await store!.scanHouseholdModeSchedules(
          new Date('2026-10-08T20:00:00Z'),
        ),
      ).toEqual([]);
      expect(await store!.getHouseholdMode(owner.householdId)).toMatchObject({
        mode: 'away',
        source: 'manual',
      });
      // The next evening it flips to Home again.
      const next = await store!.scanHouseholdModeSchedules(
        new Date('2026-10-09T23:30:00Z'),
      );
      expect(next).toEqual([]); // 23:30 is Away: the window already closed
      const evening = await store!.scanHouseholdModeSchedules(
        new Date('2026-10-10T18:30:00Z'),
      );
      expect(evening[0]!.record.mode).toBe('home');
    });

    it('stops following the schedule once it is removed', async () => {
      const { owner } = await fixture();
      await store!.saveHouseholdModeSettings(
        owner.householdId,
        settings({ schedule: evenings }),
        new Date('2026-10-08T19:00:00Z'),
      );
      await store!.saveHouseholdModeSettings(
        owner.householdId,
        settings({ schedule: null }),
        new Date('2026-10-08T19:10:00Z'),
      );
      expect(
        await store!.scanHouseholdModeSchedules(
          new Date('2026-10-08T23:30:00Z'),
        ),
      ).toEqual([]);
      expect(await store!.getHouseholdMode(owner.householdId)).toMatchObject({
        mode: 'home',
      });
    });
  });
});
