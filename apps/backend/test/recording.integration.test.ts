import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { hashSecret } from '../src/security.js';
import { PostgresStore } from '../src/store.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

const databaseUrl = testDatabaseUrl();
const store = databaseUrl ? new PostgresStore(databaseUrl) : null;

describe.skipIf(!store)('recording persistence', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => store?.close());

  it('creates, lists, and soft-deletes a household-scoped request', async () => {
    const owner = await store!.createAccount(
      'recordings@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    await store!.createPairingCode(
      owner.householdId,
      hashSecret('RECORDING1'),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret('RECORDING1'),
      credentialHash: hashSecret('recording-device-credential'),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Recording camera',
      now: new Date(),
    });
    if (!device || typeof device === 'string')
      throw new Error('Expected device');
    const camera = await store!.findAccessibleCamera(
      owner.householdId,
      owner.id,
      'owner',
      device.publicCameraId,
    );
    expect(camera).not.toBeNull();

    const recording = await store!.createRecordingRequest({
      cameraSourceId: camera!.cameraId,
      householdId: owner.householdId,
      userId: owner.id,
    });
    expect(recording).toMatchObject({
      cameraId: device.publicCameraId,
      status: 'requested',
    });
    expect(
      await store!.listRecordings(owner.householdId, [camera!.cameraId]),
    ).toHaveLength(1);
    expect(
      await store!.listRecordings(randomUUID(), [camera!.cameraId]),
    ).toHaveLength(0);

    expect(await store!.deleteRecording(owner.householdId, recording!.id)).toBe(
      true,
    );
    expect(
      await store!.listRecordings(owner.householdId, [camera!.cameraId]),
    ).toHaveLength(0);

    const uploaded = await store!.createRecordingRequest({
      cameraSourceId: camera!.cameraId,
      householdId: owner.householdId,
      userId: owner.id,
    });
    const claim = await store!.beginOwnerRecordingUpload({
      byteSize: 1_024,
      checksumSha256: 'a'.repeat(64),
      durationMs: 5_000,
      householdId: owner.householdId,
      mimeType: 'video/webm',
      recordingId: uploaded!.id,
      userId: owner.id,
    });
    expect(claim).toMatchObject({
      byteSize: 1_024,
      mimeType: 'video/webm',
      recordingId: uploaded!.id,
    });
    expect(
      await store!.completeRecordingUpload({
        providerFileId: 'drive-file-for-recording-test',
        recordingId: uploaded!.id,
        userId: owner.id,
      }),
    ).toBe(true);
    expect(
      await store!.listRecordings(owner.householdId, [camera!.cameraId]),
    ).toEqual([expect.objectContaining({ status: 'available' })]);
    const deletion = await store!.beginAvailableRecordingDeletion(
      owner.householdId,
      uploaded!.id,
    );
    expect(deletion).toMatchObject({
      providerFileId: 'drive-file-for-recording-test',
      recordingId: uploaded!.id,
    });
    expect(
      await store!.finishRecordingDeletion(owner.householdId, uploaded!.id),
    ).toBe(true);
    expect(
      await store!.listRecordings(owner.householdId, [camera!.cameraId]),
    ).toHaveLength(0);
  });
});
