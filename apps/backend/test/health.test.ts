import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import type { AppConfig } from '../src/config.js';
import type { MilestoneStore } from '../src/store.js';

const config: AppConfig = {
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

describe('GET /health', () => {
  it('returns a structured healthy response', async () => {
    const app = buildApp(config);
    apps.add(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: 'backend', status: 'ok' });
    expect(response.json()).toHaveProperty('timestamp');
  });
});

describe('GET /api/capabilities', () => {
  it('reports unavailable optional integrations without exposing configuration', async () => {
    const app = buildApp(config);
    apps.add(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      auth: { google: false },
      contact: false,
      googleDrive: false,
      notifications: { firebase: false, webPush: false },
      realtime: true,
      recordings: false,
    });
  });

  it('returns flags for configured integrations without returning secret values', async () => {
    const key = Buffer.alloc(32, 7).toString('base64url');
    const configured = {
      ...config,
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'private-client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/callback',
      GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY: key,
      NOTIFICATION_ENCRYPTION_KEY: key,
      NOTIFICATION_FINGERPRINT_KEY: key,
      WEB_PUSH_VAPID_PUBLIC_KEY: 'public-vapid-key',
      WEB_PUSH_VAPID_PRIVATE_KEY: 'private-vapid-key',
      WEB_PUSH_VAPID_SUBJECT: 'mailto:example@example.com',
    };
    const app = buildApp(configured);
    apps.add(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      auth: { google: true },
      googleDrive: true,
      notifications: { firebase: false, webPush: true },
      recordings: true,
    });
    expect(response.body).not.toContain('private-');
    expect(response.body).not.toContain(key);
  });
});

describe('GET /ready', () => {
  it('reports ready only after the store accepts a database probe', async () => {
    const app = buildApp(config, {
      close: () => Promise.resolve(),
      isReady: () => Promise.resolve(true),
    } as unknown as MilestoneStore);
    apps.add(app);

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: 'backend', status: 'ok' });
  });

  it('does not expose database errors when the readiness probe fails', async () => {
    const app = buildApp(config, {
      close: () => Promise.resolve(),
      isReady: () =>
        Promise.reject(
          new Error('database connection details must stay private'),
        ),
    } as unknown as MilestoneStore);
    apps.add(app);

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      service: 'backend',
      status: 'unavailable',
    });
    expect(response.body).not.toContain('database connection details');
  });
});

describe('POST /api/contact', () => {
  it('validates input and does not attempt delivery when the honeypot is filled', async () => {
    const app = buildApp(config);
    apps.add(app);

    const invalid = await app.inject({
      method: 'POST',
      payload: { email: 'not-an-email' },
      url: '/api/contact',
    });
    expect(invalid.statusCode).toBe(400);

    const honeypot = await app.inject({
      method: 'POST',
      payload: {
        email: 'person@example.com',
        message: 'Hello',
        subject: 'Support',
        website: 'bot-filled-this',
      },
      url: '/api/contact',
    });
    expect(honeypot.statusCode).toBe(204);

    const unavailable = await app.inject({
      method: 'POST',
      payload: {
        email: 'person@example.com',
        message: 'Hello',
        subject: 'Support',
      },
      url: '/api/contact',
    });
    expect(unavailable.statusCode).toBe(503);
  });
});

describe('environment configuration', () => {
  it('rejects insecure signaling in production', () => {
    expect(() =>
      parseConfig({
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
        NODE_ENV: 'production',
        TURN_SHARED_SECRET: 'test-shared-secret-with-at-least-32-bytes',
      }),
    ).toThrow('SIGNALING_PUBLIC_URL');
  });

  it('refuses two secrets that are the same value (V27)', () => {
    const shared = 'S'.repeat(43);
    expect(() =>
      parseConfig({
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
        GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY: shared,
        GOOGLE_OAUTH_CLIENT_ID: 'id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
        GOOGLE_OAUTH_REDIRECT_URI:
          'http://127.0.0.1:5173/api/auth/google/callback',
        NODE_ENV: 'test',
        RECORDING_ENCRYPTION_KEY: shared,
        TURN_SHARED_SECRET: 'test-shared-secret-with-at-least-32-bytes',
      }),
    ).toThrow(
      'RECORDING_ENCRYPTION_KEY must differ from GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY',
    );
  });

  it('rejects the documented local TURN shared secret in production', () => {
    expect(() =>
      parseConfig({
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
        NODE_ENV: 'production',
        PUBLIC_BACKEND_ORIGIN: 'https://api.example.test',
        SIGNALING_PUBLIC_URL: 'wss://api.example.test/api/signaling',
        TURN_SHARED_SECRET: 'local-development-turn-shared-secret',
        WEB_ORIGIN: 'https://viewer.example.test',
      }),
    ).toThrow('TURN_SHARED_SECRET');
  });

  it('accepts an explicit secure LAN development origin and reachable ICE URLs', () => {
    const lan = parseConfig({
      ALLOW_INSECURE_LOCAL_DEV: 'false',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
      DEVICE_STUN_URL: 'stun:192.0.2.10:3478',
      DEVICE_TURN_TCP_URL: 'turn:192.0.2.10:3478?transport=tcp',
      DEVICE_TURN_URL: 'turn:192.0.2.10:3478?transport=udp',
      HOST: '0.0.0.0',
      PUBLIC_BACKEND_ORIGIN: 'https://192.0.2.10:8443',
      SIGNALING_PUBLIC_URL: 'wss://192.0.2.10:8443/api/signaling',
      TURN_SHARED_SECRET: 'test-shared-secret-with-at-least-32-bytes',
      VIEWER_STUN_URL: 'stun:192.0.2.10:3478',
      VIEWER_TURN_TCP_URL: 'turn:192.0.2.10:3478?transport=tcp',
      VIEWER_TURN_URL: 'turn:192.0.2.10:3478?transport=udp',
      WEB_ORIGIN: 'https://192.0.2.10:8443',
    });

    expect(lan).toMatchObject({
      HOST: '0.0.0.0',
      WEB_ORIGIN: 'https://192.0.2.10:8443',
      DEVICE_STUN_URL: 'stun:192.0.2.10:3478',
    });
  });

  it('requires a complete contact-delivery configuration', () => {
    expect(() =>
      parseConfig({
        CONTACT_EMAIL_TO: 'owner@example.com',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
        TURN_SHARED_SECRET: 'test-shared-secret-with-at-least-32-bytes',
      }),
    ).toThrow('CONTACT_EMAIL_TO');
  });
});
