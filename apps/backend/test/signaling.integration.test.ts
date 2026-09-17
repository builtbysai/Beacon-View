import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { hashSecret } from '../src/security.js';
import {
  DEVICE_REGISTRATION_RATE_LIMITED,
  PostgresStore,
  type AccessHistoryRecord,
} from '../src/store.js';
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

/** A rejected viewer's socket closes (synchronously, inside the signaling
 * hub) slightly before the route handler's own `await store.audit(...)`
 * for that same rejection resolves, so a client-side close is not proof
 * the audit row has landed yet. Poll briefly instead of asserting right
 * after close. */
async function waitForCondition(
  check: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
    await resetTestDatabase(store!.pool);
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

    const device = connect(`role=device&cameraId=${camera.publicCameraId}`, {
      Authorization: `Bearer ${deviceCredential}`,
    });
    expect(await nextMessage(device, 'device ready')).toEqual({
      type: 'device-ready',
    });

    const viewer = connect(`role=viewer&cameraId=${camera.publicCameraId}`, {
      Cookie: `beacon_session=${sessionToken}`,
      Origin: config!.WEB_ORIGIN,
    });
    const [viewerReady, deviceReady] = await Promise.all([
      nextMessage(viewer, 'viewer ready'),
      nextMessage(device, 'viewer admission on device'),
    ]);
    expect(viewerReady).toMatchObject({ type: 'ready' });
    expect(deviceReady).toMatchObject({ type: 'viewer-ready' });
    expect(viewerReady).not.toHaveProperty('householdId');
    expect(viewerReady).toMatchObject({ iceTransportPolicy: 'all' });
    const serializedReady = JSON.stringify([viewerReady, deviceReady]);
    expect(serializedReady).not.toContain(config!.TURN_SHARED_SECRET);
    const viewerTurn = (
      viewerReady.iceServers as Array<{
        credential?: string;
        username?: string;
      }>
    ).find((server) => server.credential);
    const deviceTurn = (
      deviceReady.iceServers as Array<{
        credential?: string;
        username?: string;
      }>
    ).find((server) => server.credential);
    expect(viewerTurn?.username).toMatch(/^\d+:/);
    expect(viewerTurn?.credential).toBeTruthy();
    expect(deviceTurn?.username).toMatch(/^\d+:/);
    expect(deviceTurn?.credential).toBeTruthy();
    expect(deviceTurn?.username).not.toBe(viewerTurn?.username);
    const connectionId = viewerReady.connectionId as string;

    const forwardedOffer = nextMessage(viewer, 'offer');
    device.send(
      JSON.stringify({ connectionId, sdp: 'offer-sdp', type: 'offer' }),
    );
    expect(await forwardedOffer).toMatchObject({
      sdp: 'offer-sdp',
      type: 'offer',
    });
    const forwardedAnswer = nextMessage(device, 'answer');
    viewer.send(
      JSON.stringify({ connectionId, sdp: 'answer-sdp', type: 'answer' }),
    );
    expect(await forwardedAnswer).toMatchObject({
      sdp: 'answer-sdp',
      type: 'answer',
    });
    const forwardedIce = nextMessage(device, 'ICE');
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
    expect(await forwardedIce).toMatchObject({ type: 'ice' });

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
      `role=viewer&cameraId=${camera.publicCameraId}`,
      {
        Cookie: `beacon_session=${outsiderToken}`,
        Origin: config!.WEB_ORIGIN,
      },
    );
    expect(await nextClose(unauthorized)).toBe(4003);

    viewer.send(JSON.stringify({ connectionId, type: 'disconnect' }));
    viewer.close();
    device.close();
  });

  it('accepts a native bearer viewer without a browser origin', async () => {
    const owner = await store!.createAccount(
      'native-viewer@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const deviceCredential = 'native-viewer-device-secret';
    const code = 'NATIVEVIEW2';
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
      name: 'Native Camera',
      now: new Date(),
    });
    if (!camera || camera === DEVICE_REGISTRATION_RATE_LIMITED) {
      throw new Error('Camera setup failed');
    }
    const sessionToken = 'native-viewer-session';
    await store!.createSession({
      absoluteExpiresAt: new Date(Date.now() + 60_000),
      csrfHash: hashSecret('csrf'),
      idleExpiresAt: new Date(Date.now() + 60_000),
      tokenHash: hashSecret(sessionToken),
      userId: owner.id,
    });

    const device = connect(`role=device&cameraId=${camera.publicCameraId}`, {
      Authorization: `Bearer ${deviceCredential}`,
    });
    await nextMessage(device, 'native device ready');
    const viewer = connect(`role=viewer&cameraId=${camera.publicCameraId}`, {
      Authorization: `Bearer ${sessionToken}`,
    });
    const [viewerReady, deviceReady] = await Promise.all([
      nextMessage(viewer, 'native viewer ready'),
      nextMessage(device, 'native viewer admission'),
    ]);
    expect(viewerReady).toMatchObject({ type: 'ready' });
    expect(deviceReady).toMatchObject({ type: 'viewer-ready' });

    viewer.close();
    device.close();
  });

  it('rejects expired viewer sessions and revoked device credentials', async () => {
    const expired = connect(`role=viewer&cameraId=${randomUUID()}`, {
      Cookie: 'beacon_session=expired',
      Origin: config!.WEB_ORIGIN,
    });
    expect(await nextClose(expired)).toBe(4003);

    const revoked = connect(`role=device&cameraId=${randomUUID()}`, {
      Authorization: 'Bearer revoked',
    });
    expect(await nextClose(revoked)).toBe(4003);
  });

  it('records the same viewer_session_id across repeated attempts by one viewer, so access-history can group them without guessing', async () => {
    const owner = await store!.createAccount(
      'grouping@example.com',
      'irrelevant-test-hash',
      '127.0.0.1',
    );
    const deviceCredential = 'grouping-device-secret';
    const code = 'GROUPING234';
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
      name: 'Grouping Camera',
      now: new Date(),
    });
    if (!camera || camera === DEVICE_REGISTRATION_RATE_LIMITED) {
      throw new Error('Camera setup failed');
    }
    const sessionToken = 'grouping-viewer-session';
    await store!.createSession({
      absoluteExpiresAt: new Date(Date.now() + 60_000),
      csrfHash: hashSecret('csrf'),
      idleExpiresAt: new Date(Date.now() + 60_000),
      tokenHash: hashSecret(sessionToken),
      userId: owner.id,
    });

    // No device is connected, so both attempts are rejected as
    // camera-offline — the scenario the frontend's own automatic retry
    // loop produces when a camera briefly drops.
    const viewerSessionId = randomUUID();
    const attemptOne = connect(
      `role=viewer&cameraId=${camera.publicCameraId}&viewerSessionId=${viewerSessionId}`,
      { Cookie: `beacon_session=${sessionToken}`, Origin: config!.WEB_ORIGIN },
    );
    expect(await nextClose(attemptOne)).toBe(4003);
    const attemptTwo = connect(
      `role=viewer&cameraId=${camera.publicCameraId}&viewerSessionId=${viewerSessionId}`,
      { Cookie: `beacon_session=${sessionToken}`, Origin: config!.WEB_ORIGIN },
    );
    expect(await nextClose(attemptTwo)).toBe(4003);

    let forThisAttempt: AccessHistoryRecord[] = [];
    await waitForCondition(async () => {
      const history = (await store!.listAccessHistory(owner.householdId)).events;
      forThisAttempt = history.filter(
        (event) => event.viewerSessionId === viewerSessionId,
      );
      return forThisAttempt.length >= 2;
    }, 'both rejected attempts to be recorded');
    expect(forThisAttempt).toHaveLength(2);
    for (const event of forThisAttempt) {
      expect(event.success).toBe(false);
      expect(event.eventType).toBe('live_view_rejected');
      expect(event.metadata).toMatchObject({ reason: 'camera_offline' });
    }

    // A viewer connecting without an id (e.g. an older client) must not be
    // grouped with anyone else's attempts.
    const unlabeled = connect(`role=viewer&cameraId=${camera.publicCameraId}`, {
      Cookie: `beacon_session=${sessionToken}`,
      Origin: config!.WEB_ORIGIN,
    });
    expect(await nextClose(unlabeled)).toBe(4003);
    let unlabeledRows: AccessHistoryRecord[] = [];
    await waitForCondition(async () => {
      const refreshed = (await store!.listAccessHistory(owner.householdId)).events;
      unlabeledRows = refreshed.filter(
        (event) => event.viewerSessionId === null,
      );
      return unlabeledRows.length >= 1;
    }, 'the unlabeled attempt to be recorded');
    expect(unlabeledRows).toHaveLength(1);
  });
});
