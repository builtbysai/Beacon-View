import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { PostgresStore } from '../src/store.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

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

async function inviteAndAccept(
  ownerCredentials: { cookie: string; csrf: string },
  role: 'admin' | 'viewer' | 'guest',
  email: string,
  remoteAddress: string,
): Promise<{ cookie: string; csrf: string; userId: string }> {
  const invite = await app!.inject({
    headers: {
      cookie: ownerCredentials.cookie,
      'x-csrf-token': ownerCredentials.csrf,
    },
    method: 'POST',
    payload: {
      email,
      role,
      ...(role === 'guest' ? { expiresInHours: 24 } : {}),
    },
    url: '/api/household/invitations',
  });
  const token = invite.json<{ token: string }>().token;
  const member = await registerAndSignIn(email, remoteAddress);
  const accept = await app!.inject({
    headers: {
      cookie: member.cookie,
      'x-csrf-token': member.csrf,
    },
    method: 'POST',
    payload: { token },
    url: '/api/household/invitations/accept',
  });
  expect(accept.statusCode).toBe(200);
  const { householdId } = accept.json<{ householdId: string }>();
  // Matches the real client flow (HouseholdSharingSettings' acceptInvitation):
  // accepting alone only creates the membership, it doesn't switch this
  // session's active household to it.
  const switched = await app!.inject({
    headers: {
      cookie: member.cookie,
      'x-csrf-token': member.csrf,
    },
    method: 'PUT',
    payload: { householdId },
    url: '/api/account/household',
  });
  expect(switched.statusCode).toBe(204);
  return member;
}

async function pairCamera(
  memberCredentials: { cookie: string; csrf: string },
  deviceName: string,
): Promise<{ cameraId: string; deviceId: string }> {
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
    device: { id: string };
  }>();
  return { cameraId: body.camera.id, deviceId: body.device.id };
}

describe.skipIf(!app || !store)(
  'camera pairing and removal permissions',
  () => {
    beforeEach(async () => {
      await resetTestDatabase(store!.pool);
    });

    afterAll(async () => {
      await app?.close();
    });

    it('lets a viewer pair a camera, see it immediately, and remove only it', async () => {
      const owner = await registerAndSignIn(
        'pair-owner@example.com',
        '10.0.1.1',
      );
      const viewer = await inviteAndAccept(
        owner,
        'viewer',
        'pair-viewer@example.com',
        '10.0.1.2',
      );

      const paired = await pairCamera(viewer, 'Viewer phone');

      const cameraList = await app!.inject({
        headers: { cookie: viewer.cookie },
        method: 'GET',
        url: '/api/cameras',
      });
      const cameras = cameraList.json<{
        cameras: { canRemove: boolean; canLeave: boolean; id: string }[];
      }>().cameras;
      expect(cameras).toEqual([
        expect.objectContaining({
          canLeave: true,
          canRemove: true,
          id: paired.cameraId,
        }),
      ]);

      const otherViewer = await inviteAndAccept(
        owner,
        'viewer',
        'pair-other-viewer@example.com',
        '10.0.1.3',
      );
      const deniedRemoval = await app!.inject({
        headers: {
          cookie: otherViewer.cookie,
          'x-csrf-token': otherViewer.csrf,
        },
        method: 'DELETE',
        url: `/api/devices/${paired.deviceId}`,
      });
      expect(deniedRemoval.statusCode).toBe(403);

      const selfRemoval = await app!.inject({
        headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
        method: 'DELETE',
        url: `/api/devices/${paired.deviceId}`,
      });
      expect(selfRemoval.statusCode).toBe(204);
    });

    it('lets the owner remove any camera regardless of who paired it', async () => {
      const owner = await registerAndSignIn(
        'owner-removes@example.com',
        '10.0.2.1',
      );
      const viewer = await inviteAndAccept(
        owner,
        'viewer',
        'owner-removes-viewer@example.com',
        '10.0.2.2',
      );
      const paired = await pairCamera(viewer, "Viewer's camera");

      const removed = await app!.inject({
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
        method: 'DELETE',
        url: `/api/devices/${paired.deviceId}`,
      });
      expect(removed.statusCode).toBe(204);
    });

    it('blocks a guest from pairing a camera', async () => {
      const owner = await registerAndSignIn(
        'guest-owner@example.com',
        '10.0.3.1',
      );
      const guest = await inviteAndAccept(
        owner,
        'guest',
        'guest-pairer@example.com',
        '10.0.3.2',
      );
      const attempt = await app!.inject({
        headers: { cookie: guest.cookie, 'x-csrf-token': guest.csrf },
        method: 'POST',
        url: '/api/pairing-codes',
      });
      expect(attempt.statusCode).toBe(403);
    });

    it('lets a viewer leave a camera an admin shared with them, without unpairing it', async () => {
      const owner = await registerAndSignIn(
        'leave-owner@example.com',
        '10.0.4.1',
      );
      const paired = await pairCamera(owner, "Owner's camera");
      const viewer = await inviteAndAccept(
        owner,
        'viewer',
        'leave-viewer@example.com',
        '10.0.4.2',
      );

      const membersBefore = await app!.inject({
        headers: { cookie: owner.cookie },
        method: 'GET',
        url: '/api/household/sharing',
      });
      const memberId = membersBefore
        .json<{
          members: { id: string; userId: string }[];
        }>()
        .members.find((member) => member.userId === viewer.userId)!.id;
      await app!.inject({
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
        method: 'PUT',
        payload: {
          grants: [
            { cameraId: paired.cameraId, canListen: false, canTalk: false },
          ],
        },
        url: `/api/household/members/${memberId}/grants`,
      });

      const leave = await app!.inject({
        headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
        method: 'DELETE',
        url: `/api/account/cameras/${paired.cameraId}`,
      });
      expect(leave.statusCode).toBe(204);

      const viewerCameras = await app!.inject({
        headers: { cookie: viewer.cookie },
        method: 'GET',
        url: '/api/cameras',
      });
      expect(viewerCameras.json<{ cameras: unknown[] }>().cameras).toHaveLength(
        0,
      );

      const ownerCameras = await app!.inject({
        headers: { cookie: owner.cookie },
        method: 'GET',
        url: '/api/cameras',
      });
      expect(ownerCameras.json<{ cameras: unknown[] }>().cameras).toHaveLength(
        1,
      );
    });
  },
);
