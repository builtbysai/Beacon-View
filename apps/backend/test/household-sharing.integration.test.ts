import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { hashSecret } from '../src/security.js';
import { PostgresStore } from '../src/store.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

const databaseUrl = testDatabaseUrl();
const store = databaseUrl ? new PostgresStore(databaseUrl) : null;

describe.skipIf(!store)('household invitation acceptance', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => store?.close());

  it('gives a new viewer immediate access to every existing camera', async () => {
    const owner = await store!.createAccount(
      'sharing-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    await store!.createPairingCode(
      owner.householdId,
      hashSecret('SHARING1'),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret('SHARING1'),
      credentialHash: hashSecret('sharing-device-credential'),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Shared camera',
      now: new Date(),
    });
    if (!device || typeof device === 'string')
      throw new Error('Expected device');

    const member = await store!.createAccount(
      'sharing-member@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const invitationId = await store!.createHouseholdInvitation({
      expiresAt: new Date(Date.now() + 60_000),
      householdId: owner.householdId,
      invitedByUserId: owner.id,
      invitedEmail: 'sharing-member@example.com',
      role: 'viewer',
      tokenHash: hashSecret('INVITE-TOKEN'),
    });
    expect(invitationId).toBeTruthy();

    const accepted = await store!.acceptHouseholdInvitation({
      email: 'sharing-member@example.com',
      now: new Date(),
      tokenHash: hashSecret('INVITE-TOKEN'),
      userId: member.id,
    });
    expect(accepted).toMatchObject({
      householdId: owner.householdId,
      role: 'viewer',
    });

    const accessible = await store!.listAccessibleCameras(
      owner.householdId,
      member.id,
      'viewer',
    );
    expect(accessible.map((camera) => camera.publicCameraId)).toEqual([
      device.publicCameraId,
    ]);

    const members = await store!.listHouseholdMembers(owner.householdId);
    const memberRecord = members.find((row) => row.userId === member.id);
    expect(memberRecord?.grants).toEqual([
      expect.objectContaining({
        cameraId: device.publicCameraId,
        canListen: false,
        canTalk: false,
      }),
    ]);
  });

  it('leaves a new guest with no camera access until explicitly granted', async () => {
    const owner = await store!.createAccount(
      'sharing-guest-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    await store!.createPairingCode(
      owner.householdId,
      hashSecret('SHARING2'),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret('SHARING2'),
      credentialHash: hashSecret('sharing-guest-device-credential'),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Guest-visible camera',
      now: new Date(),
    });
    if (!device || typeof device === 'string')
      throw new Error('Expected device');

    const guest = await store!.createAccount(
      'sharing-guest@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    await store!.createHouseholdInvitation({
      expiresAt: new Date(Date.now() + 60_000),
      householdId: owner.householdId,
      invitedByUserId: owner.id,
      invitedEmail: 'sharing-guest@example.com',
      role: 'guest',
      tokenHash: hashSecret('GUEST-TOKEN'),
    });
    const accepted = await store!.acceptHouseholdInvitation({
      email: 'sharing-guest@example.com',
      now: new Date(),
      tokenHash: hashSecret('GUEST-TOKEN'),
      userId: guest.id,
    });
    expect(accepted).toMatchObject({ role: 'guest' });

    const accessible = await store!.listAccessibleCameras(
      owner.householdId,
      guest.id,
      'guest',
    );
    expect(accessible).toHaveLength(0);
  });

  it('gives a viewer only the cameras the inviter selected (V32)', async () => {
    const owner = await store!.createAccount(
      'scope-owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const publicIds: string[] = [];
    for (const name of ['Nursery', 'Garage']) {
      const code = `SCOPE${name.toUpperCase()}`;
      await store!.createPairingCode(
        owner.householdId,
        hashSecret(code),
        new Date(Date.now() + 60_000),
      );
      const device = await store!.redeemPairingCode({
        codeHash: hashSecret(code),
        credentialHash: hashSecret(`credential-${name}`),
        installationId: randomUUID(),
        ipAddress: '127.0.0.1',
        name,
        now: new Date(),
      });
      if (!device || typeof device === 'string')
        throw new Error('Expected device');
      publicIds.push(device.publicCameraId);
    }
    const member = await store!.createAccount(
      'scope-member@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    await store!.createHouseholdInvitation({
      cameraPublicIds: [publicIds[1]!],
      cameraScope: 'selected',
      defaultCanListen: true,
      expiresAt: new Date(Date.now() + 60_000),
      householdId: owner.householdId,
      invitedByUserId: owner.id,
      invitedEmail: 'scope-member@example.com',
      role: 'viewer',
      tokenHash: hashSecret('SCOPE-TOKEN'),
    });
    await store!.acceptHouseholdInvitation({
      email: 'scope-member@example.com',
      now: new Date(),
      tokenHash: hashSecret('SCOPE-TOKEN'),
      userId: member.id,
    });
    const accessible = await store!.listAccessibleCameras(
      owner.householdId,
      member.id,
      'viewer',
    );
    expect(accessible.map((camera) => camera.publicCameraId)).toEqual([
      publicIds[1],
    ]);
  });
});
