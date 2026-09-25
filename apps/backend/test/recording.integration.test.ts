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
      encryptionDataKeyCiphertext: Buffer.alloc(48),
      encryptionDataKeyIv: Buffer.alloc(12),
      encryptionIv: Buffer.alloc(12),
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

  it('lets the recording camera itself complete a device-initiated upload', async () => {
    const owner = await store!.createAccount(
      'device-recordings@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    await store!.createPairingCode(
      owner.householdId,
      hashSecret('RECORDING2'),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret('RECORDING2'),
      credentialHash: hashSecret('device-recording-credential'),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Device-triggered camera',
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
    const requested = await store!.createRecordingRequest({
      cameraSourceId: camera!.cameraId,
      householdId: owner.householdId,
      userId: owner.id,
    });

    // No browser session exists at all here -- only the device's own
    // credential -- exactly the motion-triggered scenario ADR 0051 requires.
    const claim = await store!.beginRecordingUpload({
      byteSize: 2_048,
      checksumSha256: 'b'.repeat(64),
      credentialHash: hashSecret('device-recording-credential'),
      durationMs: 8_000,
      encryptionDataKeyCiphertext: Buffer.alloc(48),
      encryptionDataKeyIv: Buffer.alloc(12),
      encryptionIv: Buffer.alloc(12),
      mimeType: 'video/mp4',
      recordingId: requested!.id,
    });
    expect(claim).toMatchObject({
      byteSize: 2_048,
      mimeType: 'video/mp4',
      recordingId: requested!.id,
      userId: owner.id,
    });

    expect(
      await store!.getRecordingUploadClaimByCredential(
        hashSecret('wrong-credential'),
        requested!.id,
      ),
    ).toBeNull();
    const claimByCredential = await store!.getRecordingUploadClaimByCredential(
      hashSecret('device-recording-credential'),
      requested!.id,
    );
    expect(claimByCredential).toMatchObject({
      byteSize: 2_048,
      mimeType: 'video/mp4',
      recordingId: requested!.id,
      userId: owner.id,
    });

    expect(
      await store!.completeRecordingUpload({
        providerFileId: 'drive-file-for-device-recording-test',
        recordingId: requested!.id,
        userId: owner.id,
      }),
    ).toBe(true);
    expect(
      await store!.listRecordings(owner.householdId, [camera!.cameraId]),
    ).toEqual([expect.objectContaining({ status: 'available' })]);

    // A revoked credential can no longer claim a still-pending upload.
    const second = await store!.createRecordingRequest({
      cameraSourceId: camera!.cameraId,
      householdId: owner.householdId,
      userId: owner.id,
    });
    await store!.beginRecordingUpload({
      byteSize: 4_096,
      checksumSha256: 'c'.repeat(64),
      credentialHash: hashSecret('device-recording-credential'),
      durationMs: 3_000,
      encryptionDataKeyCiphertext: Buffer.alloc(48),
      encryptionDataKeyIv: Buffer.alloc(12),
      encryptionIv: Buffer.alloc(12),
      mimeType: 'video/mp4',
      recordingId: second!.id,
    });
    await store!.pool.query(
      `UPDATE device_credentials SET revoked_at = now() WHERE credential_hash = $1`,
      [hashSecret('device-recording-credential')],
    );
    expect(
      await store!.getRecordingUploadClaimByCredential(
        hashSecret('device-recording-credential'),
        second!.id,
      ),
    ).toBeNull();
  });
});
