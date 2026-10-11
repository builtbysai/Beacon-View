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

let registrations = 0;

/** Email is configured here, so a password account must verify before it can
 * sign in (V26): register, follow the emailed link, then sign in. */
async function registerVerified(
  email: string,
  password = 'first password value',
): Promise<{ cookie: string; csrf: string }> {
  const mail = stubResend();
  const remoteAddress = `127.0.2.${(registrations += 1)}`;
  const registration = await app!.inject({
    method: 'POST',
    payload: { email, password },
    remoteAddress,
    url: '/api/auth/register',
  });
  expect(registration.statusCode).toBe(202);
  const confirm = await app!.inject({
    method: 'POST',
    payload: { token: tokenFromEmail(mail.calls[0]!) },
    url: '/api/account/email/verify/confirm',
  });
  expect(confirm.statusCode).toBe(204);
  const login = await app!.inject({
    method: 'POST',
    payload: { email, password },
    remoteAddress,
    url: '/api/auth/login',
  });
  expect(login.statusCode).toBe(200);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
  );
  return sessionCookies(login.headers);
}

describe.skipIf(!app || !store)('account recovery API with PostgreSQL', () => {
  beforeEach(async () => {
    await resetTestDatabase(store!.pool);
    // Registration now fires a best-effort verification email itself; give
    // every test a harmless default so that background send never reaches
    // the real network. Tests that care about delivered mail call
    // stubResend() afterward, which replaces this with a call-tracking mock.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    await app?.close();
  });

  it('resets a password by email token and revokes every existing session', async () => {
    const originalSession = await registerVerified('reset@example.com');
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

  it('retires every other reset link once one is used (V46)', async () => {
    await app!.inject({
      method: 'POST',
      payload: {
        email: 'two-links@example.com',
        password: 'first password value',
      },
      remoteAddress: '10.5.5.5',
      url: '/api/auth/register',
    });
    const resend = stubResend();
    for (let index = 0; index < 2; index += 1)
      await app!.inject({
        method: 'POST',
        payload: { email: 'two-links@example.com' },
        remoteAddress: '10.5.5.5',
        url: '/api/auth/password-reset/request',
      });
    const [first, second] = resend.calls
      .filter((call) => call.includes('reset'))
      .map(tokenFromEmail);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    const used = await app!.inject({
      method: 'POST',
      payload: { password: 'brand new password value', token: first },
      remoteAddress: '10.5.5.5',
      url: '/api/auth/password-reset/confirm',
    });
    expect(used.statusCode).toBe(204);
    const other = await app!.inject({
      method: 'POST',
      payload: { password: 'an attacker chosen password', token: second },
      remoteAddress: '10.5.5.5',
      url: '/api/auth/password-reset/confirm',
    });
    expect(other.statusCode).toBe(400);
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

  it('mails a verification link at sign-up and refuses sign-in until it is used (V26)', async () => {
    const resend = stubResend();
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'auto-verify@example.com',
        password: 'first password value',
      },
      // A distinct address so this doesn't share the register rate-limit
      // bucket with other registration calls in this file.
      remoteAddress: '127.0.0.90',
      url: '/api/auth/register',
    });
    expect(registration.statusCode).toBe(202);
    expect(registration.json()).toEqual({
      email: 'auto-verify@example.com',
      verificationRequired: true,
    });
    // No session was issued.
    expect(String(registration.headers['set-cookie'] ?? '')).not.toContain(
      'beacon_session=',
    );
    expect(resend.calls).toHaveLength(1);

    const signIn = () =>
      app!.inject({
        method: 'POST',
        payload: {
          email: 'auto-verify@example.com',
          password: 'first password value',
        },
        remoteAddress: '127.0.0.90',
        url: '/api/auth/login',
      });
    const refused = await signIn();
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'email_not_verified' });
    expect(String(refused.headers['set-cookie'] ?? '')).not.toContain(
      'beacon_session=',
    );
    // The attempt mailed a fresh link, so a lost first email is recoverable.
    expect(resend.calls).toHaveLength(2);
    // A wrong password still says nothing about the account.
    const wrong = await app!.inject({
      method: 'POST',
      payload: {
        email: 'auto-verify@example.com',
        password: 'not the password',
      },
      remoteAddress: '127.0.0.90',
      url: '/api/auth/login',
    });
    expect(wrong.statusCode).toBe(401);

    const confirm = await app!.inject({
      method: 'POST',
      payload: { token: tokenFromEmail(resend.calls[1]!) },
      url: '/api/account/email/verify/confirm',
    });
    expect(confirm.statusCode).toBe(204);
    expect((await signIn()).statusCode).toBe(200);
  });

  it('applies the same rule to the Android sign-up and sign-in (V26)', async () => {
    const resend = stubResend();
    const credentials = {
      email: 'mobile-verify@example.com',
      password: 'first password value',
    };
    const registration = await app!.inject({
      method: 'POST',
      payload: credentials,
      remoteAddress: '127.0.0.94',
      url: '/api/mobile/auth/register',
    });
    expect(registration.statusCode).toBe(202);
    expect(registration.json()).toEqual({
      email: credentials.email,
      verificationRequired: true,
    });
    const refused = await app!.inject({
      method: 'POST',
      payload: credentials,
      remoteAddress: '127.0.0.94',
      url: '/api/mobile/auth/login',
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'email_not_verified' });
    expect(refused.body).not.toContain('sessionToken');
    const confirm = await app!.inject({
      method: 'POST',
      payload: { token: tokenFromEmail(resend.calls.at(-1)!) },
      url: '/api/account/email/verify/confirm',
    });
    expect(confirm.statusCode).toBe(204);
    const allowed = await app!.inject({
      method: 'POST',
      payload: credentials,
      remoteAddress: '127.0.0.94',
      url: '/api/mobile/auth/login',
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ sessionToken: string }>().sessionToken).toBeTruthy();
  });

  it('counts a completed password reset as proof of the email address (V26)', async () => {
    const resend = stubResend();
    await app!.inject({
      method: 'POST',
      payload: {
        email: 'reset-proves@example.com',
        password: 'first password value',
      },
      remoteAddress: '127.0.0.93',
      url: '/api/auth/register',
    });
    await app!.inject({
      method: 'POST',
      payload: { email: 'reset-proves@example.com' },
      remoteAddress: '127.0.0.93',
      url: '/api/auth/password-reset/request',
    });
    const resetMail = resend.calls.find((call) =>
      (JSON.parse(call) as { subject: string }).subject.includes('eset'),
    )!;
    const confirm = await app!.inject({
      method: 'POST',
      payload: {
        password: 'brand new password value',
        token: tokenFromEmail(resetMail),
      },
      remoteAddress: '127.0.0.93',
      url: '/api/auth/password-reset/confirm',
    });
    expect(confirm.statusCode).toBe(204);
    const login = await app!.inject({
      method: 'POST',
      payload: {
        email: 'reset-proves@example.com',
        password: 'brand new password value',
      },
      remoteAddress: '127.0.0.93',
      url: '/api/auth/login',
    });
    expect(login.statusCode).toBe(200);
  });

  it('lets only an account with a verified email send invitations (V47)', async () => {
    const owner = await registerVerified('unverified-inviter@example.com');
    // A session that predates the verification rule, for an unverified address.
    await store!.pool.query(
      "UPDATE users SET email_verified_at = NULL WHERE email = 'unverified-inviter@example.com'",
    );
    const resend = stubResend();
    const invite = () =>
      app!.inject({
        headers: {
          cookie: owner.cookie,
          'x-csrf-token': owner.csrf,
        },
        method: 'POST',
        payload: {
          cameraAccess: 'all',
          email: 'someone@example.com',
          role: 'viewer',
        },
        url: '/api/household/invitations',
      });
    const refused = await invite();
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'email_not_verified' });
    // Nothing was mailed to the stranger.
    expect(resend.calls).toHaveLength(0);
    const requestLink = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      url: '/api/account/email/verify/request',
    });
    expect(requestLink.statusCode).toBe(202);
    const confirm = await app!.inject({
      method: 'POST',
      payload: { token: tokenFromEmail(resend.calls[0]!) },
      url: '/api/account/email/verify/confirm',
    });
    expect(confirm.statusCode).toBe(204);
    expect((await invite()).statusCode).toBe(201);
  });

  it('verifies an email address through an emailed token, idempotently', async () => {
    const session = await registerVerified('verify@example.com');
    await store!.pool.query(
      "UPDATE users SET email_verified_at = NULL WHERE email = 'verify@example.com'",
    );
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
    const session = await registerVerified('reauth@example.com');

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
    const session = await registerVerified('google-session@example.com');
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

  it('links a Google identity to a password account, but never to two accounts at once', async () => {
    // Distinct addresses: every other /api/auth/register call in this file
    // already shares the default IP's 5-per-hour register rate-limit bucket.
    await app!.inject({
      method: 'POST',
      payload: {
        email: 'link-owner@example.com',
        password: 'first password value',
      },
      remoteAddress: '127.0.0.91',
      url: '/api/auth/register',
    });
    const owner = await store!.findUserByEmail('link-owner@example.com');
    await app!.inject({
      method: 'POST',
      payload: {
        email: 'link-other@example.com',
        password: 'first password value',
      },
      remoteAddress: '127.0.0.92',
      url: '/api/auth/register',
    });
    const other = await store!.findUserByEmail('link-other@example.com');

    await store!.linkGoogleAccount(
      owner!.id,
      'google-subject-shared',
      'https://example.com/avatar.png',
    );
    const linked = await store!.findUserByGoogleSubject(
      'google-subject-shared',
    );
    expect(linked?.id).toBe(owner!.id);
    expect(linked?.avatarUrl).toBe('https://example.com/avatar.png');

    await expect(
      store!.linkGoogleAccount(other!.id, 'google-subject-shared', null),
    ).rejects.toMatchObject({ code: '23505' });
    // The failed attempt must not have disturbed the original link.
    expect(
      (await store!.findUserByGoogleSubject('google-subject-shared'))?.id,
    ).toBe(owner!.id);
  });
});
