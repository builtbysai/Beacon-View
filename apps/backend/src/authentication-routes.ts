import { OAuth2Client } from 'google-auth-library';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { deliverEmailVerificationEmail } from './account-recovery-email.js';
import type { AppConfig } from './config.js';
import {
  driveProviderEmail,
  GOOGLE_DRIVE_RECORDING_SCOPE,
  GOOGLE_DRIVE_SCOPE,
  GoogleDriveRequestError,
  verifyDriveAppDataAccess,
  verifyDriveRecordingAccess,
} from './google-drive-client.js';
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
const EMAIL_VERIFICATION_TOKEN_TTL = 24 * HOUR;
const GOOGLE_STATE_COOKIE = 'beacon_google_oauth_state';
const GOOGLE_DRIVE_STATE_COOKIE = 'beacon_google_drive_state';
const GOOGLE_INTENT_COOKIE = 'beacon_google_intent';
const PENDING_GOOGLE_LINK_COOKIE = 'beacon_pending_google_link';
const driveConnectSchema = z
  .object({ purpose: z.enum(['appdata', 'recordings']).optional() })
  .strict();

function oauthProviderStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

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
  const recordSignIn = (userId: string): Promise<void> =>
    store
      .recordSecurityEvent({
        now: new Date(),
        securityEventType: 'sign_in',
        userId,
      })
      .catch((error: unknown) =>
        app.log.warn({ err: error }, 'failed to record sign-in security event'),
      );
  const mobileGoogleHandoffs = new Map<
    string,
    { email: string; expiresAt: number; householdId: string; userId: string }
  >();
  // Bridges a Google sign-in that turned out to belong to an existing
  // password account: rather than making the person repeat the whole OAuth
  // round-trip from Settings after signing in with their password, the
  // verified Google identity is held here just long enough for the
  // password login that follows to finish the link automatically.
  const pendingGoogleLinks = new Map<
    string,
    {
      avatarUrl: string | null;
      email: string;
      expiresAt: number;
      googleSubject: string;
    }
  >();
  function prunePendingGoogleLinks(now: number): void {
    for (const [key, value] of pendingGoogleLinks) {
      if (value.expiresAt <= now) pendingGoogleLinks.delete(key);
    }
  }
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
      // Best-effort: the account exists either way, and the user can always
      // request another verification email from Settings if this one never
      // lands (e.g. delivery is misconfigured or the address bounces).
      if (config.RESEND_API_KEY && config.RESEND_FROM) {
        const verificationToken = generateToken();
        const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL);
        await store
          .createEmailVerificationToken({
            expiresAt,
            tokenHash: hashSecret(verificationToken),
            userId: user.id,
          })
          .then(() =>
            deliverEmailVerificationEmail(config, {
              expiresAt,
              to: email,
              token: verificationToken,
            }),
          )
          .catch((deliveryError: unknown) =>
            app.log.warn(
              { err: deliveryError },
              'registration verification email delivery failed',
            ),
          );
      }
      return reply.code(201).send({ user: { email: user.email, id: user.id } });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        // A duplicate email here almost always means "signed up with Google
        // already" -- that account has no password to collide with, so tell
        // the caller which case this is instead of a dead-end error the
        // existing Google user has no path out of.
        const existing = await store.findUserByEmail(email);
        if (existing && !existing.passwordHash) {
          return reply
            .code(409)
            .send({ error: 'googleAccountExists', field: 'email' });
        }
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
    await recordSignIn(user.id);
    await issueSession(reply, user.id, true, request.headers['user-agent']);
    const googleLinked = await completePendingGoogleLink(request, reply, user);
    return reply.send({
      user: { email: user.email, id: user.id },
      ...(googleLinked ? { googleLinked: true } : {}),
    });
  });

  // Finishes a Google link that was verified during a failed Google
  // sign-in attempt (see the callback's linkRequired branch below), now
  // that the person has proven ownership of the password account by
  // signing in to it. Never turns a login failure into an error -- linking
  // is a bonus on top of a successful sign-in, not a precondition for one.
  async function completePendingGoogleLink(
    request: FastifyRequest,
    reply: FastifyReply,
    user: { email: string; id: string },
  ): Promise<boolean> {
    const token = request.cookies[PENDING_GOOGLE_LINK_COOKIE];
    reply.clearCookie(PENDING_GOOGLE_LINK_COOKIE, { path: '/' });
    if (!token) return false;
    const pending = pendingGoogleLinks.get(hashSecret(token));
    pendingGoogleLinks.delete(hashSecret(token));
    if (
      !pending ||
      pending.expiresAt <= Date.now() ||
      pending.email !== normalizeEmail(user.email)
    )
      return false;
    const claimedBy = await store.findUserByGoogleSubject(
      pending.googleSubject,
    );
    if (claimedBy && claimedBy.id !== user.id) return false;
    await store.linkGoogleAccount(
      user.id,
      pending.googleSubject,
      pending.avatarUrl,
    );
    await store.audit({
      eventType: 'google_account_linked',
      ipAddress: request.ip,
      metadata: { via: 'login' },
      success: true,
      userId: user.id,
    });
    return true;
  }

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
    // Remembers that this sign-in started from "I want a password" (the
    // register screen's Google button when that email turns out to already
    // have a Google account) so the callback below can land the person
    // straight on Settings > Account with Add password already open,
    // instead of just the home page.
    if (start.data.intent === 'addPassword') {
      reply.setCookie(GOOGLE_INTENT_COOKIE, start.data.intent, {
        httpOnly: true,
        maxAge: TEN_MINUTES / 1_000,
        path: '/',
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
      });
    } else {
      reply.clearCookie(GOOGLE_INTENT_COOKIE, { path: '/' });
    }
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

  app.get('/api/auth/google/link', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    if (!googleClient || !config.GOOGLE_OAUTH_REDIRECT_URI)
      return reply.code(503).send({ error: 'Google sign-in is unavailable' });
    const state = `link.${generateToken()}`;
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
        // Google account chooser must offer every account on the device,
        // even one already open elsewhere, so linking never silently
        // reuses whatever session happens to be active.
        prompt: 'select_account',
        redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
        scope: ['openid', 'email', 'profile'],
        state,
      }),
    );
  });

  app.get('/api/drive/connect', async (request, reply) => {
    const session = await auth.authenticate(request, reply);
    if (!session) return;
    if (
      !googleClient ||
      !config.GOOGLE_OAUTH_REDIRECT_URI ||
      !store.googleDriveConfigured()
    )
      return reply.code(503).send({ error: 'Google Drive is unavailable' });
    const parsed = driveConnectSchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid Google Drive request' });
    const recordings = parsed.data.purpose === 'recordings';
    const state = `${recordings ? 'drive-recordings' : 'drive'}.${generateToken()}`;
    reply.setCookie(GOOGLE_DRIVE_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: TEN_MINUTES / 1_000,
      path: '/',
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
    });
    return reply.redirect(
      googleClient.generateAuthUrl({
        access_type: 'offline',
        include_granted_scopes: true,
        prompt: 'consent select_account',
        redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
        scope: recordings
          ? [GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_RECORDING_SCOPE]
          : [GOOGLE_DRIVE_SCOPE],
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
      const driveState = request.cookies[GOOGLE_DRIVE_STATE_COOKIE];
      const addPasswordIntent =
        request.cookies[GOOGLE_INTENT_COOKIE] === 'addPassword';
      const googleClientId = config.GOOGLE_OAUTH_CLIENT_ID;
      const googleRedirectUri = config.GOOGLE_OAUTH_REDIRECT_URI;
      const android = state?.startsWith('android.') === true;
      reply.clearCookie(GOOGLE_STATE_COOKIE, { path: '/' });
      reply.clearCookie(GOOGLE_DRIVE_STATE_COOKIE, { path: '/' });
      reply.clearCookie(GOOGLE_INTENT_COOKIE, { path: '/' });
      if (
        driveState &&
        (driveState.startsWith('drive.') ||
          driveState.startsWith('drive-recordings.'))
      ) {
        const recordings = driveState.startsWith('drive-recordings.');
        const callbackError = (request.query as { error?: unknown }).error;
        const callbackState = (request.query as { state?: unknown }).state;
        if (
          callbackError === 'access_denied' &&
          typeof callbackState === 'string' &&
          secretsEqual(driveState, callbackState)
        ) {
          app.log.info('google drive connection declined');
          return reply.redirect('/settings?section=storage&drive=denied');
        }
        const session = await auth.authenticate(request, reply);
        if (
          !session ||
          !googleClient ||
          !config.GOOGLE_OAUTH_REDIRECT_URI ||
          !callback.success ||
          !secretsEqual(driveState, callback.data.state)
        ) {
          return reply.redirect('/settings?section=storage&drive=failed');
        }
        let stage:
          | 'token_exchange'
          | 'app_data_verification'
          | 'provider_identity'
          | 'recording_verification'
          | 'credential_storage'
          | 'audit' = 'token_exchange';
        try {
          const token = await googleClient.getToken({
            code: callback.data.code,
            redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
          });
          const refreshToken = token.tokens.refresh_token;
          const accessToken = token.tokens.access_token;
          if (!refreshToken || !accessToken) {
            app.log.warn(
              {
                accessTokenPresent: Boolean(accessToken),
                refreshTokenPresent: Boolean(refreshToken),
                stage: 'token_response',
              },
              'google drive connection failed',
            );
            return reply.redirect('/settings?section=storage&drive=failed');
          }
          stage = 'app_data_verification';
          await verifyDriveAppDataAccess(accessToken);
          if (recordings) {
            stage = 'recording_verification';
            await verifyDriveRecordingAccess(accessToken);
          }
          stage = 'provider_identity';
          const providerEmail = await driveProviderEmail(accessToken);
          stage = 'credential_storage';
          await store.saveGoogleDriveConnection({
            providerEmail,
            refreshToken,
            scopes:
              token.tokens.scope ??
              [
                GOOGLE_DRIVE_SCOPE,
                ...(recordings ? [GOOGLE_DRIVE_RECORDING_SCOPE] : []),
              ].join(' '),
            userId: session.userId,
          });
          stage = 'audit';
          await store.audit({
            eventType: 'google_drive_connected',
            householdId: session.householdId,
            ipAddress: request.ip,
            metadata: {
              scope: recordings ? 'appdata recordings' : 'appdata',
            },
            success: true,
            userId: session.userId,
          });
          app.log.info('google drive connection completed');
          return reply.redirect('/settings?section=storage&drive=connected');
        } catch (error) {
          app.log.warn(
            {
              errorName: error instanceof Error ? error.name : 'UnknownError',
              operation:
                error instanceof GoogleDriveRequestError
                  ? error.operation
                  : undefined,
              providerStatus:
                error instanceof GoogleDriveRequestError
                  ? error.status
                  : oauthProviderStatus(error),
              stage,
            },
            'google drive connection failed',
          );
          return reply.redirect('/settings?section=storage&drive=failed');
        }
      }
      if (state?.startsWith('link.')) {
        const callbackError = (request.query as { error?: unknown }).error;
        const callbackState = (request.query as { state?: unknown }).state;
        if (
          callbackError === 'access_denied' &&
          typeof callbackState === 'string' &&
          secretsEqual(state, callbackState)
        ) {
          return reply.redirect('/settings?section=account&googleLink=denied');
        }
        const session = await auth.authenticate(request, reply);
        if (
          !session ||
          !googleClient ||
          !googleClientId ||
          !googleRedirectUri ||
          !callback.success ||
          !secretsEqual(state, callback.data.state)
        ) {
          return reply.redirect('/settings?section=account&googleLink=failed');
        }
        try {
          const token = await googleClient.getToken({
            code: callback.data.code,
            redirect_uri: googleRedirectUri,
          });
          if (!token.tokens.id_token)
            return reply.redirect(
              '/settings?section=account&googleLink=failed',
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
          )
            return reply.redirect(
              '/settings?section=account&googleLink=failed',
            );
          // Requiring the linked Google account's own verified email to
          // match this account's email keeps the link unambiguous -- this
          // is about letting one person sign in with either credential, not
          // attaching an unrelated Google identity that could confuse which
          // address security/recovery mail goes to.
          if (normalizeEmail(payload.email) !== normalizeEmail(session.email))
            return reply.redirect(
              '/settings?section=account&googleLink=emailMismatch',
            );
          const claimedBy = await store.findUserByGoogleSubject(payload.sub);
          if (claimedBy && claimedBy.id !== session.userId)
            return reply.redirect(
              '/settings?section=account&googleLink=conflict',
            );
          await store.linkGoogleAccount(
            session.userId,
            payload.sub,
            payload.picture ?? null,
          );
          await store.audit({
            eventType: 'google_account_linked',
            householdId: session.householdId,
            ipAddress: request.ip,
            success: true,
            userId: session.userId,
          });
          return reply.redirect('/settings?section=account&googleLink=success');
        } catch {
          return reply.redirect('/settings?section=account&googleLink=failed');
        }
      }
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
            if (!android) {
              const linkToken = generateToken();
              const now = Date.now();
              prunePendingGoogleLinks(now);
              pendingGoogleLinks.set(hashSecret(linkToken), {
                avatarUrl,
                email,
                expiresAt: now + TEN_MINUTES,
                googleSubject: payload.sub,
              });
              reply.setCookie(PENDING_GOOGLE_LINK_COOKIE, linkToken, {
                httpOnly: true,
                maxAge: TEN_MINUTES / 1_000,
                path: '/',
                sameSite: 'lax',
                secure: config.NODE_ENV === 'production',
              });
            }
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
        await recordSignIn(user.id);
        await issueSession(reply, user.id, true, request.headers['user-agent']);
        return reply.redirect(
          addPasswordIntent ? '/settings?section=account&addPassword=1' : '/',
        );
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
    await recordSignIn(handoff.userId);
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
    await recordSignIn(user.id);
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
