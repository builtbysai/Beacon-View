import { randomBytes, randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import WebSocket from 'ws';

import type { AppConfig } from '../src/config.js';
import { hashSecret } from '../src/security.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

vi.mock('../src/google-drive-client.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/google-drive-client.js')>();
  return {
    ...actual,
    deleteDriveRecordingFile: vi.fn().mockResolvedValue(undefined),
    downloadDriveRecordingFile: vi.fn(),
    initiateDriveRecordingUpload: vi
      .fn()
      .mockResolvedValue(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fake',
      ),
    refreshDriveAccessToken: vi
      .fn()
      .mockResolvedValue('fake-drive-access-token'),
    revokeDriveRefreshToken: vi.fn().mockResolvedValue(true),
    verifyDriveRecordingFile: vi.fn().mockResolvedValue(undefined),
  };
});

const { buildApp } = await import('../src/app.js');
const { runRecordingKeyRewrap } =
  await import('../src/recording-key-rewrap.js');
const { RecordingKeyCipher, recordingKeyContext } =
  await import('../src/recording-crypto.js');
const { PostgresStore } = await import('../src/store.js');
const drive = await import('../src/google-drive-client.js');
const { GOOGLE_DRIVE_RECORDING_SCOPE, GOOGLE_DRIVE_SCOPE } = drive;

const databaseUrl = testDatabaseUrl();
const driveTokenKey = randomBytes(32).toString('base64url');
const recordingKey = randomBytes(32).toString('base64url');
const encryption = {
  dataKey: randomBytes(32).toString('base64url'),
  iv: randomBytes(12).toString('base64url'),
  version: 1 as const,
};
const store = databaseUrl
  ? new PostgresStore(
      databaseUrl,
      {
        encryptionKey: randomBytes(32).toString('base64url'),
        fingerprintKey: randomBytes(32).toString('base64url'),
      },
      driveTokenKey,
    )
  : null;
const config: AppConfig | null = databaseUrl
  ? {
      DATABASE_URL: databaseUrl,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      PORT: 3000,
      SESSION_COOKIE_NAME: 'beacon_session',
      DEVICE_STUN_URL: 'stun:10.0.2.2:3478',
      DEVICE_TURN_URL: 'turn:10.0.2.2:3478',
      ALLOW_INSECURE_LOCAL_DEV: true,
      PUBLIC_BACKEND_ORIGIN: 'http://127.0.0.1:3000',
      SIGNALING_PUBLIC_URL: 'ws://127.0.0.1:3000/api/signaling',
      DEVICE_TURN_TCP_URL: 'turn:10.0.2.2:3478?transport=tcp',
      TURN_CREDENTIAL_TTL_SECONDS: 600,
      TURN_SHARED_SECRET: 'test-shared-secret-with-at-least-32-bytes',
      VIEWER_STUN_URL: 'stun:127.0.0.1:3478',
      VIEWER_TURN_URL: 'turn:127.0.0.1:3478',
      VIEWER_TURN_TCP_URL: 'turn:127.0.0.1:3478?transport=tcp',
      ICE_TRANSPORT_POLICY: 'all',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_OAUTH_REDIRECT_URI:
        'http://127.0.0.1:5173/api/auth/google/callback',
      GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY: driveTokenKey,
      RECORDING_ENCRYPTION_KEY: recordingKey,
    }
  : null;
const app = store && config ? buildApp(config, store) : null;
let baseUrl = '';

function sessionCookies(headers: Record<string, unknown>): {
  cookie: string;
  csrf: string;
} {
  const values = headers['set-cookie'];
  const cookies = (Array.isArray(values) ? values : [values]).filter(
    (value): value is string => typeof value === 'string',
  );
  const pairs = cookies.map((value) => value.split(';')[0]!);
  const csrf = pairs
    .find((value) => value.startsWith('beacon_csrf='))
    ?.split('=')[1];
  if (!csrf) throw new Error('CSRF cookie missing');
  return { cookie: pairs.join('; '), csrf };
}

async function registerAndSignIn(
  email: string,
  remoteAddress: string,
): Promise<{ cookie: string; csrf: string; userId: string }> {
  const registration = await app!.inject({
    method: 'POST',
    payload: { email, password: 'a genuinely long password' },
    remoteAddress,
    url: '/api/auth/register',
  });
  const credentials = sessionCookies(registration.headers);
  return {
    ...credentials,
    userId: registration.json<{ user: { id: string } }>().user.id,
  };
}

let pairedCameras = 0;

async function pairCamera(
  memberCredentials: { cookie: string; csrf: string },
  deviceName: string,
): Promise<{ cameraId: string; credential: string; deviceId: string }> {
  const created = await app!.inject({
    headers: {
      cookie: memberCredentials.cookie,
      'x-csrf-token': memberCredentials.csrf,
    },
    method: 'POST',
    url: '/api/pairing-codes',
  });
  expect(created.statusCode).toBe(201);
  const code = created.json<{ code: string }>().code;
  const redeemed = await app!.inject({
    method: 'POST',
    payload: {
      installationId: randomUUID(),
      name: deviceName,
      pairingCode: code,
    },
    // Each camera pairs from its own address: pairing attempts are limited per
    // address, and a real household's cameras do not share one test socket.
    remoteAddress: `10.77.${Math.floor(pairedCameras / 250)}.${(pairedCameras++ % 250) + 1}`,
    url: '/api/devices/register',
  });
  expect(redeemed.statusCode).toBe(201);
  const body = redeemed.json<{
    camera: { id: string };
    credential: string;
    device: { id: string };
  }>();
  return {
    cameraId: body.camera.id,
    credential: body.credential,
    deviceId: body.device.id,
  };
}

