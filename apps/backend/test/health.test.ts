import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import type { AppConfig } from '../src/config.js';

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
});
