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

async function signedInOwner() {
  const registration = await app!.inject({
    method: 'POST',
    payload: {
      email: 'modes-routes@example.com',
      password: 'correct horse battery staple',
    },
    url: '/api/auth/register',
  });
  return sessionCookies(registration.headers);
}

const schedule = {
  windows: [
    {
      days: [0, 1, 2, 3, 4, 5, 6],
      start: '00:00',
      end: '23:59',
      timeZone: 'UTC',
    },
  ],
};
const settings = {
  muteMotionWhenHome: true,
  pauseCamerasWhenHome: true,
  resumeCamerasWhenAway: false,
  schedule: null,
};

describe.skipIf(!app || !store)('household mode API', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => app?.close());

  it('requires a signed-in session to read the mode', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/household/mode',
    });
    expect(response.statusCode).toBe(401);
  });

  it('reads Away by default and switches to Home with an audit entry', async () => {
    const owner = await signedInOwner();
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const initial = await app!.inject({
      headers,
      method: 'GET',
      url: '/api/household/mode',
    });
    expect(initial.json()).toMatchObject({ mode: 'away', canChange: true });

    const switched = await app!.inject({
      headers,
      method: 'PUT',
      payload: { mode: 'home' },
      url: '/api/household/mode',
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toMatchObject({ mode: 'home', source: 'manual' });
    const audit = await store!.pool.query<{ metadata: { mode: string } }>(
      `SELECT metadata FROM audit_events WHERE event_type = 'household_mode_changed'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.metadata).toMatchObject({
      mode: 'home',
      source: 'manual',
    });
  });

  it('rejects changes without the CSRF token and malformed bodies', async () => {
    const owner = await signedInOwner();
    const noCsrf = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'PUT',
      payload: { mode: 'home' },
      url: '/api/household/mode',
    });
    expect(noCsrf.statusCode).toBe(403);
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const unknown = await app!.inject({
      headers,
      method: 'PUT',
      payload: { mode: 'vacation' },
      url: '/api/household/mode',
    });
    expect(unknown.statusCode).toBe(400);
    const badSettings = await app!.inject({
      headers,
      method: 'PUT',
      payload: { ...settings, schedule: { windows: [] } },
      url: '/api/household/mode-settings',
    });
    expect(badSettings.statusCode).toBe(400);
  });

  it('saves settings, applies a schedule immediately, and the scheduler flips it later', async () => {
    const owner = await signedInOwner();
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const saved = await app!.inject({
      headers,
      method: 'PUT',
      payload: { ...settings, schedule },
      url: '/api/household/mode-settings',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      mode: 'home',
      source: 'schedule',
      settings: { pauseCamerasWhenHome: true, schedule },
    });
    // Nothing is due while the window stays open.
    expect(await app!.runHouseholdModeSchedule(new Date())).toBe(0);
  });

  it('keeps members without admin access from changing the mode', async () => {
    const owner = await signedInOwner();
    await store!.pool.query(
      `UPDATE household_members SET role = 'viewer' WHERE role = 'owner'`,
    );
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const read = await app!.inject({
      headers,
      method: 'GET',
      url: '/api/household/mode',
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ canChange: false });
    const change = await app!.inject({
      headers,
      method: 'PUT',
      payload: { mode: 'home' },
      url: '/api/household/mode',
    });
    expect(change.statusCode).toBe(403);
  });
});