function connectDevice(cameraId: string, credential: string): WebSocket {
  return new WebSocket(
    `${baseUrl}/api/signaling?role=device&cameraId=${cameraId}`,
    { headers: { Authorization: `Bearer ${credential}` } },
  );
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Message timeout')), 2_000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
              'utf8',
            );
      resolve(JSON.parse(text) as Record<string, unknown>);
    });
  });
}

async function connectDrive(
  userId: string,
  scopes: string[] = [GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_RECORDING_SCOPE],
): Promise<void> {
  await store!.saveGoogleDriveConnection({
    providerEmail: 'owner@example.com',
    refreshToken: 'fake-refresh-token',
    scopes: scopes.join(' '),
    userId,
  });
}

describe.skipIf(!app || !store)('recording routes', () => {
  beforeAll(async () => {
    await app!.listen({ host: '127.0.0.1', port: 0 });
    const address = app!.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await resetTestDatabase(store!.pool);
    vi.mocked(drive.refreshDriveAccessToken).mockResolvedValue(
      'fake-drive-access-token',
    );
    vi.mocked(drive.initiateDriveRecordingUpload).mockResolvedValue(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fake',
    );
    vi.mocked(drive.verifyDriveRecordingFile).mockResolvedValue(undefined);
    vi.mocked(drive.deleteDriveRecordingFile).mockResolvedValue(undefined);
  });

  afterEach(() => vi.clearAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  it('refuses to start a recording without the recording Drive scope connected', async () => {
    const owner = await registerAndSignIn('no-drive@example.com', '10.2.0.1');
    const camera = await pairCamera(owner, 'Front door');

    const attempt = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    expect(attempt.statusCode).toBe(409);
    // The text stays what Android clients match on; the code is new.
    expect(attempt.json()).toEqual({
      code: 'drive_not_connected',
      error: 'Connect Google Drive for recordings first',
    });
  });

  it('refuses recording connected only for app-data, not the recording scope', async () => {
    const owner = await registerAndSignIn(
      'appdata-only@example.com',
      '10.2.0.2',
    );
    const camera = await pairCamera(owner, 'Front door');
    await connectDrive(owner.userId, [GOOGLE_DRIVE_SCOPE]);

    const attempt = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    expect(attempt.statusCode).toBe(409);
  });

  it('blocks a non-owner from starting a recording even with Drive connected', async () => {
    const owner = await registerAndSignIn(
      'viewer-owner@example.com',
      '10.2.0.3',
    );
    const camera = await pairCamera(owner, 'Front door');
    await connectDrive(owner.userId);

    const invite = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        cameraAccess: 'all',
        email: 'viewer-role@example.com',
        role: 'viewer',
      },
      url: '/api/household/invitations',
    });
    const token = invite.json<{ token: string }>().token;
    const viewer = await registerAndSignIn(
      'viewer-role@example.com',
      '10.2.0.4',
    );
    const accepted = await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'POST',
      payload: { token },
      url: '/api/household/invitations/accept',
    });
    const { householdId } = accepted.json<{ householdId: string }>();
    await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'PUT',
      payload: { householdId },
      url: '/api/account/household',
    });

    const attempt = await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    expect(attempt.statusCode).toBe(403);

    // This viewer has no grant on any camera, so playback of any recording
    // -- real or not -- is unavailable to them, not merely forbidden; the
    // response doesn't distinguish "doesn't exist" from "no access".
    const playback = await app!.inject({
      headers: { cookie: viewer.cookie },
      method: 'GET',
      url: `/api/recordings/${randomUUID()}/playback`,
    });
    expect(playback.statusCode).toBe(404);
    expect(drive.downloadDriveRecordingFile).not.toHaveBeenCalled();
  });

  it('lets a viewer play a clip from a camera they were granted, but not one they were not', async () => {
    const owner = await registerAndSignIn(
      'grant-playback-owner@example.com',
      '10.2.0.21',
    );
    const granted = await pairCamera(owner, 'Granted camera');
    const notGranted = await pairCamera(owner, 'Ungranted camera');
    await connectDrive(owner.userId);

    const invite = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        cameraAccess: 'all',
        email: 'grant-playback-viewer@example.com',
        role: 'viewer',
      },
      url: '/api/household/invitations',
    });
    const token = invite.json<{ token: string }>().token;
    const viewer = await registerAndSignIn(
      'grant-playback-viewer@example.com',
      '10.2.0.22',
    );
    const accepted = await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'POST',
      payload: { token },
      url: '/api/household/invitations/accept',
    });
    const { householdId } = accepted.json<{ householdId: string }>();
    await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'PUT',
      payload: { householdId },
      url: '/api/account/household',
    });

    const members = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/household/sharing',
    });
    const memberId = members
      .json<{ members: { id: string; userId: string }[] }>()
      .members.find((member) => member.userId === viewer.userId)!.id;
    await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'PUT',
      payload: {
        grants: [
          {
            cameraId: granted.cameraId,
            canFlip: false,
            canListen: false,
            canPause: false,
            canTalk: false,
          },
        ],
      },
      url: `/api/household/members/${memberId}/grants`,
    });

    // A recording from each camera, both uploaded and available.
    const [grantedDevice, notGrantedDevice] = [
      connectDevice(granted.cameraId, granted.credential),
      connectDevice(notGranted.cameraId, notGranted.credential),
    ];
    await Promise.all([
      nextMessage(grantedDevice),
      nextMessage(notGrantedDevice),
    ]);
    async function recordAndComplete(camera: {
      cameraId: string;
    }): Promise<string> {
      const created = await app!.inject({
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
        method: 'POST',
        payload: { cameraId: camera.cameraId },
        url: '/api/recordings',
      });
      const recordingId = created.json<{ recording: { id: string } }>()
        .recording.id;
      await app!.inject({
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
        method: 'POST',
        payload: {
          byteSize: 1_048_576,
          checksumSha256: 'a'.repeat(64),
          durationMs: 15_000,
          mimeType: 'video/webm',
          encryption,
        },
        url: `/api/recordings/${recordingId}/upload-session`,
      });
      await app!.inject({
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
        method: 'POST',
        payload: { providerFileId: `drive-file-${recordingId}` },
        url: `/api/recordings/${recordingId}/complete`,
      });
      return recordingId;
    }
    const grantedRecordingId = await recordAndComplete(granted);
    const notGrantedRecordingId = await recordAndComplete(notGranted);

    const deniedPlayback = await app!.inject({
      headers: { cookie: viewer.cookie },
      method: 'GET',
      url: `/api/recordings/${notGrantedRecordingId}/playback`,
    });
    expect(deniedPlayback.statusCode).toBe(404);
    expect(drive.downloadDriveRecordingFile).not.toHaveBeenCalled();

    const ciphertext = Buffer.alloc(1_048_576, 7);
    vi.mocked(drive.downloadDriveRecordingFile).mockResolvedValueOnce(
      new Response(ciphertext),
    );
    const allowedPlayback = await app!.inject({
      headers: { cookie: viewer.cookie },
      method: 'GET',
      url: `/api/recordings/${grantedRecordingId}/playback`,
    });
    expect(allowedPlayback.statusCode).toBe(200);
    expect(allowedPlayback.rawPayload).toEqual(ciphertext);

    grantedDevice.close();
    notGrantedDevice.close();
  });

  it('asks the owner to reconnect Drive when Google rejects its token, instead of a vague failure', async () => {
    const owner = await registerAndSignIn(
      'expired-drive@example.com',
      '10.2.0.31',
    );
    const camera = await pairCamera(owner, 'Porch');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);
    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    const recordingId = created.json<{ recording: { id: string } }>().recording
      .id;
    vi.mocked(drive.refreshDriveAccessToken).mockRejectedValueOnce(
      new drive.DriveReconnectRequiredError(),
    );
    const session = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        byteSize: 1_048_576,
        checksumSha256: 'a'.repeat(64),
        durationMs: 15_000,
        mimeType: 'video/webm',
        encryption,
      },
      url: `/api/recordings/${recordingId}/upload-session`,
    });
    expect(session.statusCode).toBe(409);
    expect(session.json()).toMatchObject({ code: 'drive_reconnect_required' });
    // The dead connection no longer counts, and stays marked as expired so
    // the app keeps saying "Reconnect" rather than "Connect".
    expect(await store!.getGoogleDriveConnection(owner.userId)).toBeNull();
    for (let check = 0; check < 2; check += 1) {
      const status = await app!.inject({
        headers: { cookie: owner.cookie },
        method: 'GET',
        url: '/api/drive/status',
      });
      expect(status.json()).toMatchObject({
        connected: false,
        expired: true,
        recordingsConnected: false,
      });
    }
    device.close();
  });

  it('checks Drive before a recording starts, so nobody records a clip that cannot be saved', async () => {
    const owner = await registerAndSignIn(
      'preflight-drive@example.com',
      '10.2.0.33',
    );
    const camera = await pairCamera(owner, 'Hall');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);
    vi.mocked(drive.refreshDriveAccessToken).mockRejectedValueOnce(
      new drive.DriveReconnectRequiredError(),
    );
    const blocked = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'drive_reconnect_required' });

    // Reconnecting clears the expiry and recording works again.
    await connectDrive(owner.userId);
    const status = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/drive/status',
    });
    expect(status.json()).toMatchObject({
      connected: true,
      expired: false,
      recordingsConnected: true,
    });
    const started = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    expect(started.statusCode).toBe(202);
    device.close();
  });

  it('tells an owner who never connected Drive to connect it', async () => {
    const owner = await registerAndSignIn(
      'never-drive@example.com',
      '10.2.0.34',
    );
    const camera = await pairCamera(owner, 'Garage');
    const attempt = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    expect(attempt.statusCode).toBe(409);
    expect(attempt.json()).toMatchObject({ code: 'drive_not_connected' });
  });

  it('notices an expired Drive connection from the status check, before any recording', async () => {
    const owner = await registerAndSignIn(
      'status-drive@example.com',
      '10.2.0.32',
    );
    await connectDrive(owner.userId);
    vi.mocked(drive.refreshDriveAccessToken).mockRejectedValueOnce(
      new drive.DriveReconnectRequiredError(),
    );
    const status = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/drive/status',
    });
    expect(status.json()).toMatchObject({
      connected: false,
      expired: true,
      recordingsConnected: false,
    });
    const audit = await store!.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE event_type = 'google_drive_connection_expired' AND user_id = $1`,
      [owner.userId],
    );
    expect(audit.rows[0]!.count).toBe(1);
  });

  it('refuses to start a recording while the camera is offline', async () => {
    const owner = await registerAndSignIn(
      'offline-cam@example.com',
      '10.2.0.5',
    );
    const camera = await pairCamera(owner, 'Backyard');
    await connectDrive(owner.userId);

    const attempt = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    expect(attempt.statusCode).toBe(409);
    expect(attempt.json()).toEqual({ error: 'Camera is offline' });
  });

  it('runs the full owner-driven lifecycle: request, upload session, complete, list, delete', async () => {
    const owner = await registerAndSignIn('full-cycle@example.com', '10.2.0.6');
    const camera = await pairCamera(owner, 'Kitchen');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);

    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    expect(created.statusCode).toBe(202);
    const recording = created.json<{
      recording: { id: string; status: string };
    }>().recording;
    expect(recording.status).toBe('requested');

    const listed = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      listed.json<{ recordings: { status: string }[] }>().recordings,
    ).toEqual([expect.objectContaining({ status: 'requested' })]);

    const session = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        byteSize: 1_048_576,
        checksumSha256: 'a'.repeat(64),
        durationMs: 15_000,
        mimeType: 'video/webm',
        encryption,
      },
      url: `/api/recordings/${recording.id}/upload-session`,
    });
    expect(session.statusCode).toBe(201);
    const { uploadUrl } = session.json<{ uploadUrl: string }>();
    expect(uploadUrl).toContain('googleapis.com');
    expect(vi.mocked(drive.initiateDriveRecordingUpload)).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'fake-drive-access-token',
        byteSize: 1_048_576,
        mimeType: 'application/octet-stream',
        origin: 'http://127.0.0.1:5173',
        recordingId: recording.id,
      }),
    );

    const afterSession = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      afterSession.json<{ recordings: { status: string }[] }>().recordings,
    ).toEqual([expect.objectContaining({ status: 'uploading' })]);

    const completed = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { providerFileId: 'drive-file-abc' },
      url: `/api/recordings/${recording.id}/complete`,
    });
    expect(completed.statusCode).toBe(204);
    expect(vi.mocked(drive.verifyDriveRecordingFile)).toHaveBeenCalledWith(
      expect.objectContaining({
        byteSize: 1_048_576,
        mimeType: 'application/octet-stream',
        providerFileId: 'drive-file-abc',
        recordingId: recording.id,
      }),
    );

    const afterComplete = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      afterComplete.json<{ recordings: { status: string }[] }>().recordings,
    ).toEqual([expect.objectContaining({ status: 'available' })]);

    const otherOwner = await registerAndSignIn(
      'other-owner@example.com',
      '10.2.0.66',
    );
    const denied = await app!.inject({
      headers: { cookie: otherOwner.cookie },
      method: 'GET',
      url: `/api/recordings/${recording.id}/playback`,
    });
    expect(denied.statusCode).toBe(404);
    expect(drive.downloadDriveRecordingFile).not.toHaveBeenCalled();

    const ciphertext = Buffer.alloc(1_048_576, 42);
    vi.mocked(drive.downloadDriveRecordingFile).mockResolvedValueOnce(
      new Response(ciphertext),
    );
    const playback = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: `/api/recordings/${recording.id}/playback`,
    });
    expect(playback.statusCode).toBe(200);
    expect(playback.headers['cache-control']).toBe('no-store, private');
    expect(playback.headers['x-beacon-recording-key']).toBe(encryption.dataKey);
    expect(playback.headers['x-beacon-recording-iv']).toBe(encryption.iv);
    expect(playback.rawPayload).toEqual(ciphertext);
    expect(vi.mocked(drive.downloadDriveRecordingFile)).toHaveBeenCalledWith(
      'fake-drive-access-token',
      'drive-file-abc',
    );

    const deleted = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'DELETE',
      url: `/api/recordings/${recording.id}`,
    });
    expect(deleted.statusCode).toBe(204);
    expect(vi.mocked(drive.deleteDriveRecordingFile)).toHaveBeenCalledWith(
      'fake-drive-access-token',
      'drive-file-abc',
    );

    device.close();
  });

  it('dispatches camera-captured manual recordings over the authenticated device socket', async () => {
    const owner = await registerAndSignIn(
      'camera-capture@example.com',
      '10.2.0.61',
    );
    const camera = await pairCamera(owner, 'Entry');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);

    const command = nextMessage(device);
    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId, captureMode: 'camera' },
      url: '/api/recordings',
    });
    expect(created.statusCode).toBe(202);
    const recordingId = created.json<{ recording: { id: string } }>().recording
      .id;
    await expect(command).resolves.toEqual({
      recordingId,
      type: 'recording-request',
    });
    device.close();
  });

  it('paginates /api/recordings newest-first with a keyset cursor', async () => {
    const owner = await registerAndSignIn(
      'recordings-page@example.com',
      '10.2.0.20',
    );
    const camera = await pairCamera(owner, 'Driveway');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);

    const createdIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await app!.inject({
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
        method: 'POST',
        payload: { cameraId: camera.cameraId },
        url: '/api/recordings',
      });
      expect(created.statusCode).toBe(202);
      createdIds.push(
        created.json<{ recording: { id: string } }>().recording.id,
      );
    }
    // Newest-first: the most recently requested recording is createdIds[2].
    const expectedOrder = [...createdIds].reverse();

    const firstPage = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings?limit=2',
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json<{
      recordings: { id: string }[];
      nextCursor: string | null;
    }>();
    expect(firstBody.recordings.map((r) => r.id)).toEqual(
      expectedOrder.slice(0, 2),
    );
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: `/api/recordings?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json<{
      recordings: { id: string }[];
      nextCursor: string | null;
    }>();
    expect(secondBody.recordings.map((r) => r.id)).toEqual(
      expectedOrder.slice(2),
    );
    expect(secondBody.nextCursor).toBeNull();

    device.close();
  });

  it('lets an owner share a clip by link, and revokes it on demand or on replacement', async () => {
    const owner = await registerAndSignIn(
      'share-owner@example.com',
      '10.2.0.30',
    );
    const camera = await pairCamera(owner, 'Front porch');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);

    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    const recordingId = created.json<{ recording: { id: string } }>().recording
      .id;

    // Sharing a clip that hasn't finished uploading yet is refused.
    const tooSoon = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { expiresInHours: 24 },
      url: `/api/recordings/${recordingId}/share-links`,
    });
    expect(tooSoon.statusCode).toBe(409);

    await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        byteSize: 2048,
        checksumSha256: 'b'.repeat(64),
        durationMs: 5_000,
        mimeType: 'video/webm',
        encryption,
      },
      url: `/api/recordings/${recordingId}/upload-session`,
    });
    await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { providerFileId: 'drive-file-share-1' },
      url: `/api/recordings/${recordingId}/complete`,
    });

    const share = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { expiresInHours: 24 },
      url: `/api/recordings/${recordingId}/share-links`,
    });
    expect(share.statusCode).toBe(201);
    const { token, url } = share.json<{
      token: string;
      url: string;
      expiresAt: string;
    }>();
    expect(url).toContain(`/shared/${token}`);

    const status = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: `/api/recordings/${recordingId}/share-links`,
    });
    expect(status.json<{ active: { id: string } | null }>().active).not.toBe(
      null,
    );

    // Unauthenticated: metadata, then a real ciphertext relay identical to
    // the owner's own playback route.
    const metadata = await app!.inject({
      method: 'GET',
      url: `/api/shared-recordings/${token}`,
    });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json<{ expiresAt: string }>().expiresAt).toBeTruthy();

    const ciphertext = Buffer.alloc(2048, 9);
    vi.mocked(drive.downloadDriveRecordingFile).mockResolvedValueOnce(
      new Response(ciphertext),
    );
    const sharedPlayback = await app!.inject({
      method: 'GET',
      url: `/api/shared-recordings/${token}/playback`,
    });
    expect(sharedPlayback.statusCode).toBe(200);
    expect(sharedPlayback.rawPayload).toEqual(ciphertext);
    expect(sharedPlayback.headers['x-beacon-recording-key']).toBe(
      encryption.dataKey,
    );

    // A garbage or unknown token fails exactly like a valid-but-expired one.
    const wrongToken = await app!.inject({
      method: 'GET',
      url: `/api/shared-recordings/${randomBytes(32).toString('base64url')}`,
    });
    expect(wrongToken.statusCode).toBe(404);

    // A second link replaces the first -- the old token stops working.
    const resharedResponse = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { expiresInHours: 1 },
      url: `/api/recordings/${recordingId}/share-links`,
    });
    expect(resharedResponse.statusCode).toBe(201);
    const oldTokenAfterReplacement = await app!.inject({
      method: 'GET',
      url: `/api/shared-recordings/${token}`,
    });
    expect(oldTokenAfterReplacement.statusCode).toBe(404);

    const reshared = resharedResponse.json<{ token: string }>();
    const explicitRevoke = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'DELETE',
      url: `/api/recordings/share-links/${
        status.json<{ active: { id: string } }>().active.id
      }`,
    });
    // The first link was already replaced (revoked) above, so revoking it
    // again by id reports it as gone rather than double-revoking.
    expect(explicitRevoke.statusCode).toBe(404);

    const activeAfterReshare = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: `/api/recordings/${recordingId}/share-links`,
    });
    const currentLinkId = activeAfterReshare.json<{
      active: { id: string } | null;
    }>().active!.id;
    const revokeCurrent = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'DELETE',
      url: `/api/recordings/share-links/${currentLinkId}`,
    });
    expect(revokeCurrent.statusCode).toBe(204);

    const afterRevoke = await app!.inject({
      method: 'GET',
      url: `/api/shared-recordings/${reshared.token}`,
    });
    expect(afterRevoke.statusCode).toBe(404);

    device.close();
  });

  it('still plays a shared clip, without an unhandled rejection, when counting the view fails', async () => {
    const owner = await registerAndSignIn(
      'share-touch-owner@example.com',
      '10.2.0.31',
    );
    const camera = await pairCamera(owner, 'Back door');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app!.inject({
      headers,
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    const recordingId = created.json<{ recording: { id: string } }>().recording
      .id;
    await app!.inject({
      headers,
      method: 'POST',
      payload: {
        byteSize: 2048,
        checksumSha256: 'c'.repeat(64),
        durationMs: 5_000,
        mimeType: 'video/webm',
        encryption,
      },
      url: `/api/recordings/${recordingId}/upload-session`,
    });
    await app!.inject({
      headers,
      method: 'POST',
      payload: { providerFileId: 'drive-file-touch-1' },
      url: `/api/recordings/${recordingId}/complete`,
    });
    const share = await app!.inject({
      headers,
      method: 'POST',
      payload: { expiresInHours: 24 },
      url: `/api/recordings/${recordingId}/share-links`,
    });
    const { token } = share.json<{ token: string }>();

    // The route must attach a rejection handler to the fire-and-forget view
    // count; without one, Node ends the whole process on the rejection.
    const failedCount = Promise.reject(new Error('database unavailable'));
    // Silence Node's own report, without going through the spied method.
    void Promise.prototype.catch.call(failedCount, () => undefined);
    const handled = vi.spyOn(failedCount, 'catch');
    const touch = vi
      .spyOn(store!, 'touchRecordingShareLinkAccess')
      .mockReturnValueOnce(failedCount);
    vi.mocked(drive.downloadDriveRecordingFile).mockResolvedValueOnce(
      new Response(Buffer.alloc(2048, 7)),
    );
    try {
      const playback = await app!.inject({
        method: 'GET',
        url: `/api/shared-recordings/${token}/playback`,
      });
      expect(playback.statusCode).toBe(200);
      expect(handled).toHaveBeenCalledOnce();
    } finally {
      touch.mockRestore();
      failedCount.catch(() => undefined);
      device.close();
    }
  });

  it('removes the clip files from Drive before the account and its Drive connection are deleted (V42)', async () => {
    const owner = await registerAndSignIn(
      'delete-drive-owner@example.com',
      '10.2.0.32',
    );
    const camera = await pairCamera(owner, 'Garage');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app!.inject({
      headers,
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    const recordingId = created.json<{ recording: { id: string } }>().recording
      .id;
    await app!.inject({
      headers,
      method: 'POST',
      payload: {
        byteSize: 2048,
        checksumSha256: 'd'.repeat(64),
        durationMs: 5_000,
        mimeType: 'video/webm',
        encryption,
      },
      url: `/api/recordings/${recordingId}/upload-session`,
    });
    await app!.inject({
      headers,
      method: 'POST',
      payload: { providerFileId: 'drive-file-account-delete' },
      url: `/api/recordings/${recordingId}/complete`,
    });
    device.close();

    const deletion = await app!.inject({
      headers: { ...headers, origin: config!.WEB_ORIGIN },
      method: 'DELETE',
      payload: { confirmation: 'DELETE' },
      url: '/api/account',
    });
    expect(deletion.statusCode).toBe(204);
    expect(drive.deleteDriveRecordingFile).toHaveBeenCalledWith(
      'fake-drive-access-token',
      'drive-file-account-delete',
    );
    expect(drive.revokeDriveRefreshToken).toHaveBeenCalledOnce();
    // The file was removed before the connection was revoked.
    expect(
      vi.mocked(drive.deleteDriveRecordingFile).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(drive.revokeDriveRefreshToken).mock.invocationCallOrder[0]!,
    );
  });

  it('moves a clip key wrapped the old way onto the recording-bound form, and playback still works (V7)', async () => {
    const owner = await registerAndSignIn(
      'rewrap-owner@example.com',
      '10.2.0.33',
    );
    const camera = await pairCamera(owner, 'Attic');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app!.inject({
      headers,
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    const recordingId = created.json<{ recording: { id: string } }>().recording
      .id;
    await app!.inject({
      headers,
      method: 'POST',
      payload: {
        byteSize: 2048,
        checksumSha256: 'e'.repeat(64),
        durationMs: 5_000,
        mimeType: 'video/webm',
        encryption,
      },
      url: `/api/recordings/${recordingId}/upload-session`,
    });
    await app!.inject({
      headers,
      method: 'POST',
      payload: { providerFileId: 'drive-file-rewrap' },
      url: `/api/recordings/${recordingId}/complete`,
    });
    // Put the row back in the form older releases wrote: no binding.
    const cipher = new RecordingKeyCipher(recordingKey);
    const legacy = cipher.wrap(Buffer.from(encryption.dataKey, 'base64url'));
    await store!.pool.query(
      `UPDATE recordings SET encryption_data_key_ciphertext=$2,
              encryption_data_key_iv=$3 WHERE id=$1`,
      [recordingId, legacy.ciphertext, legacy.iv],
    );
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    await runRecordingKeyRewrap(store!, cipher, logger as never);
    expect(logger.info).toHaveBeenCalledWith(
      { rewritten: 1, unreadable: 0 },
      'Recording keys checked',
    );
    const row = await store!.pool.query<{ c: Buffer; i: Buffer }>(
      `SELECT encryption_data_key_ciphertext AS c, encryption_data_key_iv AS i
       FROM recordings WHERE id=$1`,
      [recordingId],
    );
    const stored = { ciphertext: row.rows[0]!.c, iv: row.rows[0]!.i };
    // Now only the right recording and purpose can open it.
    expect(
      cipher.unwrapDetailed(stored, recordingKeyContext(recordingId, 'clip'))
        .current,
    ).toBe(true);
    expect(() =>
      cipher.unwrap(stored, recordingKeyContext(recordingId, 'thumbnail')),
    ).toThrow();
    // Running it again changes nothing.
    await runRecordingKeyRewrap(store!, cipher, logger as never);
    expect(logger.info).toHaveBeenLastCalledWith(
      { rewritten: 0, unreadable: 0 },
      'Recording keys checked',
    );
    // And the clip still plays back through the route.
    vi.mocked(drive.downloadDriveRecordingFile).mockResolvedValueOnce(
      new Response(Buffer.alloc(2048, 3)),
    );
    const playback = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: `/api/recordings/${recordingId}/playback`,
    });
    expect(playback.statusCode).toBe(200);
    expect(playback.headers['x-beacon-recording-key']).toBe(encryption.dataKey);
    device.close();
  });

  it('refuses a non-owner household member from creating or revoking a share link', async () => {
    const owner = await registerAndSignIn(
      'share-nonowner@example.com',
      '10.2.0.31',
    );

    const invite = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        cameraAccess: 'all',
        email: 'share-viewer@example.com',
        role: 'viewer',
      },
      url: '/api/household/invitations',
    });
    const token = invite.json<{ token: string }>().token;
    const viewer = await registerAndSignIn(
      'share-viewer@example.com',
      '10.2.0.32',
    );
    const accepted = await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'POST',
      payload: { token },
      url: '/api/household/invitations/accept',
    });
    const { householdId } = accepted.json<{ householdId: string }>();
    await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'PUT',
      payload: { householdId },
      url: '/api/account/household',
    });

    const attempt = await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'POST',
      payload: { expiresInHours: 24 },
      url: `/api/recordings/${randomUUID()}/share-links`,
    });
    expect(attempt.statusCode).toBe(403);

    const revokeAttempt = await app!.inject({
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      method: 'DELETE',
      url: `/api/recordings/share-links/${randomUUID()}`,
    });
    expect(revokeAttempt.statusCode).toBe(403);
  });

  it('uploads, completes, and relays a clip thumbnail through the same encrypted envelope as the clip', async () => {
    const owner = await registerAndSignIn(
      'thumbnail-owner@example.com',
      '10.2.0.40',
    );
    const camera = await pairCamera(owner, 'Front porch');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);

    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    const recordingId = created.json<{ recording: { id: string } }>().recording
      .id;

    const listedBefore = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      listedBefore.json<{ recordings: { hasThumbnail: boolean }[] }>()
        .recordings[0]!.hasThumbnail,
    ).toBe(false);

    const session = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        byteSize: 4096,
        checksumSha256: 'c'.repeat(64),
        mimeType: 'image/jpeg',
        encryption,
      },
      url: `/api/recordings/${recordingId}/thumbnail-upload-session`,
    });
    expect(session.statusCode).toBe(201);
    expect(session.json<{ uploadUrl: string }>().uploadUrl).toContain(
      'googleapis.com',
    );

    const completed = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { providerFileId: 'drive-thumb-abc' },
      url: `/api/recordings/${recordingId}/thumbnail-complete`,
    });
    expect(completed.statusCode).toBe(204);

    const listedAfter = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      listedAfter.json<{ recordings: { hasThumbnail: boolean }[] }>()
        .recordings[0]!.hasThumbnail,
    ).toBe(true);

    // A second upload attempt is refused: first-write-wins, so a retry can
    // never orphan the already-uploaded Drive file.
    const secondSession = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        byteSize: 4096,
        checksumSha256: 'd'.repeat(64),
        mimeType: 'image/jpeg',
        encryption,
      },
      url: `/api/recordings/${recordingId}/thumbnail-upload-session`,
    });
    expect(secondSession.statusCode).toBe(404);

    const thumbCiphertext = Buffer.alloc(4096, 3);
    vi.mocked(drive.downloadDriveRecordingFile).mockResolvedValueOnce(
      new Response(thumbCiphertext),
    );
    const thumbnail = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: `/api/recordings/${recordingId}/thumbnail`,
    });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.rawPayload).toEqual(thumbCiphertext);
    expect(thumbnail.headers['x-beacon-recording-key']).toBe(
      encryption.dataKey,
    );

    device.close();
  });

  it('reports a verification mismatch instead of trusting the caller, and leaves the recording uploading', async () => {
    const owner = await registerAndSignIn('mismatch@example.com', '10.2.0.7');
    const camera = await pairCamera(owner, 'Garage');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);

    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    const recording = created.json<{ recording: { id: string } }>().recording;
    await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        byteSize: 2_048,
        checksumSha256: 'b'.repeat(64),
        durationMs: 5_000,
        mimeType: 'video/mp4',
        encryption,
      },
      url: `/api/recordings/${recording.id}/upload-session`,
    });

    vi.mocked(drive.verifyDriveRecordingFile).mockRejectedValueOnce(
      new Error('Google Drive recording metadata did not match'),
    );
    const completed = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { providerFileId: 'wrong-file' },
      url: `/api/recordings/${recording.id}/complete`,
    });
    expect(completed.statusCode).toBe(409);

    const afterFailedComplete = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      afterFailedComplete.json<{ recordings: { status: string }[] }>()
        .recordings,
    ).toEqual([expect.objectContaining({ status: 'uploading' })]);

    device.close();
  });

  it('accepts encrypted device uploads and verifies them before availability', async () => {
    const owner = await registerAndSignIn(
      'device-driven@example.com',
      '10.2.0.8',
    );
    const camera = await pairCamera(owner, 'Nursery');
    await connectDrive(owner.userId);
    const device = connectDevice(camera.cameraId, camera.credential);
    await nextMessage(device);

    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraId: camera.cameraId },
      url: '/api/recordings',
    });
    const recording = created.json<{ recording: { id: string } }>().recording;

    const wrongDevice = await app!.inject({
      headers: { Authorization: 'Bearer wrong-device-credential' },
      method: 'POST',
      payload: { reason: 'capture_failed' },
      url: `/api/device/recordings/${recording.id}/fail`,
    });
    expect(wrongDevice.statusCode).toBe(404);

    const failed = await app!.inject({
      headers: { Authorization: `Bearer ${camera.credential}` },
      method: 'POST',
      payload: { reason: 'capture_failed' },
      url: `/api/device/recordings/${recording.id}/fail`,
    });
    expect(failed.statusCode).toBe(204);
    const repeatedFailure = await app!.inject({
      headers: { Authorization: `Bearer ${camera.credential}` },
      method: 'POST',
      payload: { reason: 'upload_failed' },
      url: `/api/device/recordings/${recording.id}/fail`,
    });
    expect(repeatedFailure.statusCode).toBe(204);
    const afterFailure = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      afterFailure.json<{ recordings: { status: string }[] }>().recordings,
    ).toEqual([expect.objectContaining({ status: 'failed' })]);

    const noAuth = await app!.inject({
      method: 'POST',
      payload: {
        byteSize: 4_096,
        checksumSha256: 'c'.repeat(64),
        durationMs: 6_000,
        encryption,
        mimeType: 'video/mp4',
      },
      url: `/api/device/recordings/${recording.id}/upload-session`,
    });
    expect(noAuth.statusCode).toBe(401);

    const session = await app!.inject({
      headers: { Authorization: `Bearer ${camera.credential}` },
      method: 'POST',
      payload: {
        byteSize: 4_096,
        checksumSha256: 'c'.repeat(64),
        durationMs: 6_000,
        encryption,
        mimeType: 'video/mp4',
      },
      url: `/api/device/recordings/${recording.id}/upload-session`,
    });
    expect(session.statusCode).toBe(201);
    expect(session.json<{ uploadUrl: string }>().uploadUrl).toContain(
      'www.googleapis.com',
    );
    expect(vi.mocked(drive.initiateDriveRecordingUpload)).toHaveBeenCalledWith({
      accessToken: 'fake-drive-access-token',
      byteSize: 4_096,
      mimeType: 'application/octet-stream',
      recordingId: recording.id,
    });

    const completed = await app!.inject({
      headers: { Authorization: `Bearer ${camera.credential}` },
      method: 'POST',
      payload: { providerFileId: 'drive-file-device' },
      url: `/api/device/recordings/${recording.id}/complete`,
    });
    expect(completed.statusCode).toBe(204);
    expect(vi.mocked(drive.verifyDriveRecordingFile)).toHaveBeenCalledWith({
      accessToken: 'fake-drive-access-token',
      byteSize: 4_096,
      mimeType: 'application/octet-stream',
      providerFileId: 'drive-file-device',
      recordingId: recording.id,
    });

    const listed = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      listed.json<{ recordings: { status: string }[] }>().recordings,
    ).toEqual([expect.objectContaining({ status: 'available' })]);

    device.close();
  });

  it('auto-starts a recording on motion when enabled, and tells the reporting device its id', async () => {
    const owner = await registerAndSignIn(
      'motion-record@example.com',
      '10.2.0.9',
    );
    const camera = await pairCamera(owner, 'Driveway');
    await connectDrive(owner.userId);

    await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'PUT',
      payload: {
        cooldownSeconds: 30,
        enabled: true,
        quietHours: null,
        recordOnMotion: true,
        sensitivity: 'medium',
      },
      url: `/api/cameras/${camera.cameraId}/motion-settings`,
    });

    const reported = await app!.inject({
      headers: { Authorization: `Bearer ${camera.credential}` },
      method: 'POST',
      payload: { confidence: 0.8 },
      url: `/api/device/cameras/${camera.cameraId}/motion-events`,
    });
    expect(reported.statusCode).toBe(201);
    const { recordingId } = reported.json<{ recordingId?: string }>();
    expect(recordingId).toBeTruthy();

    const listed = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      listed.json<{ recordings: { status: string }[] }>().recordings,
    ).toEqual([expect.objectContaining({ status: 'requested' })]);
  });

  it('does not auto-start a recording on motion when the setting is off', async () => {
    const owner = await registerAndSignIn(
      'motion-no-record@example.com',
      '10.2.0.10',
    );
    const camera = await pairCamera(owner, 'Hallway');
    await connectDrive(owner.userId);

    const reported = await app!.inject({
      headers: { Authorization: `Bearer ${camera.credential}` },
      method: 'POST',
      payload: { confidence: 0.6 },
      url: `/api/device/cameras/${camera.cameraId}/motion-events`,
    });
    expect(reported.statusCode).toBe(201);
    expect(
      reported.json<{ recordingId?: string }>().recordingId,
    ).toBeUndefined();

    const listed = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(listed.json<{ recordings: unknown[] }>().recordings).toHaveLength(0);
  });

  // Exercised at the store level rather than through two real motion-event
  // HTTP calls: the schema's minimum cooldown is a real 30 seconds, so a
  // second report from the same source can't be made to land inside this
  // test without faking timers around a real Postgres connection.
  it('createMotionTriggeredRecording requires Drive connected and refuses to stack a second recording', async () => {
    const owner = await registerAndSignIn(
      'motion-gap@example.com',
      '10.2.0.11',
    );
    const camera = await pairCamera(owner, 'Side yard');
    const user = await store!.findUserByEmail('motion-gap@example.com');
    const accessible = await store!.findAccessibleCamera(
      user!.householdId,
      owner.userId,
      'owner',
      camera.cameraId,
    );
    // A real motion event to satisfy the trigger_motion_event_id FK -- this
    // test exercises createMotionTriggeredRecording's own gating (Drive
    // connection, duplicate-in-flight), not motion event creation, so the
    // same event id is reused across all three attempts below.
    const motionEvent = await store!.createMotionEvent({
      credentialHash: hashSecret(camera.credential),
      publicCameraId: camera.cameraId,
      confidence: 0.5,
      now: new Date(),
    });
    const motionEventId = motionEvent!.motionEventId!;

    expect(
      await store!.createMotionTriggeredRecording({
        cameraSourceId: accessible!.cameraId,
        householdId: user!.householdId,
        motionEventId,
        ownerId: owner.userId,
      }),
    ).toBeNull();

    await connectDrive(owner.userId);
    const created = await store!.createMotionTriggeredRecording({
      cameraSourceId: accessible!.cameraId,
      householdId: user!.householdId,
      motionEventId,
      ownerId: owner.userId,
    });
    expect(created).not.toBeNull();

    // Same camera source, still "requested" -- a second attempt (the same
    // path the next motion report past cooldown would take) must not stack
    // a duplicate recording on top of it.
    expect(
      await store!.createMotionTriggeredRecording({
        cameraSourceId: accessible!.cameraId,
        householdId: user!.householdId,
        motionEventId,
        ownerId: owner.userId,
      }),
    ).toBeNull();

    const listed = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(listed.json<{ recordings: { id: string }[] }>().recordings).toEqual([
      expect.objectContaining({ id: created!.recordingId }),
    ]);
  });
});
