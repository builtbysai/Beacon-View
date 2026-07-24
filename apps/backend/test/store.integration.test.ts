import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { hashSecret } from '../src/security.js';
import {
  DEVICE_REGISTRATION_RATE_LIMITED,
  PostgresStore,
} from '../src/store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const store = databaseUrl ? new PostgresStore(databaseUrl) : null;

describe.skipIf(!store)('PostgreSQL security invariants', () => {
  beforeEach(async () => {
    await store!.pool.query(
      'TRUNCATE audit_events, pairing_codes, device_credentials, cameras, browser_sessions, households, users CASCADE',
    );
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
});
