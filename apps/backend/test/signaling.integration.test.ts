import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { hashSecret } from '../src/security.js';
import {
  DEVICE_REGISTRATION_RATE_LIMITED,
  PostgresStore,
} from '../src/store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
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
      TURN_CREDENTIAL: 'test-only',
      VIEWER_STUN_URL: 'stun:127.0.0.1:3478',
      VIEWER_TURN_URL: 'turn:127.0.0.1:3478',
      TURN_USERNAME: 'test-only',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
    }
  : null;
const app = store && config ? buildApp(config, store) : null;
let baseUrl = '';

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Message timeout')), 2_000);
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

function connect(query: string, headers: Record<string, string>): WebSocket {
  return new WebSocket(`${baseUrl}/api/signaling?${query}`, { headers });
}

describe.skipIf(!app || !store)('authorized WebSocket signaling', () => {
  beforeAll(async () => {
    await app!.listen({ host: '127.0.0.1', port: 0 });
    const address = app!.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await store!.pool.query(
      'TRUNCATE audit_events, pairing_codes, device_credentials, cameras, browser_sessions, households, users CASCADE',
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('authorizes owner and device, routes SDP/ICE, isolates households, and cleans up', async () => {
    const owner = await store!.createAccount(
      'owner@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const deviceCredential = 'device-secret';
    const code = 'ABCDEFGH23';
    await store!.createPairingCode(
      owner.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    const camera = await store!.redeemPairingCode({
      codeHash: hashSecret(code),
      credentialHash: hashSecret(deviceCredential),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Android Camera',
      now: new Date(),
    });
    if (!camera || camera === DEVICE_REGISTRATION_RATE_LIMITED) {
      throw new Error('Camera setup failed');
    }
    const sessionToken = 'viewer-session';
    await store!.createSession({
      absoluteExpiresAt: new Date(Date.now() + 60_000),
      csrfHash: hashSecret('csrf'),
      idleExpiresAt: new Date(Date.now() + 60_000),
      tokenHash: hashSecret(sessionToken),
      userId: owner.id,
    });

    const device = connect('role=device', {
      Authorization: `Bearer ${deviceCredential}`,
    });
    expect(await nextMessage(device)).toEqual({ type: 'device-ready' });

    const viewer = connect(`role=viewer&cameraId=${camera.publicDeviceId}`, {
      Cookie: `beacon_session=${sessionToken}`,
      Origin: config!.WEB_ORIGIN,
    });
    const [viewerReady, deviceReady] = await Promise.all([
      nextMessage(viewer),
      nextMessage(device),
    ]);
    expect(viewerReady).toMatchObject({ type: 'ready' });
    expect(deviceReady).toMatchObject({ type: 'viewer-ready' });
    expect(viewerReady).not.toHaveProperty('householdId');
    const connectionId = viewerReady.connectionId as string;

    device.send(
      JSON.stringify({ connectionId, sdp: 'offer-sdp', type: 'offer' }),
    );
    expect(await nextMessage(viewer)).toMatchObject({
      sdp: 'offer-sdp',
      type: 'offer',
    });
    viewer.send(
      JSON.stringify({ connectionId, sdp: 'answer-sdp', type: 'answer' }),
    );
    expect(await nextMessage(device)).toMatchObject({
      sdp: 'answer-sdp',
      type: 'answer',
    });
    viewer.send(
      JSON.stringify({
        candidate: {
          candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
        connectionId,
        type: 'ice',
      }),
    );
    expect(await nextMessage(device)).toMatchObject({ type: 'ice' });

    const outsider = await store!.createAccount(
      'outsider@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const outsiderToken = 'outsider-session';
    await store!.createSession({
      absoluteExpiresAt: new Date(Date.now() + 60_000),
      csrfHash: hashSecret('csrf'),
      idleExpiresAt: new Date(Date.now() + 60_000),
      tokenHash: hashSecret(outsiderToken),
      userId: outsider.id,
    });
    const unauthorized = connect(
      `role=viewer&cameraId=${camera.publicDeviceId}`,
      {
        Cookie: `beacon_session=${outsiderToken}`,
        Origin: config!.WEB_ORIGIN,
      },
    );
    expect(await nextClose(unauthorized)).toBe(4003);

    const devicePeerLeft = nextMessage(device);
    viewer.close();
    expect(await devicePeerLeft).toEqual({
      code: 'viewer_disconnected',
      type: 'peer-left',
    });
    device.close();
  });

  it('rejects expired viewer sessions and revoked device credentials', async () => {
    const expired = connect(`role=viewer&cameraId=${randomUUID()}`, {
      Cookie: 'beacon_session=expired',
      Origin: config!.WEB_ORIGIN,
    });
    expect(await nextClose(expired)).toBe(4003);

    const revoked = connect('role=device', {
      Authorization: 'Bearer revoked',
    });
    expect(await nextClose(revoked)).toBe(4003);
  });
});
