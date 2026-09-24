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
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

vi.mock('../src/google-drive-client.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/google-drive-client.js')>();
  return {
    ...actual,
    deleteDriveRecordingFile: vi.fn().mockResolvedValue(undefined),
    initiateDriveRecordingUpload: vi
      .fn()
      .mockResolvedValue(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fake',
      ),
    refreshDriveAccessToken: vi
      .fn()
      .mockResolvedValue('fake-drive-access-token'),
    verifyDriveRecordingFile: vi.fn().mockResolvedValue(undefined),
  };
});

const { buildApp } = await import('../src/app.js');
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
    expect(attempt.json()).toEqual({
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
      payload: { email: 'viewer-role@example.com', role: 'viewer' },
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

  it('blocks legacy device upload routes so they cannot export plaintext clips', async () => {
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

    const noAuth = await app!.inject({
      method: 'POST',
      payload: {
        byteSize: 4_096,
        checksumSha256: 'c'.repeat(64),
        durationMs: 6_000,
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
        mimeType: 'video/mp4',
      },
      url: `/api/device/recordings/${recording.id}/upload-session`,
    });
    expect(session.statusCode).toBe(409);

    const completed = await app!.inject({
      headers: { Authorization: `Bearer ${camera.credential}` },
      method: 'POST',
      payload: { providerFileId: 'drive-file-device' },
      url: `/api/device/recordings/${recording.id}/complete`,
    });
    expect(completed.statusCode).toBe(409);

    const listed = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/recordings',
    });
    expect(
      listed.json<{ recordings: { status: string }[] }>().recordings,
    ).toEqual([expect.objectContaining({ status: 'requested' })]);

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

    expect(
      await store!.createMotionTriggeredRecording({
        cameraSourceId: accessible!.cameraId,
        householdId: user!.householdId,
        ownerId: owner.userId,
      }),
    ).toBeNull();

    await connectDrive(owner.userId);
    const created = await store!.createMotionTriggeredRecording({
      cameraSourceId: accessible!.cameraId,
      householdId: user!.householdId,
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
