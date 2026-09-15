import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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
      RESEND_API_KEY: 'test-resend-key',
      RESEND_FROM: 'Beacon <noreply@example.com>',
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

function stubResend(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: unknown, init?: RequestInit) => {
      calls.push(typeof init?.body === 'string' ? init.body : '');
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  return { calls };
}

function tokenFromEmail(body: string): string {
  const text = (JSON.parse(body) as { text: string }).text;
  const match = /token=([^\s&]+)/u.exec(text);
  if (!match) throw new Error('No token found in delivered email');
  return decodeURIComponent(match[1]!);
}

describe.skipIf(!app || !store)('account recovery API with PostgreSQL', () => {
  beforeEach(async () => {
    await resetTestDatabase(store!.pool);
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    await app?.close();
  });

  it('resets a password by email token and revokes every existing session', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: { email: 'reset@example.com', password: 'first password value' },
      url: '/api/auth/register',
    });
    const originalSession = sessionCookies(registration.headers);
    const secondLogin = await app!.inject({
      method: 'POST',
      payload: { email: 'reset@example.com', password: 'first password value' },
      url: '/api/auth/login',
    });
    const secondSession = sessionCookies(secondLogin.headers);

    const resend = stubResend();
    const request = await app!.inject({
      method: 'POST',
      payload: { email: 'RESET@example.com' },
      url: '/api/auth/password-reset/request',
    });
    expect(request.statusCode).toBe(202);
    expect(resend.calls).toHaveLength(1);
    const token = tokenFromEmail(resend.calls[0]!);

    const confirm = await app!.inject({
      method: 'POST',
      payload: { password: 'brand new password value', token },
      url: '/api/auth/password-reset/confirm',
    });
    expect(confirm.statusCode).toBe(204);
    expect(resend.calls).toHaveLength(2);
    expect(
      (JSON.parse(resend.calls[1]!) as { subject: string }).subject,
    ).toContain('password was changed');

    for (const session of [originalSession, secondSession]) {
      const me = await app!.inject({
        headers: { cookie: session.cookie },
        method: 'GET',
        url: '/api/auth/me',
      });
      expect(me.statusCode).toBe(401);
    }

    const oldPasswordLogin = await app!.inject({
      method: 'POST',
      payload: { email: 'reset@example.com', password: 'first password value' },
      url: '/api/auth/login',
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await app!.inject({
      method: 'POST',
      payload: {
        email: 'reset@example.com',
        password: 'brand new password value',
      },
      url: '/api/auth/login',
    });
    expect(newPasswordLogin.statusCode).toBe(200);
  });

  it('rejects an invalid or already-used reset token', async () => {
    await app!.inject({
      method: 'POST',
      payload: {
        email: 'reuse@example.com',
        password: 'first password value',
      },
      url: '/api/auth/register',
    });
    const resend = stubResend();
    await app!.inject({
      method: 'POST',
      payload: { email: 'reuse@example.com' },
      url: '/api/auth/password-reset/request',
    });
    const token = tokenFromEmail(resend.calls[0]!);

    const garbage = await app!.inject({
      method: 'POST',
      payload: { password: 'another new password', token: 'not-a-real-token' },
      url: '/api/auth/password-reset/confirm',
    });
    expect(garbage.statusCode).toBe(400);

    const first = await app!.inject({
      method: 'POST',
      payload: { password: 'another new password', token },
      url: '/api/auth/password-reset/confirm',
    });
    expect(first.statusCode).toBe(204);

    const reused = await app!.inject({
      method: 'POST',
      payload: { password: 'yet another password', token },
      url: '/api/auth/password-reset/confirm',
    });
    expect(reused.statusCode).toBe(400);
  });

  it('never leaks whether an email is registered', async () => {
    const resend = stubResend();
    const response = await app!.inject({
      method: 'POST',
      payload: { email: 'unknown-nobody@example.com' },
      url: '/api/auth/password-reset/request',
    });
    expect(response.statusCode).toBe(202);
    expect(resend.calls).toHaveLength(0);
  });

  it('points Google-only accounts at Google sign-in instead of a usable token', async () => {
    await store!.createGoogleAccount(
      'google-only@example.com',
      'google-subject-1',
      '127.0.0.1',
    );
    const resend = stubResend();
    const response = await app!.inject({
      method: 'POST',
      payload: { email: 'google-only@example.com' },
      url: '/api/auth/password-reset/request',
    });
    expect(response.statusCode).toBe(202);
    expect(resend.calls).toHaveLength(1);
    const body = JSON.parse(resend.calls[0]!) as { text: string };
    expect(body.text).not.toContain('token=');
    expect(body.text).toContain('Google');
    const tokens = await store!.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM password_reset_tokens',
    );
    expect(tokens.rows[0]!.count).toBe(0);
  });

  it('verifies an email address through an emailed token, idempotently', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'verify@example.com',
        password: 'first password value',
      },
      url: '/api/auth/register',
    });
    const session = sessionCookies(registration.headers);
    const resend = stubResend();

    const request = await app!.inject({
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      method: 'POST',
      url: '/api/account/email/verify/request',
    });
    expect(request.statusCode).toBe(202);
    const token = tokenFromEmail(resend.calls[0]!);

    const confirm = await app!.inject({
      method: 'POST',
      payload: { token },
      url: '/api/account/email/verify/confirm',
    });
    expect(confirm.statusCode).toBe(204);

    const noop = await app!.inject({
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      method: 'POST',
      url: '/api/account/email/verify/request',
    });
    expect(noop.statusCode).toBe(204);
    expect(resend.calls).toHaveLength(1);
  });

  it('reauthenticates a password session without a fresh login', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'reauth@example.com',
        password: 'first password value',
      },
      url: '/api/auth/register',
    });
    const session = sessionCookies(registration.headers);

    const wrong = await app!.inject({
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      method: 'POST',
      payload: { password: 'totally the wrong password' },
      url: '/api/account/reauth',
    });
    expect(wrong.statusCode).toBe(401);

    const right = await app!.inject({
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      method: 'POST',
      payload: { password: 'first password value' },
      url: '/api/account/reauth',
    });
    expect(right.statusCode).toBe(204);
  });

  it('refuses password reauthentication for a Google-only session', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'google-session@example.com',
        password: 'first password value',
      },
      url: '/api/auth/register',
    });
    const session = sessionCookies(registration.headers);
    const user = await store!.findUserByEmail('google-session@example.com');
    await store!.pool.query(
      `UPDATE users SET password_hash = NULL, google_subject = 'simulated-google-subject' WHERE id = $1`,
      [user!.id],
    );

    const response = await app!.inject({
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      method: 'POST',
      payload: { password: 'anything at all here' },
      url: '/api/account/reauth',
    });
    expect(response.statusCode).toBe(409);
  });
});
