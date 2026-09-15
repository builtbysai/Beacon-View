import { randomUUID } from 'node:crypto';
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

function guestCookie(headers: Record<string, unknown>): string {
  const values = headers['set-cookie'];
  const cookies = (Array.isArray(values) ? values : [values]).filter(
    (value): value is string => typeof value === 'string',
  );
  const pair = cookies.find((value) => value.startsWith('beacon_guest_link='));
  if (!pair) throw new Error('Guest link cookie missing');
  return pair.split(';')[0]!;
}

async function registerAndSignIn(
  email: string,
  remoteAddress: string,
): Promise<{ cookie: string; csrf: string; userId: string }> {
  const registration = await app!.inject({
    method: 'POST',
    payload: { email, password: 'a genuinely long password' },
    remoteAddress,
    url: '/api/auth/register',
  });
  const credentials = sessionCookies(registration.headers);
  return {
    ...credentials,
    userId: registration.json<{ user: { id: string } }>().user.id,
  };
}

async function pairCamera(
  memberCredentials: { cookie: string; csrf: string },
  deviceName: string,
): Promise<{ cameraId: string; credential: string; deviceId: string }> {
  const created = await app!.inject({
    headers: {
      cookie: memberCredentials.cookie,
      'x-csrf-token': memberCredentials.csrf,
    },
    method: 'POST',
    url: '/api/pairing-codes',
  });
  expect(created.statusCode).toBe(201);
  const code = created.json<{ code: string }>().code;
  const redeemed = await app!.inject({
    method: 'POST',
    payload: {
      installationId: randomUUID(),
      name: deviceName,
      pairingCode: code,
    },
    url: '/api/devices/register',
  });
  expect(redeemed.statusCode).toBe(201);
  const body = redeemed.json<{
    camera: { id: string };
    credential: string;
    device: { id: string };
  }>();
  return {
    cameraId: body.camera.id,
    credential: body.credential,
    deviceId: body.device.id,
  };
}

function connect(query: string, headers: Record<string, string>): WebSocket {
  return new WebSocket(`${baseUrl}/api/signaling?${query}`, { headers });
}

function nextMessage(
  socket: WebSocket,
  label = 'signaling message',
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Message timeout: ${label}`)),
      2_000,
    );
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

function nextClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Close timeout')), 2_000);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe.skipIf(!app || !store)('anonymous guest links', () => {
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

  it('creates a link, redeems it for a cookie, and lists only the granted camera with the chosen permissions', async () => {
    const owner = await registerAndSignIn('guest-link-owner@example.com', '10.1.0.1');
    const granted = await pairCamera(owner, 'Front door');
    await pairCamera(owner, 'Backyard');

    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: {
        cameraIds: [granted.cameraId],
        canListen: true,
        canFlip: false,
        canPause: false,
        canTalk: false,
        label: 'For grandma',
      },
      url: '/api/household/guest-links',
    });
    expect(created.statusCode).toBe(201);
    const { token } = created.json<{ token: string }>();

    const list = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/household/guest-links',
    });
    expect(
      list.json<{ guestLinks: { cameraIds: string[]; label: string | null }[] }>()
        .guestLinks,
    ).toEqual([
      expect.objectContaining({
        cameraIds: [granted.cameraId],
        label: 'For grandma',
      }),
    ]);

    const entered = await app!.inject({
      method: 'POST',
      payload: { token },
      url: '/api/guest/enter',
    });
    expect(entered.statusCode).toBe(200);
    const cookie = guestCookie(entered.headers);

    const cameras = await app!.inject({
      headers: { cookie },
      method: 'GET',
      url: '/api/guest/cameras',
    });
    const list2 = cameras.json<{
      cameras: {
        canFlip: boolean;
        canListen: boolean;
        canPause: boolean;
        canTalk: boolean;
        id: string;
      }[];
    }>().cameras;
    expect(list2).toEqual([
      expect.objectContaining({
        canFlip: false,
        canListen: true,
        canPause: false,
        canTalk: false,
        id: granted.cameraId,
      }),
    ]);
  });

  it('rejects an invalid or already-revoked link token', async () => {
    const owner = await registerAndSignIn('guest-link-bad-owner@example.com', '10.1.1.1');
    const camera = await pairCamera(owner, 'Garage');

    const badToken = await app!.inject({
      method: 'POST',
      payload: { token: 'x'.repeat(40) },
      url: '/api/guest/enter',
    });
    expect(badToken.statusCode).toBe(404);

    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraIds: [camera.cameraId], canListen: false },
      url: '/api/household/guest-links',
    });
    const { id, token } = created.json<{ id: string; token: string }>();

    const revoked = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'DELETE',
      url: `/api/household/guest-links/${id}`,
    });
    expect(revoked.statusCode).toBe(204);

    const enteredAfterRevoke = await app!.inject({
      method: 'POST',
      payload: { token },
      url: '/api/guest/enter',
    });
    expect(enteredAfterRevoke.statusCode).toBe(404);
  });

  it('connects a guest viewer over signaling only for a camera included in the link, and cuts it off once revoked', async () => {
    const owner = await registerAndSignIn('guest-link-ws-owner@example.com', '10.1.2.1');
    const granted = await pairCamera(owner, 'Front porch');
    const notGranted = await pairCamera(owner, 'Side gate');

    const created = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'POST',
      payload: { cameraIds: [granted.cameraId], canListen: true },
      url: '/api/household/guest-links',
    });
    const { token } = created.json<{ token: string }>();
    const entered = await app!.inject({
      method: 'POST',
      payload: { token },
      url: '/api/guest/enter',
    });
    const cookie = guestCookie(entered.headers).split('=')[1]!;

    // The camera excluded from the link's scope is rejected outright.
    const deniedCamera = connect(
      `role=viewer&cameraId=${notGranted.cameraId}`,
      { Cookie: `beacon_guest_link=${cookie}`, Origin: config!.WEB_ORIGIN },
    );
    expect(await nextClose(deniedCamera)).toBe(4003);

    const deviceSocket = connect(`role=device&cameraId=${granted.cameraId}`, {
      Authorization: `Bearer ${granted.credential}`,
    });
    await nextMessage(deviceSocket, 'device ready');

    const guestViewer = connect(`role=viewer&cameraId=${granted.cameraId}`, {
      Cookie: `beacon_guest_link=${cookie}`,
      Origin: config!.WEB_ORIGIN,
    });
    const [viewerReady] = await Promise.all([
      nextMessage(guestViewer, 'guest viewer ready'),
      nextMessage(deviceSocket, 'viewer admission on device'),
    ]);
    expect(viewerReady).toMatchObject({ type: 'ready' });

    guestViewer.close();
    deviceSocket.close();

    // Revoking the link stops any *new* connection attempt immediately.
    const list = await app!.inject({
      headers: { cookie: owner.cookie },
      method: 'GET',
      url: '/api/household/guest-links',
    });
    const { id } = list.json<{ guestLinks: { id: string }[] }>().guestLinks[0]!;
    const revoked = await app!.inject({
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      method: 'DELETE',
      url: `/api/household/guest-links/${id}`,
    });
    expect(revoked.statusCode).toBe(204);

    const afterRevoke = connect(`role=viewer&cameraId=${granted.cameraId}`, {
      Cookie: `beacon_guest_link=${cookie}`,
      Origin: config!.WEB_ORIGIN,
    });
    expect(await nextClose(afterRevoke)).toBe(4003);
  });
});
