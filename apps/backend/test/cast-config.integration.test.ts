import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
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
const castApp =
  store && config
    ? buildApp({ ...config, CAST_APP_ID: '0A1B2C3D' }, store)
    : null;

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

async function signedInOwner(target = app) {
  const registration = await target!.inject({
    method: 'POST',
    payload: {
      email: 'modes-routes@example.com',
      password: 'correct horse battery staple',
    },
    url: '/api/auth/register',
  });
  return sessionCookies(registration.headers);
}

describe.skipIf(!app || !castApp || !store)('cast configuration', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => {
    await app?.close();
  });

  it('requires a signed-in session', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/cast-config',
    });
    expect(response.statusCode).toBe(401);
  });

  it('reports no application until one is configured, so the button stays hidden', async () => {
    const owner = await signedInOwner();
    const response = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/cast-config',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ appId: null });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('reports the configured Cast application', async () => {
    const owner = await signedInOwner(castApp);
    const response = await castApp!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/cast-config',
    });
    expect(response.json()).toEqual({ appId: '0A1B2C3D' });
  });
});
