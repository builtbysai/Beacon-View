import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const baseConfig: AppConfig = {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
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
};

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => {
  await Promise.all([...apps].map(async (app) => app.close()));
  apps.clear();
});

/** An invalid body is rejected right after the per-address registration
 * limit, so this exercises the limiter without touching the database. */
async function register(
  app: ReturnType<typeof buildApp>,
  forwardedFor: string,
  socketAddress = '172.18.0.5',
) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { 'x-forwarded-for': forwardedFor },
    payload: {},
    remoteAddress: socketAddress,
  });
}

describe('client address behind a reverse proxy (F1)', () => {
  it('ignores a client-chosen X-Forwarded-For when no proxy is trusted', async () => {
    const app = buildApp(baseConfig);
    apps.add(app);
    for (let index = 0; index < 5; index += 1)
      expect((await register(app, `203.0.113.${index}`)).statusCode).toBe(400);
    // A sixth "different" client is still the same socket address.
    expect((await register(app, '203.0.113.99')).statusCode).toBe(429);
  });

  it('uses the address the trusted proxy appended, not one the client supplied', async () => {
    const app = buildApp({
      ...baseConfig,
      TRUSTED_PROXY_CIDRS: ['172.16.0.0/12'],
    });
    apps.add(app);
    // Caddy appends the real peer last; anything before it is client-supplied.
    for (let index = 0; index < 5; index += 1)
      expect(
        (await register(app, `198.51.100.${index}, 203.0.113.7`)).statusCode,
      ).toBe(400);
    expect((await register(app, '198.51.100.77, 203.0.113.7')).statusCode).toBe(
      429,
    );
    // A different real client is not locked out by the first one.
    expect((await register(app, '203.0.113.8')).statusCode).toBe(400);
  });
});
