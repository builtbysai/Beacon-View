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

    const browser = await store!.registerBrowserDevice({
      householdId: owner.householdId,
      installationId: randomUUID(),
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
});
