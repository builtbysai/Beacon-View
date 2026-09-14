import { OAuth2Client } from 'google-auth-library';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import {
  credentialsSchema,
  googleCallbackSchema,
  googleStartSchema,
  mobileGoogleExchangeSchema,
} from './http-schemas.js';
import type { RateLimiter } from './rate-limit.js';
import {
  generateToken,
  hashPassword,
  hashSecret,
  normalizeEmail,
  secretsEqual,
  verifyPassword,
} from './security.js';
import type { SessionAuth } from './session-auth.js';
import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;
const FIFTEEN_MINUTES = 15 * 60 * 1_000;
const TEN_MINUTES = 10 * 60 * 1_000;
const GOOGLE_STATE_COOKIE = 'beacon_google_oauth_state';

interface AuthenticationRouteDependencies {
  auth: SessionAuth;
  config: AppConfig;
  limiter: RateLimiter;
  store: MilestoneStore;
}

export function registerAuthenticationRoutes(
  app: FastifyInstance,
  dependencies: AuthenticationRouteDependencies,
): void {
  const { auth, config, limiter, store } = dependencies;
  const { issueSession } = auth;
  const dummyPasswordHash = hashPassword(generateToken());
  const mobileGoogleHandoffs = new Map<
    string,
    { email: string; expiresAt: number; householdId: string; userId: string }
  >();
  const googleClient = config.GOOGLE_OAUTH_CLIENT_ID
    ? new OAuth2Client(
        config.GOOGLE_OAUTH_CLIENT_ID,
        config.GOOGLE_OAUTH_CLIENT_SECRET,
        config.GOOGLE_OAUTH_REDIRECT_URI,
      )
    : null;

  app.post('/api/auth/register', async (request, reply) => {
    if (!limiter.take(`register:${request.ip}`, 5, HOUR)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid registration details' });
    }
    const email = normalizeEmail(parsed.data.email);
    try {
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await store.createAccount(email, passwordHash, request.ip);
      await issueSession(reply, user.id, true, request.headers['user-agent']);
      return reply.code(201).send({ user: { email: user.email, id: user.id } });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        return reply.code(409).send({ error: 'Unable to create account' });
      }
      throw error;
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    const email = parsed.success ? normalizeEmail(parsed.data.email) : '';
    if (
      !limiter.take(
        `login:${request.ip}:${hashSecret(email)}`,
        10,
        FIFTEEN_MINUTES,
      )
    ) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const user = parsed.success ? await store.findUserByEmail(email) : null;
    const passwordHash = user?.passwordHash ?? (await dummyPasswordHash);
    const password = parsed.success ? parsed.data.password : generateToken();
    const passwordMatches = await verifyPassword(passwordHash, password);
    const valid = Boolean(user && parsed.success && passwordMatches);
    await store.audit(
      valid && user
        ? {
            eventType: 'login_succeeded',
            householdId: user.householdId,
            ipAddress: request.ip,
            success: true,
            userId: user.id,
          }
        : {
            eventType: 'login_failed',
            ipAddress: request.ip,
            success: false,
          },
    );
    if (!valid || !user) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    await issueSession(reply, user.id, true, request.headers['user-agent']);
    return reply.send({ user: { email: user.email, id: user.id } });
  });

  app.get('/api/auth/google', async (request, reply) => {
    if (!googleClient || !config.GOOGLE_OAUTH_REDIRECT_URI)
      return reply.code(503).send({ error: 'Google sign-in is unavailable' });
    const start = googleStartSchema.safeParse(request.query);
    if (!start.success)
      return reply.code(400).send({ error: 'Invalid sign-in request' });
    const android = start.data.platform === 'android';
    const state = `${android ? 'android.' : 'web.'}${generateToken()}`;
    reply.setCookie(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: TEN_MINUTES / 1_000,
      path: '/',
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
    });
    return reply.redirect(
      googleClient.generateAuthUrl({
        access_type: 'online',
        prompt: 'select_account',
        redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
        scope: ['openid', 'email', 'profile'],
        state,
      }),
    );
  });

  app.get(
    '/api/auth/google/callback',
    { logLevel: 'silent' },
    async (request, reply) => {
      const callback = googleCallbackSchema.safeParse(request.query);
      const state = request.cookies[GOOGLE_STATE_COOKIE];
      const googleClientId = config.GOOGLE_OAUTH_CLIENT_ID;
      const googleRedirectUri = config.GOOGLE_OAUTH_REDIRECT_URI;
      const android = state?.startsWith('android.') === true;
      reply.clearCookie(GOOGLE_STATE_COOKIE, { path: '/' });
      if (
        !googleClient ||
        !googleClientId ||
        !googleRedirectUri ||
        !callback.success ||
        !state ||
        !secretsEqual(state, callback.data.state)
      ) {
        return reply.redirect(
          android ? '/auth/mobile#status=failed' : '/?googleSignIn=failed',
        );
      }
      try {
        const token = await googleClient.getToken({
          code: callback.data.code,
          redirect_uri: googleRedirectUri,
        });
        if (!token.tokens.id_token)
          return reply.redirect(
            android ? '/auth/mobile#status=failed' : '/?googleSignIn=failed',
          );
        const ticket = await googleClient.verifyIdToken({
          audience: googleClientId,
          idToken: token.tokens.id_token,
        });
        const payload = ticket.getPayload();
        if (
          !payload?.sub ||
          !payload.email ||
          payload.email_verified !== true
        ) {
          return reply.redirect(
            android ? '/auth/mobile#status=failed' : '/?googleSignIn=failed',
          );
        }
        const email = normalizeEmail(payload.email);
        const avatarUrl = payload.picture ?? null;
        let user = await store.findUserByGoogleSubject(payload.sub);
        if (!user) {
          if (await store.findUserByEmail(email)) {
            return reply.redirect(
              android
                ? '/auth/mobile#status=linkRequired'
                : '/?googleSignIn=linkRequired',
            );
          }
          user = await store.createGoogleAccount(
            email,
            payload.sub,
            request.ip,
            avatarUrl,
          );
        } else if (avatarUrl && avatarUrl !== user.avatarUrl) {
          await store.updateGoogleAvatar(user.id, avatarUrl);
          user = { ...user, avatarUrl };
        }
        await store.audit({
          eventType: 'google_login_succeeded',
          householdId: user.householdId,
          ipAddress: request.ip,
          success: true,
          userId: user.id,
        });
        if (android) {
          const handoffCode = generateToken();
          const now = Date.now();
          for (const [key, value] of mobileGoogleHandoffs) {
            if (value.expiresAt <= now) mobileGoogleHandoffs.delete(key);
          }
          mobileGoogleHandoffs.set(hashSecret(handoffCode), {
            email: user.email,
            expiresAt: now + TEN_MINUTES,
            householdId: user.householdId,
            userId: user.id,
          });
          return reply.redirect(
            `beaconsecureview://auth/mobile?code=${encodeURIComponent(handoffCode)}`,
          );
        }
        await issueSession(reply, user.id, true, request.headers['user-agent']);
        return reply.redirect('/');
      } catch {
        return reply.redirect(
          android ? '/auth/mobile#status=failed' : '/?googleSignIn=failed',
        );
      }
    },
  );

  app.post('/api/mobile/auth/google', async (request, reply) => {
    const parsed = mobileGoogleExchangeSchema.safeParse(request.body);
    if (
      !parsed.success ||
      !limiter.take(`mobile-google:${request.ip}`, 10, FIFTEEN_MINUTES)
    ) {
      return reply
        .code(401)
        .send({ error: 'Google sign-in could not be completed' });
    }
    const handoff = mobileGoogleHandoffs.get(hashSecret(parsed.data.code));
    mobileGoogleHandoffs.delete(hashSecret(parsed.data.code));
    if (!handoff || handoff.expiresAt <= Date.now()) {
      return reply
        .code(401)
        .send({ error: 'Google sign-in could not be completed' });
    }
    await store.audit({
      eventType: 'mobile_google_login_succeeded',
      householdId: handoff.householdId,
      ipAddress: request.ip,
      success: true,
      userId: handoff.userId,
    });
    const token = await issueSession(
      reply,
      handoff.userId,
      false,
      request.headers['user-agent'],
    );
    return reply.send({
      sessionToken: token,
      user: { email: handoff.email, id: handoff.userId },
    });
  });

  app.post('/api/mobile/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    const email = parsed.success ? normalizeEmail(parsed.data.email) : '';
    if (
      !limiter.take(
        `mobile-login:${request.ip}:${hashSecret(email)}`,
        10,
        FIFTEEN_MINUTES,
      )
    ) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const user = parsed.success ? await store.findUserByEmail(email) : null;
    const passwordHash = user?.passwordHash ?? (await dummyPasswordHash);
    const password = parsed.success ? parsed.data.password : generateToken();
    const passwordMatches = await verifyPassword(passwordHash, password);
    if (!user || !parsed.success || !passwordMatches) {
      await store.audit({
        eventType: 'mobile_login_failed',
        ipAddress: request.ip,
        success: false,
      });
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    await store.audit({
      eventType: 'mobile_login_succeeded',
      householdId: user.householdId,
      ipAddress: request.ip,
      success: true,
      userId: user.id,
    });
    const token = await issueSession(
      reply,
      user.id,
      false,
      request.headers['user-agent'],
    );
    return reply.send({
      sessionToken: token,
      user: { email: user.email, id: user.id },
    });
  });
}
