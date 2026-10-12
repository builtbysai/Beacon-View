import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from './config.js';
import { generateToken, hashSecret, secretsEqual } from './security.js';
import type { MilestoneStore, SessionRecord } from './store.js';

const DAY = 24 * 60 * 60 * 1_000;
const SEVEN_DAYS = 7 * DAY;
const THIRTY_DAYS = 30 * DAY;
const CSRF_COOKIE = 'beacon_csrf';

export function unauthorized(reply: FastifyReply): FastifyReply {
  // The code lets the app tell a lapsed session from, say, a wrong password.
  return reply
    .code(401)
    .send({ code: 'session_required', error: 'Authentication required' });
}

export function createSessionAuth(config: AppConfig, store: MilestoneStore) {
  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionRecord | null> {
    // Signed-in sessions are cookies only; Authorization bearer tokens are for device credentials.
    const rawToken = request.cookies[config.SESSION_COOKIE_NAME];
    if (!rawToken) {
      unauthorized(reply);
      return null;
    }
    const session = await store.findSession(hashSecret(rawToken), new Date());
    if (!session) {
      unauthorized(reply);
      return null;
    }
    return session;
  }

  async function authenticateStateChange(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionRecord | null> {
    const session = await authenticate(request, reply);
    if (!session) return null;
    const csrfHeader = request.headers['x-csrf-token'];
    const csrfCookie = request.cookies[CSRF_COOKIE];
    const origin = request.headers.origin;
    if (
      typeof csrfHeader !== 'string' ||
      !csrfCookie ||
      !secretsEqual(csrfHeader, csrfCookie) ||
      !secretsEqual(hashSecret(csrfHeader), session.csrfHash) ||
      (origin !== undefined && origin !== config.WEB_ORIGIN)
    ) {
      reply.code(403).send({ error: 'CSRF validation failed' });
      return null;
    }
    return session;
  }

  async function authenticateHouseholdAdminStateChange(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionRecord | null> {
    const session = await authenticateStateChange(request, reply);
    if (!session) return null;
    if (session.role !== 'owner' && session.role !== 'admin') {
      reply
        .code(403)
        .send({ error: 'Household administrator access required' });
      return null;
    }
    return session;
  }

  async function authenticateHouseholdAdmin(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionRecord | null> {
    const session = await authenticate(request, reply);
    if (!session) return null;
    if (session.role !== 'owner' && session.role !== 'admin') {
      reply
        .code(403)
        .send({ error: 'Household administrator access required' });
      return null;
    }
    return session;
  }

  async function issueSession(
    reply: FastifyReply,
    userId: string,
    setCookies = true,
    userAgent?: string,
  ): Promise<string> {
    const token = generateToken();
    const csrfToken = generateToken();
    const now = Date.now();
    await store.createSession({
      absoluteExpiresAt: new Date(now + THIRTY_DAYS),
      csrfHash: hashSecret(csrfToken),
      idleExpiresAt: new Date(now + SEVEN_DAYS),
      reauthenticatedAt: new Date(now),
      tokenHash: hashSecret(token),
      userId,
      // Coarse browser/OS identification only; never an IP or fingerprint.
      userAgent: userAgent?.slice(0, 300),
    });
    if (!setCookies) return token;
    const cookieOptions = {
      path: '/',
      sameSite: 'lax' as const,
      secure: config.NODE_ENV === 'production',
    };
    reply.setCookie(config.SESSION_COOKIE_NAME, token, {
      ...cookieOptions,
      httpOnly: true,
      maxAge: THIRTY_DAYS / 1_000,
    });
    reply.setCookie(CSRF_COOKIE, csrfToken, {
      ...cookieOptions,
      httpOnly: false,
      maxAge: THIRTY_DAYS / 1_000,
    });
    return token;
  }

  function clearSessionCookies(reply: FastifyReply): void {
    reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  return {
    authenticate,
    authenticateHouseholdAdmin,
    authenticateStateChange,
    authenticateHouseholdAdminStateChange,
    clearSessionCookies,
    issueSession,
  };
}

export type SessionAuth = ReturnType<typeof createSessionAuth>;
