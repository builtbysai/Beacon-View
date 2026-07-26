import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { PostgresStore } from '../src/store.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

const databaseUrl = testDatabaseUrl();
const store = databaseUrl ? new PostgresStore(databaseUrl) : null;
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

describe.skipIf(!app || !store)('authentication API with PostgreSQL', () => {
  beforeEach(async () => {
    await resetTestDatabase(store!.pool);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a default household and rejects a duplicate normalized email', async () => {
    const first = await app!.inject({
      method: 'POST',
      payload: {
        email: ' Owner@Example.COM ',
        password: 'correct horse battery staple',
      },
      url: '/api/auth/register',
    });
    expect(first.statusCode).toBe(201);
    expect(first.json<{ user: { email: string } }>().user.email).toBe(
      'owner@example.com',
    );

    const duplicate = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'another secure test password',
      },
      url: '/api/auth/register',
    });
    expect(duplicate.statusCode).toBe(409);
    const ownership = await store!.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM households',
    );
    expect(ownership.rows[0]!.count).toBe(1);
  });

  it('uses generic login errors and revokes a session with CSRF protection', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'correct horse battery staple',
      },
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);

    const wrongPassword = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'incorrect password value',
      },
      url: '/api/auth/login',
    });
    const unknownAccount = await app!.inject({
      method: 'POST',
      payload: {
        email: 'unknown@example.com',
        password: 'incorrect password value',
      },
      url: '/api/auth/login',
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.body).toBe(wrongPassword.body);

    const missingCsrf = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(missingCsrf.statusCode).toBe(403);

    const logout = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('immediately rejects idle-expired sessions', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'correct horse battery staple',
      },
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    await store!.pool.query(
      "UPDATE browser_sessions SET idle_expires_at = now() - interval '1 second'",
    );
    const response = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(response.statusCode).toBe(401);
  });
});
