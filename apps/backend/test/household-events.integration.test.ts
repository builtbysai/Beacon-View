import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

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
let baseUrl = '';

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((value) => value.split(';')[0]!).join('; ');
}

async function signIn(
  path: 'register' | 'login',
  email: string,
): Promise<string> {
  const response = await fetch(
    `${baseUrl.replace('ws', 'http')}/api/auth/${path}`,
    {
      body: JSON.stringify({ email, password: 'correct horse battery staple' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  );
  const setCookie = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [];
  return cookieHeader(setCookie);
}

function nextClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Close timeout')), 3_000);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Message timeout')), 3_000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
              'utf8',
            );
      resolve(JSON.parse(text) as Record<string, unknown>);
    });
  });
}

function connectEvents(cookie: string): WebSocket {
  return new WebSocket(`${baseUrl}/api/events`, {
    headers: { cookie, origin: config!.WEB_ORIGIN },
  });
}

describe.skipIf(!app || !store)(
  'realtime household events over WebSocket',
  () => {
    beforeAll(async () => {
      await app!.listen({ host: '127.0.0.1', port: 0 });
      const address = app!.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address');
      }
      baseUrl = `ws://127.0.0.1:${address.port}`;
    });

    beforeEach(async () => {
      await resetTestDatabase(store!.pool);
    });

    afterAll(async () => {
      await app?.close();
    });

    it('closes exactly the revoked session’s realtime connection, leaving a second signed-in browser connected', async () => {
      const primaryCookie = await signIn('register', 'multi@example.com');
      const secondaryCookie = await signIn('login', 'multi@example.com');

      const primarySocket = connectEvents(primaryCookie);
      const secondarySocket = connectEvents(secondaryCookie);
      await Promise.all([
        nextMessage(primarySocket),
        nextMessage(secondarySocket),
      ]);

      const sessionsResponse = await fetch(
        `${baseUrl.replace('ws', 'http')}/api/account/sessions`,
        { headers: { cookie: secondaryCookie } },
      );
      const { sessions } = (await sessionsResponse.json()) as {
        sessions: { current: boolean; id: string }[];
      };
      const primarySessionId = sessions.find((session) => !session.current)!.id;
      const csrf = secondaryCookie
        .split('; ')
        .find((part) => part.startsWith('beacon_csrf='))!
        .split('=')[1]!;

      const revokeClosed = nextClose(primarySocket);
      const revokeResponse = await fetch(
        `${baseUrl.replace('ws', 'http')}/api/account/sessions/${primarySessionId}`,
        {
          headers: {
            cookie: secondaryCookie,
            origin: config!.WEB_ORIGIN,
            'x-csrf-token': csrf,
          },
          method: 'DELETE',
        },
      );
      expect(revokeResponse.status).toBe(204);

      const closeCode = await revokeClosed;
      expect(closeCode).toBe(4001);
      expect(secondarySocket.readyState).toBe(WebSocket.OPEN);

      secondarySocket.close();
    });
  },
);
