import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
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
    }
  : null;
const app = store && config ? buildApp(config, store) : null;

function cookies(headers: Record<string, unknown>) {
  const values = headers['set-cookie'];
  const pairs = (Array.isArray(values) ? values : [values])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';')[0]!);
  const csrf = pairs
    .find((pair) => pair.startsWith('beacon_csrf='))
    ?.split('=')[1];
  return { cookie: pairs.join('; '), csrf: csrf ?? '' };
}

async function owner(email: string, remoteAddress: string) {
  const registration = await app!.inject({
    method: 'POST',
    payload: { email, password: 'correct horse battery staple' },
    remoteAddress,
    url: '/api/auth/register',
  });
  const account = await store!.findUserByEmail(email);
  if (!account) throw new Error('Expected account');
  return { account, session: cookies(registration.headers) };
}

describe.skipIf(!app || !store)('camera use cases (ADR 0084)', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => app?.close());

  it('applies the motion preset to an Android camera but keeps its quiet hours', async () => {
    const { account, session } = await owner(
      'usecase@example.com',
      '127.0.0.21',
    );
    await store!.createPairingCode(
      account.householdId,
      hashSecret('USECASE234'),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret('USECASE234'),
      credentialHash: hashSecret('use-case-credential'),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Hallway phone',
      now: new Date(),
    });
    if (!device || typeof device === 'string')
      throw new Error('Expected device');
    const [camera] = await store!.listCameras(account.householdId);
    const quietHours = { end: '07:00', start: '22:00', timeZone: 'UTC' };
    await store!.updateMotionSettings(
      account.householdId,
      camera!.publicCameraId,
      {
        cooldownSeconds: 300,
        enabled: false,
        quietHours,
        recordOnMotion: false,
        sensitivity: 'low',
      },
    );

    const response = await app!.inject({
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      method: 'PUT',
      payload: { useCase: 'doorbell' },
      url: `/api/cameras/${camera!.publicCameraId}/use-case`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      motionPresetApplied: true,
      useCase: 'doorbell',
    });
    const [settings] = await store!.listMotionSettings(
      account.householdId,
      device.publicDeviceId,
    );
    expect(settings).toMatchObject({
      cooldownSeconds: 30,
      enabled: true,
      quietHours,
      recordOnMotion: true,
      sensitivity: 'high',
    });
    const [listed] = await store!.listCameras(account.householdId);
    expect(listed!.useCase).toBe('doorbell');
  });

  it('labels a browser camera without touching motion settings, and stays inside the household', async () => {
    const first = await owner('browser-usecase@example.com', '127.0.0.22');
    const other = await owner('other-usecase@example.com', '127.0.0.23');
    const browser = await store!.registerBrowserDevice({
      householdId: first.account.householdId,
      installationId: randomUUID(),
      name: 'Office laptop',
      now: new Date(),
      sources: [
        { facing: 'external', name: 'Webcam', sourceKey: 'browser:webcam' },
      ],
    });
    const cameraId = browser.cameras[0]!.publicCameraId;

    const labelled = await app!.inject({
      headers: {
        cookie: first.session.cookie,
        'x-csrf-token': first.session.csrf,
      },
      method: 'PUT',
      payload: { useCase: 'baby' },
      url: `/api/cameras/${cameraId}/use-case`,
    });
    expect(labelled.json()).toEqual({
      motionPresetApplied: false,
      useCase: 'baby',
    });

    const foreign = await app!.inject({
      headers: {
        cookie: other.session.cookie,
        'x-csrf-token': other.session.csrf,
      },
      method: 'PUT',
      payload: { useCase: 'security' },
      url: `/api/cameras/${cameraId}/use-case`,
    });
    expect(foreign.statusCode).toBe(404);

    const invalid = await app!.inject({
      headers: {
        cookie: first.session.cookie,
        'x-csrf-token': first.session.csrf,
      },
      method: 'PUT',
      payload: { useCase: 'dashcam' },
      url: `/api/cameras/${cameraId}/use-case`,
    });
    expect(invalid.statusCode).toBe(400);
  });
});
