import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { pkceChallenge } from '../src/desktop-google-handoff.js';
import { hashPassword } from '../src/security.js';
import { PostgresStore } from '../src/store.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

const google = vi.hoisted(() => ({
  payload: {
    email: 'desktop-owner@example.com',
    email_verified: true,
    picture: undefined as string | undefined,
    sub: 'google-subject-desktop',
  },
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    generateAuthUrl(options: { state: string }): string {
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(options.state)}`;
    }
    getToken(): Promise<{ tokens: { id_token: string } }> {
      return Promise.resolve({ tokens: { id_token: 'simulated-id-token' } });
    }
    verifyIdToken(): Promise<{ getPayload: () => typeof google.payload }> {
      return Promise.resolve({ getPayload: () => google.payload });
    }
  },
}));

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
      GOOGLE_OAUTH_CLIENT_ID: 'desktop-test-client',
      GOOGLE_OAUTH_CLIENT_SECRET: 'desktop-test-secret',
      GOOGLE_OAUTH_REDIRECT_URI:
        'http://127.0.0.1:5173/api/auth/google/callback',
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

function cookiePairs(headers: Record<string, unknown>): string[] {
  const values = headers['set-cookie'];
  return (Array.isArray(values) ? values : [values])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';')[0]!)
    .filter((pair) => !pair.endsWith('='));
}

function newVerifier(): { challenge: string; verifier: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { challenge: pkceChallenge(verifier), verifier };
}

/** Runs the browser half of the flow and returns the deep-link handoff code. */
async function browserSignIn(challenge: string): Promise<string> {
  const start = await app!.inject({
    method: 'GET',
    url: `/api/auth/google?platform=desktop&challenge=${challenge}`,
  });
  expect(start.statusCode).toBe(302);
  const state = new URL(String(start.headers.location)).searchParams.get(
    'state',
  );
  expect(state).toMatch(/^desktop\./);
  const callback = await app!.inject({
    headers: { cookie: cookiePairs(start.headers).join('; ') },
    method: 'GET',
    url: `/api/auth/google/callback?code=simulated&state=${encodeURIComponent(state!)}`,
  });
  expect(callback.statusCode).toBe(302);
  const deepLink = new URL(String(callback.headers.location));
  expect(`${deepLink.protocol}//${deepLink.host}${deepLink.pathname}`).toBe(
    'beaconsecureview://auth/desktop',
  );
  const code = deepLink.searchParams.get('code');
  expect(code).toBeTruthy();
  return code!;
}

function exchange(
  code: string,
  verifier: string,
  headers: Record<string, string> = { 'x-beacon-desktop': '1' },
) {
  return app!.inject({
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
    payload: JSON.stringify({ code, verifier }),
    url: '/api/desktop/auth/google',
  });
}

describe.skipIf(!app || !store)('desktop Google sign-in handoff', () => {
  beforeEach(async () => {
    await resetTestDatabase(store!.pool);
    google.payload.email = 'desktop-owner@example.com';
    google.payload.sub = 'google-subject-desktop';
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires a PKCE challenge for desktop and refuses one elsewhere', async () => {
    const { challenge } = newVerifier();
    for (const url of [
      '/api/auth/google?platform=desktop',
      `/api/auth/google?challenge=${challenge}`,
      `/api/auth/google?platform=android&challenge=${challenge}`,
      '/api/auth/google?platform=desktop&challenge=short',
    ]) {
      const response = await app!.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(400);
    }
  });

  it('signs the desktop webview in with the matching verifier', async () => {
    const { challenge, verifier } = newVerifier();
    const code = await browserSignIn(challenge);
    const response = await exchange(code, verifier);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ redirect: '/', status: 'signedIn' });
    const cookies = cookiePairs(response.headers);
    expect(cookies.some((pair) => pair.startsWith('beacon_session='))).toBe(
      true,
    );
    const me = await app!.inject({
      headers: { cookie: cookies.join('; ') },
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.stringify(me.json())).toContain('desktop-owner@example.com');
  });

  it('never redeems a code with the wrong verifier, even afterwards with the right one', async () => {
    const { challenge, verifier } = newVerifier();
    const code = await browserSignIn(challenge);
    const intercepted = await exchange(code, newVerifier().verifier);
    expect(intercepted.statusCode).toBe(401);
    expect(cookiePairs(intercepted.headers)).toEqual([]);
    expect((await exchange(code, verifier)).statusCode).toBe(401);
  });

  it('rejects exchanges a cross-site form could send', async () => {
    const { challenge, verifier } = newVerifier();
    const code = await browserSignIn(challenge);
    expect((await exchange(code, verifier, {})).statusCode).toBe(401);
    const formPost = await app!.inject({
      headers: {
        'content-type': 'text/plain',
        'x-beacon-desktop': '1',
      },
      method: 'POST',
      payload: JSON.stringify({ code, verifier }),
      url: '/api/desktop/auth/google',
    });
    expect(formPost.statusCode).toBe(401);
  });

  it('carries a pending Google link into the webview for an existing password account', async () => {
    const password = 'correct horse battery staple';
    await store!.createAccount(
      'desktop-owner@example.com',
      await hashPassword(password),
      '127.0.0.1',
    );
    const { challenge, verifier } = newVerifier();
    const code = await browserSignIn(challenge);
    const response = await exchange(code, verifier);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'linkRequired' });
    const cookies = cookiePairs(response.headers);
    expect(cookies.some((pair) => pair.startsWith('beacon_session='))).toBe(
      false,
    );
    const login = await app!.inject({
      headers: { cookie: cookies.join('; ') },
      method: 'POST',
      payload: { email: 'desktop-owner@example.com', password },
      url: '/api/auth/login',
    });
    expect(login.statusCode).toBe(200);
    expect(
      (await store!.findUserByGoogleSubject('google-subject-desktop'))?.email,
    ).toBe('desktop-owner@example.com');
  });

  it('reports a failed desktop sign-in back through the deep link', async () => {
    const { challenge } = newVerifier();
    const start = await app!.inject({
      method: 'GET',
      url: `/api/auth/google?platform=desktop&challenge=${challenge}`,
    });
    const callback = await app!.inject({
      headers: { cookie: cookiePairs(start.headers).join('; ') },
      method: 'GET',
      url: '/api/auth/google/callback?code=simulated&state=tampered',
    });
    expect(callback.headers.location).toBe(
      'beaconsecureview://auth/desktop?status=failed',
    );
  });
});
