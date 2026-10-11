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

  it('pairs a browser camera with scoped sources and rejects reuse of its code', async () => {
    const owner = await store!.createAccount(
      'browser-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const code = 'ABCDEFGH23';
    await store!.createPairingCode(
      owner.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    const credentialHash = hashSecret('browser-credential');
    const input = {
      codeHash: hashSecret(code),
      credentialHash,
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Hallway browser',
      now: new Date(),
      browserSources: [
        {
          sourceKey: 'browser:front',
          name: 'Front lens',
          facing: 'front' as const,
        },
        {
          sourceKey: 'browser:rear',
          name: 'Rear lens',
          facing: 'rear' as const,
        },
      ],
    };
    const paired = await store!.redeemPairingCode(input);
    expect(paired).toMatchObject({ name: 'Hallway browser' });
    if (!paired || paired === 'device_registration_rate_limited')
      throw new Error('Expected browser pairing to succeed');
    const identity = await store!.findDeviceByCredential(credentialHash);
    expect(identity).toMatchObject({
      platform: 'browser',
      installationId: input.installationId,
    });
    const cameras = (await store!.listCameras(owner.householdId)).filter(
      (camera) => camera.publicDeviceId === paired?.publicDeviceId,
    );
    expect(cameras.map((camera) => camera.sourceKey).sort()).toEqual([
      'browser:front',
      'browser:rear',
    ]);
    await expect(
      store!.redeemPairingCode({ ...input, installationId: randomUUID() }),
    ).resolves.toBeNull();
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
    await expect(
      store!.updateCamera(owner.householdId, paired.publicCameraId, {
        name: 'My driveway camera',
      }),
    ).resolves.toBe(true);

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
    const front = synchronized?.find(
      (camera) => camera.sourceKey === 'android:1',
    );
    if (!front) throw new Error('Expected front source');
    const addedAfterSync = await store!.listHouseholdActivity(
      owner.householdId,
      {
        eventTypes: ['camera_source_added'],
      },
    );
    expect(addedAfterSync.events).toMatchObject([
      {
        cameraSourceId: front.publicCameraId,
        publicDeviceId: paired.publicDeviceId,
        sourceName: 'Front',
      },
    ]);
    await store!.audit({
      cameraId: paired.id,
      eventType: 'camera_updated',
      householdId: owner.householdId,
      success: true,
      metadata: {
        cameraId: front.publicCameraId,
        cameraName: 'Front snapshot',
      },
    });
    await store!.audit({
      eventType: 'device_updated',
      householdId: owner.householdId,
      success: true,
      metadata: {
        deviceId: paired.publicDeviceId,
        deviceName: 'Device snapshot',
      },
    });
    const activity = await store!.listHouseholdActivity(owner.householdId, {
      eventTypes: ['camera_updated', 'device_updated'],
    });
    expect(activity.events).toHaveLength(2);
    expect(
      activity.events.find((event) => event.eventType === 'camera_updated'),
    ).toMatchObject({
      householdId: owner.householdId,
      publicDeviceId: paired.publicDeviceId,
      cameraSourceId: front.publicCameraId,
      deviceName: 'Pixel device',
      sourceName: 'Front snapshot',
    });
    expect(
      activity.events.find((event) => event.eventType === 'device_updated'),
    ).toMatchObject({
      publicDeviceId: paired.publicDeviceId,
      cameraSourceId: null,
      deviceName: 'Device snapshot',
    });
    const filteredActivity = await store!.listHouseholdActivity(
      owner.householdId,
      {
        cameraSourceId: front.publicCameraId,
        eventTypes: ['camera_updated', 'device_updated'],
      },
    );
    expect(filteredActivity.total).toBe(1);
    expect(filteredActivity.events[0]?.cameraSourceId).toBe(
      front.publicCameraId,
    );
    expect(
      synchronized?.find((camera) => camera.sourceKey === 'android:0')?.name,
    ).toBe('My driveway camera');
    await store!.syncDeviceCameras(
      hashSecret(credential),
      [{ facing: 'rear', name: 'Rear camera', sourceKey: 'android:0' }],
      new Date(),
    );
    expect(
      (
        await store!.listHouseholdActivity(owner.householdId, {
          eventTypes: ['camera_source_added'],
        })
      ).total,
    ).toBe(1);
    expect(await store!.listCameras(owner.householdId)).toMatchObject([
      { name: 'My driveway camera', sourceKey: 'android:0' },
      { sourceKey: 'android:1' },
    ]);
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
    expect(
      (
        await store!.listHouseholdActivity(owner.householdId, {
          eventTypes: ['camera_source_added'],
        })
      ).total,
    ).toBe(3);
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
    await store!.updateDevice(
      owner.householdId,
      browser.device.publicDeviceId,
      {
        name: 'My office camera',
      },
    );
    const registeredAgain = await store!.registerBrowserDevice({
      householdId: owner.householdId,
      installationId,
      name: 'Stale browser name',
      now: new Date(),
      sources: [
        {
          facing: 'front',
          name: 'Stale webcam label',
          sourceKey: 'browser:built-in',
        },
        {
          facing: 'external',
          name: 'USB webcam',
          sourceKey: 'browser:usb',
        },
      ],
    });
    expect(registeredAgain.device.name).toBe('My office camera');
    expect(
      (
        await store!.listHouseholdActivity(owner.householdId, {
          eventTypes: ['camera_source_added'],
        })
      ).total,
    ).toBe(3);
    expect(
      registeredAgain.cameras.find(
        (camera) => camera.sourceKey === 'browser:built-in',
      ),
    ).toMatchObject({
      deviceName: 'My office camera',
      facing: 'front',
      name: 'Desk camera',
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

  async function seedSession(
    email: string,
    overrides: { absolute?: Date; idle?: Date; revokedAt?: Date | null } = {},
  ) {
    const owner = await store!.createAccount(
      email,
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const token = hashSecret(`token-${email}`);
    await store!.createSession({
      userId: owner.id,
      tokenHash: token,
      csrfHash: hashSecret(`csrf-${email}`),
      idleExpiresAt: overrides.idle ?? new Date(Date.now() + 86_400_000),
      absoluteExpiresAt:
        overrides.absolute ?? new Date(Date.now() + 864_000_000),
    });
    if (overrides.revokedAt !== undefined)
      await store!.pool.query(
        'UPDATE browser_sessions SET revoked_at = $2 WHERE token_hash = $1',
        [token, overrides.revokedAt],
      );
    return token;
  }

  it('reads a session without writing it, and refreshes it at most once a minute (V4)', async () => {
    const token = await seedSession('touch@example.com');
    const lastSeen = async () =>
      (
        await store!.pool.query<{ at: Date }>(
          'SELECT last_seen_at AS at FROM browser_sessions WHERE token_hash = $1',
          [token],
        )
      ).rows[0]!.at.getTime();
    const first = await store!.findSession(token, new Date());
    expect(first?.email).toBe('touch@example.com');
    const afterFirst = await lastSeen();
    // Many reads in a row leave the row untouched.
    for (let index = 0; index < 5; index += 1)
      await store!.findSession(token, new Date());
    expect(await lastSeen()).toBe(afterFirst);
    // Once the last touch is older than a minute, the next read refreshes it.
    await store!.pool.query(
      "UPDATE browser_sessions SET last_seen_at = now() - interval '5 minutes' WHERE token_hash = $1",
      [token],
    );
    const stale = await lastSeen();
    await store!.findSession(token, new Date());
    expect(await lastSeen()).toBeGreaterThan(stale);
  });

  it('removes credentials that ended over thirty days ago and keeps the rest (V5)', async () => {
    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    const lastWeek = new Date(Date.now() - 7 * 86_400_000);
    const live = await seedSession('keep-live@example.com');
    const recent = await seedSession('keep-recent@example.com', {
      absolute: lastWeek,
      idle: lastWeek,
    });
    await seedSession('purge-expired@example.com', {
      absolute: longAgo,
      idle: longAgo,
    });
    await seedSession('purge-revoked@example.com', { revokedAt: longAgo });
    const counts = await store!.purgeExpiredCredentials(new Date());
    expect(counts.browserSessions).toBe(2);
    const remaining = await store!.pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM browser_sessions',
    );
    expect(remaining.rows.map((row) => row.token_hash).sort()).toEqual(
      [live, recent].sort(),
    );
  });
});
