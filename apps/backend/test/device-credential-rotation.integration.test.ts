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

const MONTH_MS = 30 * 24 * 60 * 60 * 1_000;

async function pairedCamera() {
  const owner = await store!.createAccount(
    'rotation@example.com',
    'irrelevant-test-hash',
    '127.0.0.1',
  );
  const now = new Date();
  await store!.createPairingCode(
    owner.householdId,
    hashSecret('ROTATE1234'),
    new Date(now.getTime() + 60_000),
  );
  const device = await store!.redeemPairingCode({
    codeHash: hashSecret('ROTATE1234'),
    credentialHash: hashSecret('first-credential'),
    installationId: randomUUID(),
    ipAddress: '127.0.0.1',
    name: 'Rotation camera',
    now,
  });
  if (!device || typeof device === 'string') throw new Error('Expected device');
  return { device, now };
}

async function ageCredential(days: number) {
  await store!.pool.query(
    `UPDATE device_credentials
     SET created_at = created_at - ($1 * interval '1 day'),
         rotated_at = rotated_at - ($1 * interval '1 day')`,
    [days],
  );
}

describe.skipIf(!store)('device credential rotation (V22)', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => store?.close());

  it('rotates only an old credential, keeps the old one until the new one is used, and then retires it', async () => {
    const { now } = await pairedCamera();
    const first = hashSecret('first-credential');
    const second = hashSecret('second-credential');

    expect(
      await store!.rotateDeviceCredential({
        currentHash: first,
        maxAgeMs: MONTH_MS,
        newHash: second,
        now,
      }),
    ).toBeNull();

    await ageCredential(31);
    expect(
      await store!.rotateDeviceCredential({
        currentHash: first,
        maxAgeMs: MONTH_MS,
        newHash: second,
        now,
      }),
    ).not.toBeNull();

    // The reply may never have arrived: both credentials work.
    expect(await store!.findDeviceByCredential(first)).not.toBeNull();
    expect(await store!.findDeviceByCredential(second)).not.toBeNull();
    // Using the new one retires the old one for good.
    expect(await store!.findDeviceByCredential(first)).toBeNull();
    expect(await store!.findDeviceByCredential(second)).not.toBeNull();

    const row = await store!.pool.query<{
      lastUsedAt: Date | null;
      previous: string | null;
    }>(
      `SELECT last_used_at AS "lastUsedAt", previous_credential_hash AS previous
       FROM device_credentials`,
    );
    expect(row.rows[0]?.previous).toBeNull();
    expect(row.rows[0]?.lastUsedAt).not.toBeNull();
  });

  it('can rotate again from the old credential when the first reply was lost', async () => {
    const { now } = await pairedCamera();
    const first = hashSecret('first-credential');
    await ageCredential(31);
    await store!.rotateDeviceCredential({
      currentHash: first,
      maxAgeMs: 0,
      newHash: hashSecret('lost-reply'),
      now,
    });
    // The camera still holds the old credential and asks again.
    expect(
      await store!.rotateDeviceCredential({
        currentHash: first,
        maxAgeMs: 0,
        newHash: hashSecret('second-try'),
        now,
      }),
    ).not.toBeNull();
    expect(
      await store!.findDeviceByCredential(hashSecret('lost-reply')),
    ).toBeNull();
    expect(
      await store!.findDeviceByCredential(hashSecret('second-try')),
    ).not.toBeNull();
  });

  it('does not rotate a revoked or unknown credential', async () => {
    const { now } = await pairedCamera();
    expect(
      await store!.rotateDeviceCredential({
        currentHash: hashSecret('never-issued'),
        maxAgeMs: 0,
        newHash: hashSecret('x'),
        now,
      }),
    ).toBeNull();
    await store!.pool.query('UPDATE device_credentials SET revoked_at = now()');
    expect(
      await store!.rotateDeviceCredential({
        currentHash: hashSecret('first-credential'),
        maxAgeMs: 0,
        newHash: hashSecret('y'),
        now,
      }),
    ).toBeNull();
  });
});
