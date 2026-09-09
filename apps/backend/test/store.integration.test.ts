import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { hashSecret } from '../src/security.js';
import {
  DEVICE_REGISTRATION_RATE_LIMITED,
  PostgresStore,
} from '../src/store.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

const databaseUrl = testDatabaseUrl();
const store = databaseUrl ? new PostgresStore(databaseUrl) : null;

describe.skipIf(!store)('PostgreSQL security invariants', () => {
  beforeEach(async () => {
    await resetTestDatabase(store!.pool);
  });

  afterAll(async () => {
    await store?.close();
  });

  it('creates only one motion event for simultaneous reports and accepts the next cooldown boundary', async () => {
    const owner = await store!.createAccount(
      'motion-race@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const credentialHash = hashSecret('concurrent-motion-test-credential');
    await store!.createPairingCode(
      owner.householdId,
      hashSecret('MOTIONRACE1'),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret('MOTIONRACE1'),
      credentialHash,
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Motion test',
      now: new Date(),
    });
    if (!device || typeof device === 'string')
      throw new Error('Expected device');
    const now = new Date();
    const input = {
      credentialHash,
      publicCameraId: device.publicCameraId,
      confidence: 0.42,
      now,
    };
    // Hold the source lock until all eight writers are waiting. This forces the
    // old check-and-insert statement to take overlapping snapshots reliably.
    const blocker = await store!.pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(
      'SELECT id FROM camera_sources WHERE public_camera_id = $1 FOR UPDATE',
      [device.publicCameraId],
    );
    const reports = Promise.all(
      Array.from({ length: 8 }, () => store!.createMotionEvent(input)),
    );
    let results: Awaited<typeof reports>;
    try {
      await expect
        .poll(
          async () => {
            const waiting = await store!.pool.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`,
            );
            return waiting.rows[0]!.count;
          },
          { timeout: 5_000 },
        )
        .toBe(8);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      results = await reports;
    }
    expect(
      results.every((result) => result?.householdId === owner.householdId),
    ).toBe(true);
    expect(results.filter((result) => result?.created)).toHaveLength(1);
    expect(await store!.listMotionEvents(owner.householdId)).toHaveLength(1);
    await expect(
      store!.createMotionEvent({
        ...input,
        now: new Date(now.getTime() + 29_999),
      }),
    ).resolves.toMatchObject({ created: false });
    await expect(
      store!.createMotionEvent({
        ...input,
        now: new Date(now.getTime() + 30_000),
      }),
    ).resolves.toMatchObject({ created: true });
    expect(await store!.listMotionEvents(owner.householdId)).toHaveLength(2);
    const afterCooldown = new Date(now.getTime() + 60_000);
    await expect(
      store!.createMotionEvent({ ...input, confidence: 2, now: afterCooldown }),
    ).rejects.toThrow();
    await expect(
      store!.createMotionEvent({ ...input, now: afterCooldown }),
    ).resolves.toMatchObject({ created: true });
  });

  it.each([
    'privacy',
    'source-disabled',
    'credential-revoked',
    'device-revoked',
  ] as const)(
    'rejects a waiting motion report after %s commits',
    async (restriction) => {
      const owner = await store!.createAccount(
        'motion-restriction@example.com',
        'irrelevant-test-hash',
        '127.0.0.1',
      );
      const credentialHash = hashSecret('restricted-motion-test-credential');
      await store!.createPairingCode(
        owner.householdId,
        hashSecret('MOTIONLOCK1'),
        new Date(Date.now() + 60_000),
      );
      const device = await store!.redeemPairingCode({
        codeHash: hashSecret('MOTIONLOCK1'),
        credentialHash,
        installationId: randomUUID(),
        ipAddress: '127.0.0.1',
        name: 'Motion restrictions',
        now: new Date(),
      });
      if (!device || typeof device === 'string')
        throw new Error('Expected device');
      const blocker = await store!.pool.connect();
      await blocker.query('BEGIN');
      const pid = (
        await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0]!.pid;
      const updates = {
        privacy: 'UPDATE cameras SET privacy_mode = true WHERE id = $1',
        'source-disabled':
          'UPDATE camera_sources SET enabled = false WHERE device_id = $1',
        'credential-revoked':
          'UPDATE device_credentials SET revoked_at = now() WHERE camera_id = $1',
        'device-revoked': 'UPDATE cameras SET revoked_at = now() WHERE id = $1',
      };
      await blocker.query(updates[restriction], [device.id]);
      const report = store!.createMotionEvent({
        credentialHash,
        publicCameraId: device.publicCameraId,
        confidence: 0.42,
        now: new Date(),
      });
      try {
        await expect
          .poll(
            async () => {
              const waiting = await store!.pool.query<{ count: number }>(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND $1::int = ANY(pg_blocking_pids(pid))',
                [pid],
              );
              return waiting.rows[0]!.count;
            },
            { timeout: 5_000 },
          )
          .toBe(1);
        await blocker.query('COMMIT');
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await report;
      }
      await expect(report).resolves.toBeNull();
      expect(await store!.listMotionEvents(owner.householdId)).toEqual([]);
    },
  );

  it('allows exactly one concurrent pairing redemption and rejects reuse', async () => {
    const owner = await store!.createAccount(
      'owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const code = 'ABCDEFGH23';
    await store!.createPairingCode(
      owner.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    const redeem = (installationId: string, credential: string) =>
      store!.redeemPairingCode({
        codeHash: hashSecret(code),
        credentialHash: hashSecret(credential),
        installationId,
        ipAddress: '127.0.0.1',
        name: 'Android Camera',
        now: new Date(),
      });
    const outcomes = await Promise.all([
      redeem(randomUUID(), 'credential-one'),
      redeem(randomUUID(), 'credential-two'),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    await expect(redeem(randomUUID(), 'credential-three')).resolves.toBeNull();
  });

  it('rejects expired and invalid pairing codes without creating cameras', async () => {
    const owner = await store!.createAccount(
      'owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    await store!.createPairingCode(
      owner.householdId,
      hashSecret('ABCDEFGH23'),
      new Date(Date.now() - 1),
    );
    const input = {
      credentialHash: hashSecret('credential'),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Android Camera',
      now: new Date(),
    };
    await expect(
      store!.redeemPairingCode({
        ...input,
        codeHash: hashSecret('ABCDEFGH23'),
      }),
    ).resolves.toBeNull();
    await expect(
      store!.redeemPairingCode({
        ...input,
        codeHash: hashSecret('XXXXXXXXXX'),
        installationId: randomUUID(),
      }),
    ).resolves.toBeNull();
    await expect(store!.listCameras(owner.householdId)).resolves.toHaveLength(
      0,
    );
  });

  it('rejects an owner-revoked pairing code', async () => {
    const owner = await store!.createAccount(
      'owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const code = 'ABCDEFGH23';
    const pairingCodeId = await store!.createPairingCode(
      owner.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    await expect(
      store!.revokePairingCode(owner.householdId, pairingCodeId),
    ).resolves.toBe(true);
    await expect(
      store!.redeemPairingCode({
        codeHash: hashSecret(code),
        credentialHash: hashSecret('credential'),
        installationId: randomUUID(),
        ipAddress: '127.0.0.1',
        name: 'Android Camera',
        now: new Date(),
      }),
    ).resolves.toBeNull();
  });

  it('immediately rejects heartbeat credentials after owner revocation', async () => {
    const owner = await store!.createAccount(
      'owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const code = 'ABCDEFGH23';
    const credential = 'device-credential';
    await store!.createPairingCode(
      owner.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    const camera = await store!.redeemPairingCode({
      codeHash: hashSecret(code),
      credentialHash: hashSecret(credential),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Android Camera',
      now: new Date(),
    });
    expect(camera).not.toBeNull();
    expect(camera).not.toBe(DEVICE_REGISTRATION_RATE_LIMITED);
    if (!camera || camera === DEVICE_REGISTRATION_RATE_LIMITED) {
      throw new Error('Expected camera registration to succeed');
    }
    await expect(
      store!.heartbeat(hashSecret(credential), new Date()),
    ).resolves.toBe(camera.id);
    await store!.updateDevice(owner.householdId, camera.publicDeviceId, {
      enabled: false,
    });
    await expect(
      store!.heartbeat(hashSecret(credential), new Date()),
    ).resolves.toBe(camera.id);
    await store!.updateDevice(owner.householdId, camera.publicDeviceId, {
      enabled: true,
    });
    await expect(
      store!.revokeDevice(owner.householdId, camera.publicDeviceId),
    ).resolves.toBe(camera.id);
    await expect(
      store!.heartbeat(hashSecret(credential), new Date()),
    ).resolves.toBeNull();
    const otherOwner = await store!.createAccount(
      'other@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    await expect(store!.listCameras(otherOwner.householdId)).resolves.toEqual(
      [],
    );
  });

  it('blocks live viewing during privacy mode without revoking the device', async () => {
    const owner = await store!.createAccount(
      'privacy-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const code = 'PRIVACY123';
    const credential = 'privacy-device-credential';
    await store!.createPairingCode(
      owner.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret(code),
      credentialHash: hashSecret(credential),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Private camera',
      now: new Date(),
    });
    if (!device || device === DEVICE_REGISTRATION_RATE_LIMITED) {
      throw new Error('Expected camera registration to succeed');
    }

    await expect(
      store!.findOwnedCamera(owner.householdId, device.publicCameraId),
    ).resolves.not.toBeNull();
    await expect(
      store!.setPrivacyMode(owner.householdId, device.publicDeviceId, true),
    ).resolves.toBe(device.id);
    await expect(
      store!.findOwnedCamera(owner.householdId, device.publicCameraId),
    ).resolves.toBeNull();
    await expect(
      store!.heartbeat(hashSecret(credential), new Date()),
    ).resolves.toBe(device.id);
    await expect(
      store!.setPrivacyMode(owner.householdId, device.publicDeviceId, false),
    ).resolves.toBe(device.id);
    await expect(
      store!.findOwnedCamera(owner.householdId, device.publicCameraId),
    ).resolves.not.toBeNull();
  });

  it('creates a default camera for an existing Android registration and isolates source sync', async () => {
    const owner = await store!.createAccount(
      'multi-camera-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const other = await store!.createAccount(
      'isolated-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const code = 'ABCDEFGH23';
    const credential = 'multi-camera-credential';
    await store!.createPairingCode(
      owner.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    const paired = await store!.redeemPairingCode({
      codeHash: hashSecret(code),
      credentialHash: hashSecret(credential),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Pixel device',
      now: new Date(),
    });
    if (!paired || paired === DEVICE_REGISTRATION_RATE_LIMITED) {
      throw new Error('Expected registration');
    }
    expect(await store!.listCameras(owner.householdId)).toMatchObject([
      {
        deviceName: 'Pixel device',
        publicCameraId: paired.publicCameraId,
        sourceKey: 'legacy-default',
      },
    ]);

    const synchronized = await store!.syncDeviceCameras(
      hashSecret(credential),
      [
        { facing: 'rear', name: 'Rear Wide', sourceKey: 'android:0' },
        { facing: 'front', name: 'Front', sourceKey: 'android:1' },
      ],
      new Date(),
    );
    expect(synchronized).toHaveLength(2);
    expect(synchronized?.every((camera) => camera.deviceId === paired.id)).toBe(
      true,
    );
    await expect(store!.listCameras(other.householdId)).resolves.toEqual([]);

    const installationId = randomUUID();
    const browser = await store!.registerBrowserDevice({
      householdId: owner.householdId,
      installationId,
      name: 'Office laptop',
      now: new Date(),
      sources: [
        {
          facing: 'external',
          name: 'Built-in webcam',
          sourceKey: 'browser:built-in',
        },
        {
          facing: 'external',
          name: 'USB webcam',
          sourceKey: 'browser:usb',
        },
      ],
    });
    expect(browser.cameras).toHaveLength(2);
    const browserCamera = browser.cameras[0]!;
    await expect(
      store!.updateCamera(other.householdId, browserCamera.publicCameraId, {
        enabled: false,
      }),
    ).resolves.toBe(false);
    await expect(
      store!.updateCamera(owner.householdId, browserCamera.publicCameraId, {
        enabled: false,
        name: 'Desk camera',
      }),
    ).resolves.toBe(true);
    await expect(
      store!.findOwnedCamera(owner.householdId, browserCamera.publicCameraId),
    ).resolves.toBeNull();
    await store!.updateCamera(owner.householdId, browserCamera.publicCameraId, {
      enabled: true,
    });
    await expect(
      store!.revokeDevice(owner.householdId, browser.device.publicDeviceId),
    ).resolves.toBe(browser.device.id);
    await expect(
      store!.findOwnedCamera(owner.householdId, browserCamera.publicCameraId),
    ).resolves.toBeNull();
  });

  it('keeps disable, revoke, source removal, and device deletion distinct', async () => {
    const owner = await store!.createAccount(
      'management-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const installationId = randomUUID();
    const browser = await store!.registerBrowserDevice({
      householdId: owner.householdId,
      installationId,
      name: 'Managed browser',
      now: new Date(),
      sources: [
        { facing: 'front', name: 'Front', sourceKey: 'browser:front' },
        { facing: 'external', name: 'USB', sourceKey: 'browser:usb' },
      ],
    });
    const [front, usb] = browser.cameras;
    expect(front).toBeDefined();
    expect(usb).toBeDefined();

    await expect(
      store!.updateDevice(owner.householdId, browser.device.publicDeviceId, {
        enabled: false,
        name: 'Disabled browser',
      }),
    ).resolves.toBe(true);
    expect(await store!.listDevices(owner.householdId)).toMatchObject([
      { enabled: false, name: 'Disabled browser', revokedAt: null },
    ]);
    await expect(
      store!.findOwnedCamera(owner.householdId, front!.publicCameraId),
    ).resolves.toBeNull();
    await expect(
      store!.findManagedCamera(owner.householdId, front!.publicCameraId),
    ).resolves.not.toBeNull();

    await store!.updateDevice(
      owner.householdId,
      browser.device.publicDeviceId,
      { enabled: true },
    );
    await expect(
      store!.deleteCamera(owner.householdId, front!.publicCameraId),
    ).resolves.toBe(true);
    expect(
      (await store!.listCameras(owner.householdId)).map(
        (camera) => camera.publicCameraId,
      ),
    ).toEqual([usb!.publicCameraId]);

    await store!.registerBrowserDevice({
      householdId: owner.householdId,
      installationId,
      name: 'Managed browser',
      now: new Date(),
      sources: [
        { facing: 'front', name: 'Front', sourceKey: 'browser:front' },
        { facing: 'external', name: 'USB', sourceKey: 'browser:usb' },
      ],
    });
    expect(
      (await store!.listCameras(owner.householdId)).map(
        (camera) => camera.publicCameraId,
      ),
    ).toEqual([usb!.publicCameraId]);

    await expect(
      store!.deleteDevice(owner.householdId, browser.device.publicDeviceId),
    ).resolves.toBe(browser.device.id);
    await expect(store!.listDevices(owner.householdId)).resolves.toEqual([]);
    await expect(store!.listCameras(owner.householdId)).resolves.toEqual([]);
  });

  it('allows a deleted Android installation to pair again cleanly', async () => {
    const owner = await store!.createAccount(
      'repair-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const installationId = randomUUID();
    const pair = async (code: string, credential: string) => {
      await store!.createPairingCode(
        owner.householdId,
        hashSecret(code),
        new Date(Date.now() + 60_000),
      );
      return store!.redeemPairingCode({
        codeHash: hashSecret(code),
        credentialHash: hashSecret(credential),
        installationId,
        ipAddress: '127.0.0.1',
        name: 'Android Camera',
        now: new Date(),
      });
    };

    const first = await pair('REPAIRCODE1', 'first-device-credential');
    if (!first || typeof first === 'string') {
      throw new Error('Expected the first pairing to create a device');
    }
    await expect(
      store!.deleteDevice(owner.householdId, first.publicDeviceId),
    ).resolves.toBe(first.id);

    const second = await pair('REPAIRCODE2', 'second-device-credential');
    if (!second || typeof second === 'string') {
      throw new Error('Expected the second pairing to create a device');
    }
    expect(second.id).not.toBe(first.id);
    await expect(store!.listDevices(owner.householdId)).resolves.toHaveLength(
      1,
    );
    await expect(store!.listCameras(owner.householdId)).resolves.toHaveLength(
      1,
    );
  });

  it('stores a session user-agent when given one and null when omitted, never a fabricated guess', async () => {
    const owner = await store!.createAccount(
      'sessions@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const now = new Date();
    await store!.createSession({
      absoluteExpiresAt: new Date(now.getTime() + 60_000),
      csrfHash: hashSecret('csrf-with-agent'),
      idleExpiresAt: new Date(now.getTime() + 60_000),
      tokenHash: hashSecret('token-with-agent'),
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1',
      userId: owner.id,
    });
    await store!.createSession({
      absoluteExpiresAt: new Date(now.getTime() + 60_000),
      csrfHash: hashSecret('csrf-without-agent'),
      idleExpiresAt: new Date(now.getTime() + 60_000),
      tokenHash: hashSecret('token-without-agent'),
      userId: owner.id,
    });

    const sessions = await store!.listBrowserSessions(owner.id);
    expect(sessions).toHaveLength(2);
    const withAgent = sessions.find((session) => session.userAgent !== null);
    const withoutAgent = sessions.find((session) => session.userAgent === null);
    expect(withAgent?.userAgent).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1',
    );
    expect(withoutAgent?.userAgent).toBeNull();
  });
});
