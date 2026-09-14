import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { PostgresStore } from '../src/store.js';
import { hashSecret } from '../src/security.js';
import type {
  CameraMotionSettings,
  MotionSettings,
} from '../src/motion-settings.js';
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

describe.skipIf(!app || !store)('authentication API with PostgreSQL', () => {
  beforeEach(async () => {
    await resetTestDatabase(store!.pool);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a default household and rejects a duplicate normalized email', async () => {
    const first = await app!.inject({
      method: 'POST',
      payload: {
        email: ' Owner@Example.COM ',
        password: 'correct horse battery staple',
      },
      url: '/api/auth/register',
    });
    expect(first.statusCode).toBe(201);
    expect(first.json<{ user: { email: string } }>().user.email).toBe(
      'owner@example.com',
    );

    const duplicate = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'another secure test password',
      },
      url: '/api/auth/register',
    });
    expect(duplicate.statusCode).toBe(409);
    const ownership = await store!.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM households',
    );
    expect(ownership.rows[0]!.count).toBe(1);
  });

  it('binds sessions to active memberships and switches without deleting the shared household', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'member@example.com',
        password: 'correct horse battery staple',
      },
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    const member = await store!.findUserByEmail('member@example.com');
    const host = await store!.createAccount(
      'host@example.com',
      'test-password-hash',
      '127.0.0.22',
    );
    await store!.pool.query(
      `INSERT INTO household_members (household_id, user_id, role)
       VALUES ($1, $2, 'viewer')`,
      [host.householdId, member!.id],
    );

    const households = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/account/households',
    });
    expect(households.statusCode).toBe(200);
    expect(
      households.json<{ households: { id: string; role: string }[] }>()
        .households,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: member!.householdId, role: 'owner' }),
        expect.objectContaining({ id: host.householdId, role: 'viewer' }),
      ]),
    );

    const switched = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'PUT',
      payload: { householdId: host.householdId },
      url: '/api/account/household',
    });
    expect(switched.statusCode).toBe(204);

    const current = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(current.json()).toMatchObject({
      household: { id: host.householdId, role: 'viewer' },
    });

    const deletion = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'DELETE',
      payload: { confirmation: 'DELETE' },
      url: '/api/account',
    });
    expect(deletion.statusCode).toBe(204);
    await expect(
      store!.findUserByEmail('member@example.com'),
    ).resolves.toBeNull();
    await expect(
      store!.findUserByEmail('host@example.com'),
    ).resolves.not.toBeNull();
  });

  it('invites a viewer, grants one camera, and revokes access immediately', async () => {
    const ownerRegistration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.40',
      url: '/api/auth/register',
    });
    const ownerCredentials = sessionCookies(ownerRegistration.headers);
    const owner = await store!.findUserByEmail('owner@example.com');
    const device = await store!.pool.query<{ id: string }>(
      `INSERT INTO cameras (household_id, installation_id, name, platform)
       VALUES ($1,$2,'Hallway phone','android') RETURNING id`,
      [owner!.householdId, randomUUID()],
    );
    const source = await store!.pool.query<{ cameraId: string }>(
      `INSERT INTO camera_sources (device_id, display_name, source_key, facing)
       VALUES ($1,'Rear camera','rear','rear') RETURNING public_camera_id AS "cameraId"`,
      [device.rows[0]!.id],
    );

    const memberRegistration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.41',
      url: '/api/auth/register',
    });
    const memberCredentials = sessionCookies(memberRegistration.headers);

    const invitation = await app!.inject({
      headers: {
        cookie: ownerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': ownerCredentials.csrf,
      },
      method: 'POST',
      payload: { email: 'viewer@example.com', role: 'viewer' },
      url: '/api/household/invitations',
    });
    expect(invitation.statusCode).toBe(201);
    const inviteToken = invitation.json<{ token: string }>().token;
    expect(inviteToken).toHaveLength(43);
    const storedInvitation = await store!.pool.query<{ tokenHash: string }>(
      'SELECT token_hash AS "tokenHash" FROM household_invitations',
    );
    expect(storedInvitation.rows[0]!.tokenHash).not.toBe(inviteToken);

    const accepted = await app!.inject({
      headers: {
        cookie: memberCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': memberCredentials.csrf,
      },
      method: 'POST',
      payload: { token: inviteToken },
      url: '/api/household/invitations/accept',
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      householdId: owner!.householdId,
      role: 'viewer',
    });

    const sharing = await app!.inject({
      headers: { cookie: ownerCredentials.cookie },
      method: 'GET',
      url: '/api/household/sharing',
    });
    const member = sharing
      .json<{ members: Array<{ email: string; id: string }> }>()
      .members.find((item) => item.email === 'viewer@example.com');
    expect(member).toBeDefined();

    const granted = await app!.inject({
      headers: {
        cookie: ownerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': ownerCredentials.csrf,
      },
      method: 'PUT',
      payload: {
        grants: [
          {
            cameraId: source.rows[0]!.cameraId,
            canListen: true,
            canTalk: false,
          },
        ],
      },
      url: `/api/household/members/${member!.id}/grants`,
    });
    expect(granted.statusCode).toBe(204);

    const switched = await app!.inject({
      headers: {
        cookie: memberCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': memberCredentials.csrf,
      },
      method: 'PUT',
      payload: { householdId: owner!.householdId },
      url: '/api/account/household',
    });
    expect(switched.statusCode).toBe(204);
    const cameras = await app!.inject({
      headers: { cookie: memberCredentials.cookie },
      method: 'GET',
      url: '/api/cameras',
    });
    expect(cameras.statusCode).toBe(200);
    expect(cameras.json<{ cameras: Array<{ id: string }> }>().cameras).toEqual([
      expect.objectContaining({ id: source.rows[0]!.cameraId }),
    ]);

    const revoked = await app!.inject({
      headers: {
        cookie: ownerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': ownerCredentials.csrf,
      },
      method: 'DELETE',
      url: `/api/household/members/${member!.id}`,
    });
    expect(revoked.statusCode).toBe(204);
    const afterRevocation = await app!.inject({
      headers: { cookie: memberCredentials.cookie },
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(afterRevocation.statusCode).toBe(401);
  });

  it('resends an invitation with a fresh token and revokes the original', async () => {
    const ownerRegistration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'resend-owner@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.44',
      url: '/api/auth/register',
    });
    const ownerCredentials = sessionCookies(ownerRegistration.headers);

    const invitation = await app!.inject({
      headers: {
        cookie: ownerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': ownerCredentials.csrf,
      },
      method: 'POST',
      payload: { email: 'resend-guest@example.com', role: 'viewer' },
      url: '/api/household/invitations',
    });
    expect(invitation.statusCode).toBe(201);
    const original = invitation.json<{ id: string; token: string }>();

    const resent = await app!.inject({
      headers: {
        cookie: ownerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': ownerCredentials.csrf,
      },
      method: 'POST',
      url: `/api/household/invitations/${original.id}/resend`,
    });
    expect(resent.statusCode).toBe(201);
    const resentInvitation = resent.json<{ id: string; token: string }>();
    expect(resentInvitation.id).not.toBe(original.id);
    expect(resentInvitation.token).not.toBe(original.token);

    const guestRegistration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'resend-guest@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.45',
      url: '/api/auth/register',
    });
    const guestCredentials = sessionCookies(guestRegistration.headers);

    const acceptedOriginal = await app!.inject({
      headers: {
        cookie: guestCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': guestCredentials.csrf,
      },
      method: 'POST',
      payload: { token: original.token },
      url: '/api/household/invitations/accept',
    });
    expect(acceptedOriginal.statusCode).toBe(400);

    const acceptedResent = await app!.inject({
      headers: {
        cookie: guestCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': guestCredentials.csrf,
      },
      method: 'POST',
      payload: { token: resentInvitation.token },
      url: '/api/household/invitations/accept',
    });
    expect(acceptedResent.statusCode).toBe(200);
    expect(acceptedResent.json()).toMatchObject({ role: 'viewer' });
  });

  it('blocks a viewer from every household-admin sharing action', async () => {
    const ownerRegistration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'admin-check-owner@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.46',
      url: '/api/auth/register',
    });
    const ownerCredentials = sessionCookies(ownerRegistration.headers);
    const owner = await store!.findUserByEmail('admin-check-owner@example.com');

    const invitation = await app!.inject({
      headers: {
        cookie: ownerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': ownerCredentials.csrf,
      },
      method: 'POST',
      payload: { email: 'admin-check-viewer@example.com', role: 'viewer' },
      url: '/api/household/invitations',
    });
    expect(invitation.statusCode).toBe(201);
    const { id: invitationId, token } = invitation.json<{
      id: string;
      token: string;
    }>();

    const viewerRegistration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'admin-check-viewer@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.47',
      url: '/api/auth/register',
    });
    const viewerCredentials = sessionCookies(viewerRegistration.headers);
    await app!.inject({
      headers: {
        cookie: viewerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': viewerCredentials.csrf,
      },
      method: 'POST',
      payload: { token },
      url: '/api/household/invitations/accept',
    });
    await app!.inject({
      headers: {
        cookie: viewerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': viewerCredentials.csrf,
      },
      method: 'PUT',
      payload: { householdId: owner!.householdId },
      url: '/api/account/household',
    });

    const viewerAuthHeaders = {
      cookie: viewerCredentials.cookie,
      origin: config!.WEB_ORIGIN,
      'x-csrf-token': viewerCredentials.csrf,
    };
    const forbidden = await Promise.all([
      app!.inject({
        headers: viewerAuthHeaders,
        method: 'GET',
        url: '/api/household/sharing',
      }),
      app!.inject({
        headers: viewerAuthHeaders,
        method: 'POST',
        payload: { email: 'someone-else@example.com', role: 'viewer' },
        url: '/api/household/invitations',
      }),
      app!.inject({
        headers: viewerAuthHeaders,
        method: 'POST',
        url: `/api/household/invitations/${invitationId}/resend`,
      }),
      app!.inject({
        headers: viewerAuthHeaders,
        method: 'DELETE',
        url: `/api/household/invitations/${invitationId}`,
      }),
      app!.inject({
        headers: viewerAuthHeaders,
        method: 'PUT',
        payload: { grants: [] },
        // The admin-role check runs before the memberId is ever looked up,
        // so a placeholder id is enough to prove this route is unreachable
        // for a viewer, regardless of whose access it names.
        url: `/api/household/members/${randomUUID()}/grants`,
      }),
      app!.inject({
        headers: viewerAuthHeaders,
        method: 'DELETE',
        url: `/api/household/members/${randomUUID()}`,
      }),
    ]);
    for (const response of forbidden) expect(response.statusCode).toBe(403);
  });

  it('rejects an expired guest invitation before creating membership', async () => {
    const ownerRegistration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'guest-owner@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.42',
      url: '/api/auth/register',
    });
    const ownerCredentials = sessionCookies(ownerRegistration.headers);

    const guestRegistration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'expiring-guest@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.43',
      url: '/api/auth/register',
    });
    const guestCredentials = sessionCookies(guestRegistration.headers);

    const invitation = await app!.inject({
      headers: {
        cookie: ownerCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': ownerCredentials.csrf,
      },
      method: 'POST',
      payload: {
        email: 'expiring-guest@example.com',
        expiresInHours: 1,
        role: 'guest',
      },
      url: '/api/household/invitations',
    });
    expect(invitation.statusCode).toBe(201);
    const token = invitation.json<{ token: string }>().token;
    await store!.pool.query(
      `UPDATE household_invitations
       SET expires_at = now() - interval '1 second'`,
    );

    const accepted = await app!.inject({
      headers: {
        cookie: guestCredentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': guestCredentials.csrf,
      },
      method: 'POST',
      payload: { token },
      url: '/api/household/invitations/accept',
    });
    expect(accepted.statusCode).toBe(400);
    // Every registration creates its own default household with the new
    // user as owner (unrelated to sharing), so a bare email lookup here
    // would always find a row — that's the guest's own household, not the
    // inviting owner's. Scope to the specific household the invitation was
    // for to actually verify the expired invitation granted no membership.
    await expect(
      store!.pool.query(
        `SELECT 1 FROM household_members hm
         JOIN users u ON u.id = hm.user_id
         JOIN households h ON h.id = hm.household_id
         JOIN users owner ON owner.id = h.owner_id
         WHERE u.email = 'expiring-guest@example.com'
           AND owner.email = 'guest-owner@example.com'`,
      ),
    ).resolves.toMatchObject({ rows: [] });
  });

  it('uses generic login errors and revokes a session with CSRF protection', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'correct horse battery staple',
      },
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);

    const wrongPassword = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'incorrect password value',
      },
      url: '/api/auth/login',
    });
    const unknownAccount = await app!.inject({
      method: 'POST',
      payload: {
        email: 'unknown@example.com',
        password: 'incorrect password value',
      },
      url: '/api/auth/login',
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.body).toBe(wrongPassword.body);

    const missingCsrf = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(missingCsrf.statusCode).toBe(403);

    const logout = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('records the session user-agent and returns it from account/sessions', async () => {
    const chromeAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
    const registration = await app!.inject({
      headers: { 'user-agent': chromeAgent },
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.21',
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);

    const sessions = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/account/sessions',
    });
    expect(sessions.statusCode).toBe(200);
    const body = sessions.json<{
      sessions: { current: boolean; userAgent: string | null }[];
    }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      current: true,
      userAgent: chromeAgent,
    });
  });

  it('issues revocable bearer sessions for the Android monitor', async () => {
    await app!.inject({
      method: 'POST',
      payload: {
        email: 'mobile@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.20',
      url: '/api/auth/register',
    });
    const login = await app!.inject({
      method: 'POST',
      payload: {
        email: 'mobile@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.20',
      url: '/api/mobile/auth/login',
    });
    expect(login.statusCode).toBe(200);
    const token = login.json<{ sessionToken: string }>().sessionToken;
    expect(token.length).toBeGreaterThan(32);
    expect(login.headers['set-cookie']).toBeUndefined();

    const cameras = await app!.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/api/cameras',
    });
    expect(cameras.statusCode).toBe(200);
    expect(cameras.json()).toEqual({ cameras: [] });

    const logout = await app!.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(logout.statusCode).toBe(204);
    const revoked = await app!.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/api/cameras',
    });
    expect(revoked.statusCode).toBe(401);
  });

  it('immediately rejects idle-expired sessions', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'correct horse battery staple',
      },
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    await store!.pool.query(
      "UPDATE browser_sessions SET idle_expires_at = now() - interval '1 second'",
    );
    const response = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns household-scoped access history without network details', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.42',
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    const identity = await store!.pool.query<{
      householdId: string;
      userId: string;
    }>(
      `SELECT h.id AS "householdId", u.id AS "userId"
       FROM users u JOIN households h ON h.owner_id = u.id
       WHERE u.email = 'owner@example.com'`,
    );
    await store!.audit({
      eventType: 'live_view_started',
      householdId: identity.rows[0]!.householdId,
      ipAddress: '192.0.2.44',
      success: true,
      userId: identity.rows[0]!.userId,
    });
    await store!.audit({
      eventType: 'device_deleted',
      householdId: identity.rows[0]!.householdId,
      ipAddress: '192.0.2.45',
      metadata: { deviceName: 'Old hallway phone' },
      success: true,
      userId: identity.rows[0]!.userId,
    });

    const response = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/access-history',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [
        {
          actorEmail: 'owner@example.com',
          deviceName: 'Old hallway phone',
          eventType: 'device_deleted',
          success: true,
        },
        {
          actorEmail: 'owner@example.com',
          eventType: 'live_view_started',
          success: true,
        },
      ],
    });
    expect(response.body).not.toContain('192.0.2.44');
    expect(response.body).not.toContain('192.0.2.45');

    const unauthenticated = await app!.inject({
      method: 'GET',
      url: '/api/access-history',
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it('records a removed camera source with its display names', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'camera-audit@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.17',
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    const account = await store!.findUserByEmail('camera-audit@example.com');
    if (!account) throw new Error('Expected registered account');
    const browser = await store!.registerBrowserDevice({
      householdId: account.householdId,
      installationId: randomUUID(),
      name: 'Office laptop',
      now: new Date(),
      sources: [
        { sourceKey: 'external', facing: 'external', name: 'Desk webcam' },
      ],
    });

    const removed = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'DELETE',
      url: `/api/cameras/${browser.cameras[0]!.publicCameraId}`,
    });
    expect(removed.statusCode).toBe(204);

    const history = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/access-history',
    });
    expect(history.json()).toMatchObject({
      events: [
        {
          cameraName: 'Desk webcam',
          deviceName: 'Office laptop',
          eventType: 'camera_source_deleted',
        },
      ],
    });
  });

  it('enforces Android privacy mode through the authenticated API', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'privacy@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.2',
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    const account = await store!.findUserByEmail('privacy@example.com');
    if (!account) throw new Error('Expected registered account');
    const code = 'PRIVACYAPI';
    const deviceCredential = 'privacy-api-credential';
    const installationId = randomUUID();
    await store!.createPairingCode(
      account.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret(code),
      credentialHash: hashSecret(deviceCredential),
      installationId,
      ipAddress: '127.0.0.1',
      name: 'Privacy camera',
      now: new Date(),
    });
    if (!device || typeof device === 'string') {
      throw new Error('Expected Android device registration');
    }

    const localPrivacy = await app!.inject({
      headers: { authorization: `Bearer ${deviceCredential}` },
      method: 'PUT',
      payload: { enabled: true },
      url: '/api/device/privacy',
    });
    expect(localPrivacy.statusCode).toBe(200);
    expect(localPrivacy.json()).toEqual({ privacyMode: true });

    const synchronized = await app!.inject({
      headers: { authorization: `Bearer ${deviceCredential}` },
      method: 'PUT',
      payload: {
        sources: [
          { facing: 'rear', name: 'Rear camera', sourceKey: 'android:0' },
        ],
      },
      url: '/api/device/cameras',
    });
    expect(synchronized.statusCode).toBe(200);
    expect(synchronized.json()).toMatchObject({ privacyMode: true });

    const localResume = await app!.inject({
      headers: { authorization: `Bearer ${deviceCredential}` },
      method: 'PUT',
      payload: { enabled: false },
      url: '/api/device/privacy',
    });
    expect(localResume.json()).toEqual({ privacyMode: false });

    const unauthorizedPrivacy = await app!.inject({
      headers: { authorization: 'Bearer invalid-device-credential' },
      method: 'PUT',
      payload: { enabled: true },
      url: '/api/device/privacy',
    });
    expect(unauthorizedPrivacy.statusCode).toBe(401);

    const enabled = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'PUT',
      payload: { enabled: true },
      url: `/api/devices/${device.publicDeviceId}/privacy`,
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toEqual({ privacyMode: true });

    const cameras = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/cameras',
    });
    expect(cameras.json()).toMatchObject({
      cameras: [{ online: false, privacyMode: true }],
    });

    const removed = await app!.inject({
      headers: { authorization: `Bearer ${deviceCredential}` },
      method: 'POST',
      payload: {},
      url: '/api/device/disconnect',
    });
    expect(removed.statusCode).toBe(204);
    const retainedDevices = await store!.listDevices(account.householdId);
    expect(retainedDevices).toHaveLength(1);
    expect(retainedDevices[0]?.publicDeviceId).toBe(device.publicDeviceId);
    expect(retainedDevices[0]?.revokedAt).toBeInstanceOf(Date);

    const nextCode = 'REPAIRAPI1';
    await store!.createPairingCode(
      account.householdId,
      hashSecret(nextCode),
      new Date(Date.now() + 60_000),
      device.id,
    );
    const repaired = await store!.redeemPairingCode({
      codeHash: hashSecret(nextCode),
      credentialHash: hashSecret('replacement-device-credential'),
      installationId,
      ipAddress: '127.0.0.1',
      name: 'Privacy camera',
      now: new Date(),
    });
    expect(repaired).not.toBeNull();
  });

  it('paginates and filters household motion history without losing equal-time or submillisecond events', async () => {
    type HistoryPage = { events: { id: string }[]; nextCursor: string | null };
    const registration = await app!.inject({
      remoteAddress: '127.0.0.9',
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'history@example.com',
        password: 'correct horse battery staple',
      },
    });
    const credentials = sessionCookies(registration.headers);
    const owner = (await store!.findUserByEmail('history@example.com'))!;
    const other = await store!.createAccount(
      'other@example.com',
      'unused-hash',
      '127.0.0.1',
    );
    const enroll = (householdId: string) =>
      store!.registerBrowserDevice({
        householdId,
        installationId: randomUUID(),
        name: 'History camera',
        now: new Date(),
        sources: [
          { sourceKey: 'rear', facing: 'rear', name: 'Rear' },
          { sourceKey: 'front', facing: 'front', name: 'Front' },
        ],
      });
    const owned = await enroll(owner.householdId);
    const foreign = await enroll(other.householdId);
    const camera = owned.cameras[0]!.publicCameraId;
    const quietCamera = owned.cameras[1]!.publicCameraId;
    const foreignCamera = foreign.cameras[0]!.publicCameraId;
    const insert = (cameraId: string, time: string) =>
      store!.pool.query<{ id: string }>(
        `INSERT INTO motion_events (camera_source_id, confidence, occurred_at) SELECT id, 0.42, $2::timestamptz FROM camera_sources WHERE public_camera_id = $1 RETURNING id`,
        [cameraId, time],
      );
    await store!.pool.query(
      `INSERT INTO motion_events (camera_source_id, confidence, occurred_at) SELECT cs.id, 0.42, '2026-09-05T12:00:00Z'::timestamptz + (n * interval '1 second') FROM camera_sources cs CROSS JOIN generate_series(1, 105) n WHERE cs.public_camera_id = $1`,
      [camera],
    );
    const sameTimeA = (await insert(quietCamera, '2026-09-04T00:00:00.123456Z'))
      .rows[0]!.id;
    const sameTimeB = (await insert(quietCamera, '2026-09-04T00:00:00.123456Z'))
      .rows[0]!.id;
    const older = (await insert(quietCamera, '2026-09-04T00:00:00.123455Z'))
      .rows[0]!.id;
    await insert(foreignCamera, '2026-09-06T00:00:00Z');
    const get = (query = '') =>
      app!.inject({
        method: 'GET',
        url: `/api/motion-events${query}`,
        headers: { cookie: credentials.cookie },
      });
    expect(
      (await app!.inject({ method: 'GET', url: '/api/motion-events' }))
        .statusCode,
    ).toBe(401);
    for (const query of [
      '?limit=101',
      '?cameraId=invalid',
      '?cursor=e30',
      '?since=bad',
    ])
      expect((await get(query)).statusCode).toBe(400);
    expect((await get(`?cameraId=${foreignCamera}`)).json()).toEqual({
      events: [],
      nextCursor: null,
    });
    expect(
      (
        await get(`?cameraId=${quietCamera}&since=2026-09-05T00:00:00Z`)
      ).json<HistoryPage>().events,
    ).toEqual([]);
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await get(
        `?cameraId=${quietCamera}&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(result.statusCode).toBe(200);
      const page = result.json<{
        events: { id: string }[];
        nextCursor: string | null;
      }>();
      found.push(...page.events.map((event) => event.id));
      cursor = page.nextCursor;
      expect(found.length).toBeLessThanOrEqual(3);
      expect(result.body).not.toContain('cursorTimestamp');
    } while (cursor);
    expect(found).toEqual([...[sameTimeA, sameTimeB].sort().reverse(), older]);
    const first = (await get('?limit=100')).json<HistoryPage>();
    expect(first.events).toHaveLength(100);
    const last = (
      await get(`?limit=100&cursor=${first.nextCursor}`)
    ).json<HistoryPage>();
    expect(last.events).toHaveLength(8);
    expect(last.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.events, ...last.events].map(
          (event: { id: string }) => event.id,
        ),
      ).size,
    ).toBe(108);
  });

  it('authorizes per-camera motion settings and enforces them for stale device clients', async () => {
    const signup = (email: string, remoteAddress: string) =>
      app!.inject({
        method: 'POST',
        url: '/api/auth/register',
        remoteAddress,
        payload: { email, password: 'correct horse battery staple' },
      });
    const ownerSession = sessionCookies(
      (await signup('settings@example.com', '127.0.0.10')).headers,
    );
    const foreignSession = sessionCookies(
      (await signup('foreign-settings@example.com', '127.0.0.11')).headers,
    );
    const owner = (await store!.findUserByEmail('settings@example.com'))!;
    const credential = 'motion-settings-device-test';
    await store!.createPairingCode(
      owner.householdId,
      hashSecret('SETTINGS01'),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret('SETTINGS01'),
      credentialHash: hashSecret(credential),
      installationId: randomUUID(),
      name: 'Settings phone',
      now: new Date(),
      ipAddress: '127.0.0.1',
    });
    if (!device || typeof device === 'string')
      throw new Error('Expected device');
    const sources = [
      { sourceKey: 'rear', facing: 'rear' as const, name: 'Rear' },
      { sourceKey: 'front', facing: 'front' as const, name: 'Front' },
    ];
    await store!.syncDeviceCameras(hashSecret(credential), sources, new Date());
    const listUrl = `/api/devices/${device.publicDeviceId}/motion-settings`;
    const get = (cookie: string) =>
      app!.inject({ method: 'GET', url: listUrl, headers: { cookie } });
    expect(
      (await app!.inject({ method: 'GET', url: listUrl })).statusCode,
    ).toBe(401);
    const initial = (await get(ownerSession.cookie)).json<{
      cameras: CameraMotionSettings[];
    }>().cameras;
    expect(initial).toHaveLength(2);
    expect(
      initial.every(
        (item) =>
          item.enabled &&
          item.sensitivity === 'medium' &&
          item.cooldownSeconds === 30,
      ),
    ).toBe(true);
    expect((await get(foreignSession.cookie)).json()).toEqual({ cameras: [] });
    const url = `/api/cameras/${device.publicCameraId}/motion-settings`;
    const settings: MotionSettings = {
      enabled: false,
      sensitivity: 'high',
      cooldownSeconds: 120,
      quietHours: null,
    };
    const put = (
      session: typeof ownerSession,
      payload: object = settings,
      csrf = session.csrf,
    ) =>
      app!.inject({
        method: 'PUT',
        url,
        headers: {
          cookie: session.cookie,
          origin: config!.WEB_ORIGIN,
          'x-csrf-token': csrf,
        },
        payload,
      });
    expect((await put(ownerSession, settings, 'wrong')).statusCode).toBe(403);
    expect((await put(foreignSession)).statusCode).toBe(404);
    expect(
      (await put(ownerSession, { ...settings, cooldownSeconds: 1 })).statusCode,
    ).toBe(400);
    expect((await put(ownerSession)).statusCode).toBe(200);
    const deviceRead = await app!.inject({
      method: 'GET',
      url: '/api/device/motion-settings',
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(deviceRead.statusCode).toBe(200);
    expect(
      deviceRead.json<{ cameras: CameraMotionSettings[] }>().cameras,
    ).toContainEqual({ cameraId: device.publicCameraId, ...settings });
    const report = () =>
      app!.inject({
        method: 'POST',
        url: `/api/device/cameras/${device.publicCameraId}/motion-events`,
        headers: { authorization: `Bearer ${credential}` },
        payload: { confidence: 0.42 },
      });
    expect((await report()).statusCode).toBe(204);
    expect(await store!.listMotionEvents(owner.householdId)).toHaveLength(0);
    expect(
      (await put(ownerSession, { ...settings, enabled: true })).statusCode,
    ).toBe(200);
    expect((await report()).statusCode).toBe(201);
    const first = (await store!.listMotionEvents(owner.householdId))[0]!;
    const input = {
      credentialHash: hashSecret(credential),
      publicCameraId: device.publicCameraId,
      confidence: 0.42,
    };
    await expect(
      store!.createMotionEvent({
        ...input,
        now: new Date(first.occurredAt.getTime() + 119_999),
      }),
    ).resolves.toMatchObject({ created: false });
    await expect(
      store!.createMotionEvent({
        ...input,
        now: new Date(first.occurredAt.getTime() + 120_000),
      }),
    ).resolves.toMatchObject({ created: true });
    await store!.syncDeviceCameras(hashSecret(credential), sources, new Date());
    const afterSync = (await get(ownerSession.cookie)).json<{
      cameras: CameraMotionSettings[];
    }>().cameras;
    expect(afterSync).toContainEqual({
      cameraId: device.publicCameraId,
      ...settings,
      enabled: true,
    });
    expect(
      afterSync.find((item) => item.cameraId !== device.publicCameraId)
        ?.cooldownSeconds,
    ).toBe(30);
    const quietHours = {
      start: '22:00',
      end: '07:00',
      timeZone: 'America/New_York',
    };
    expect(
      (await put(ownerSession, { ...settings, enabled: true, quietHours }))
        .statusCode,
    ).toBe(200);
    await expect(
      store!.createMotionEvent({
        credentialHash: hashSecret(credential),
        publicCameraId: device.publicCameraId,
        confidence: 0.42,
        now: new Date('2026-09-06T04:30:00Z'),
      }),
    ).resolves.toMatchObject({ created: false });
    await store!.revokeDevice(owner.householdId, device.publicDeviceId);
    expect((await put(ownerSession)).statusCode).toBe(404);
    expect(
      (
        await app!.inject({
          method: 'GET',
          url: '/api/device/motion-settings',
          headers: { authorization: `Bearer ${credential}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('stores validated device battery health without exposing it across households', async () => {
    const registration = await app!.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: '127.0.0.12',
      payload: {
        email: 'health@example.com',
        password: 'correct horse battery staple',
      },
    });
    const credentials = sessionCookies(registration.headers);
    const owner = (await store!.findUserByEmail('health@example.com'))!;
    const credential = 'health-device-credential';
    await store!.createPairingCode(
      owner.householdId,
      hashSecret('HEALTH123'),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret('HEALTH123'),
      credentialHash: hashSecret(credential),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Health phone',
      now: new Date(),
    });
    if (!device || typeof device === 'string')
      throw new Error('Expected device');
    expect(
      (
        await app!.inject({
          method: 'POST',
          url: '/api/device/heartbeat',
          headers: { authorization: `Bearer ${credential}` },
          payload: { batteryPercent: 82, batteryCharging: true },
        })
      ).statusCode,
    ).toBe(204);
    const devices = await app!.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { cookie: credentials.cookie },
    });
    expect(devices.json()).toMatchObject({
      devices: [
        {
          id: device.publicDeviceId,
          batteryPercent: 82,
          batteryCharging: true,
        },
      ],
    });
    expect(
      (
        await app!.inject({
          method: 'POST',
          url: '/api/device/heartbeat',
          headers: { authorization: `Bearer ${credential}` },
          payload: { batteryPercent: 101, batteryCharging: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app!.inject({
          method: 'POST',
          url: '/api/device/heartbeat',
          headers: { authorization: `Bearer ${credential}` },
          payload: { batteryPercent: 82 },
        })
      ).statusCode,
    ).toBe(400);
    const foreign = sessionCookies(
      (
        await app!.inject({
          method: 'POST',
          url: '/api/auth/register',
          remoteAddress: '127.0.0.13',
          payload: {
            email: 'foreign-health@example.com',
            password: 'correct horse battery staple',
          },
        })
      ).headers,
    );
    expect(
      (
        await app!.inject({
          method: 'GET',
          url: '/api/devices',
          headers: { cookie: foreign.cookie },
        })
      ).json(),
    ).toEqual({ devices: [] });
  });

  it('accepts debounced motion metadata from only its authenticated camera', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'motion@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.8',
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    const account = await store!.findUserByEmail('motion@example.com');
    if (!account) throw new Error('Expected account');
    const code = 'MOTION1234';
    const deviceCredential = 'motion-device-credential';
    await store!.createPairingCode(
      account.householdId,
      hashSecret(code),
      new Date(Date.now() + 60_000),
    );
    const device = await store!.redeemPairingCode({
      codeHash: hashSecret(code),
      credentialHash: hashSecret(deviceCredential),
      installationId: randomUUID(),
      ipAddress: '127.0.0.1',
      name: 'Hallway phone',
      now: new Date(),
    });
    if (!device || typeof device === 'string')
      throw new Error('Expected device');

    const report = () =>
      app!.inject({
        headers: { authorization: `Bearer ${deviceCredential}` },
        method: 'POST',
        payload: { confidence: 0.42 },
        url: `/api/device/cameras/${device.publicCameraId}/motion-events`,
      });
    expect((await report()).statusCode).toBe(201);
    expect((await report()).statusCode).toBe(204);

    const events = await app!.inject({
      headers: { cookie: credentials.cookie },
      method: 'GET',
      url: '/api/motion-events',
    });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toMatchObject({
      events: [
        {
          cameraId: device.publicCameraId,
          cameraName: 'Hallway phone',
          confidence: 0.42,
          deviceName: 'Hallway phone',
        },
      ],
    });
    expect(events.body).not.toContain('credential');

    const cleared = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'DELETE',
      url: '/api/motion-events',
    });
    expect(cleared.statusCode).toBe(204);
    await expect(store!.listMotionEvents(account.householdId)).resolves.toEqual(
      [],
    );
    const deletionAudit = await store!.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE household_id = $1 AND event_type = 'motion_history_cleared'`,
      [account.householdId],
    );
    expect(deletionAudit.rows[0]!.count).toBe(1);

    const noCsrf = await app!.inject({
      headers: { cookie: credentials.cookie, origin: config!.WEB_ORIGIN },
      method: 'DELETE',
      url: '/api/motion-events',
    });
    expect(noCsrf.statusCode).toBe(403);

    const invalid = await app!.inject({
      headers: { authorization: 'Bearer wrong-device' },
      method: 'POST',
      payload: { confidence: 0.5 },
      url: `/api/device/cameras/${device.publicCameraId}/motion-events`,
    });
    expect(invalid.statusCode).toBe(401);

    await store!.setPrivacyMode(
      account.householdId,
      device.publicDeviceId,
      true,
    );
    expect((await report()).statusCode).toBe(409);
    expect(await store!.listMotionEvents(account.householdId)).toEqual([]);
    const foreignSource = await app!.inject({
      headers: { authorization: `Bearer ${deviceCredential}` },
      method: 'POST',
      payload: { confidence: 0.5 },
      url: `/api/device/cameras/${randomUUID()}/motion-events`,
    });
    expect(foreignSource.statusCode).toBe(409);
    expect(
      await store!.findDeviceByCredential(hashSecret(deviceCredential)),
    ).not.toBeNull();
    await store!.revokeDevice(account.householdId, device.publicDeviceId);
    expect((await report()).statusCode).toBe(401);
  });

  it('enforces household motion metadata retention and audits changes', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'retention@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.14',
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    expect(
      (await app!.inject({ method: 'GET', url: '/api/motion-retention' }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app!.inject({
          headers: { cookie: credentials.cookie },
          method: 'GET',
          url: '/api/motion-retention',
        })
      ).json(),
    ).toEqual({ days: 30 });
    expect(
      (
        await app!.inject({
          headers: {
            cookie: credentials.cookie,
            origin: config!.WEB_ORIGIN,
          },
          method: 'PUT',
          payload: { days: 7 },
          url: '/api/motion-retention',
        })
      ).statusCode,
    ).toBe(403);
    const updated = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'PUT',
      payload: { days: 7 },
      url: '/api/motion-retention',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ days: 7 });
    const invalid = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'PUT',
      payload: { days: 14 },
      url: '/api/motion-retention',
    });
    expect(invalid.statusCode).toBe(400);
    const account = await store!.findUserByEmail('retention@example.com');
    if (!account) throw new Error('Expected account');
    const audit = await store!.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE household_id = $1 AND event_type = 'motion_retention_changed'`,
      [account.householdId],
    );
    expect(audit.rows[0]!.count).toBe(1);
  });

  it('deletes an account only after explicit confirmation and a recent sign-in', async () => {
    const registration = await app!.inject({
      method: 'POST',
      payload: {
        email: 'delete-account@example.com',
        password: 'correct horse battery staple',
      },
      remoteAddress: '127.0.0.15',
      url: '/api/auth/register',
    });
    const credentials = sessionCookies(registration.headers);
    const account = await store!.findUserByEmail('delete-account@example.com');
    if (!account) throw new Error('Expected account');
    const pairing = await store!.createPairingCode(
      account.householdId,
      hashSecret('deletion-pairing-code'),
      new Date(Date.now() + 60_000),
    );
    expect(pairing).toBeTruthy();

    const unconfirmed = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'DELETE',
      payload: {},
      url: '/api/account',
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(
      await store!.findUserByEmail('delete-account@example.com'),
    ).not.toBeNull();

    const deleted = await app!.inject({
      headers: {
        cookie: credentials.cookie,
        origin: config!.WEB_ORIGIN,
        'x-csrf-token': credentials.csrf,
      },
      method: 'DELETE',
      payload: { confirmation: 'DELETE' },
      url: '/api/account',
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      await store!.findUserByEmail('delete-account@example.com'),
    ).toBeNull();
    const remaining = await store!.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM households, browser_sessions
       WHERE households.owner_id = $1 OR browser_sessions.user_id = $1`,
      [account.id],
    );
    expect(remaining.rows[0]!.count).toBe(0);
    const audit = await store!.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE event_type = 'account_deleted' AND user_id IS NULL
         AND household_id IS NULL`,
    );
    expect(audit.rows[0]!.count).toBe(1);
  });
});
