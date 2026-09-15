import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  deliverEmailVerificationEmail,
  deliverGoogleOnlyPasswordResetEmail,
  deliverPasswordChangedAlert,
  deliverPasswordResetEmail,
} from './account-recovery-email.js';
import type { AppConfig } from './config.js';
import type { HouseholdEventHub } from './household-events.js';
import type { RateLimiter } from './rate-limit.js';
import {
  generateToken,
  hashPassword,
  hashSecret,
  normalizeEmail,
  verifyPassword,
} from './security.js';
import type { SessionAuth } from './session-auth.js';
import type { SignalingHub } from './signaling.js';
import type { MilestoneStore } from './store.js';

const HOUR = 60 * 60 * 1_000;
const FIFTEEN_MINUTES = 15 * 60 * 1_000;
const PASSWORD_RESET_TOKEN_TTL = HOUR;
const EMAIL_VERIFICATION_TOKEN_TTL = 24 * HOUR;

const passwordResetRequestSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(320) })
  .strict();
const passwordResetConfirmSchema = z
  .object({
    password: z.string().min(12).max(128),
    token: z.string().trim().min(20).max(600),
  })
  .strict();
const emailVerificationConfirmSchema = z
  .object({ token: z.string().trim().min(20).max(600) })
  .strict();
const reauthenticationSchema = z
  .object({ password: z.string().min(12).max(128) })
  .strict();

interface AccountRecoveryRouteDependencies {
  auth: SessionAuth;
  config: AppConfig;
  householdEvents: HouseholdEventHub;
  limiter: RateLimiter;
  signaling: SignalingHub;
  store: MilestoneStore;
}

export function registerAccountRecoveryRoutes(
  app: FastifyInstance,
  dependencies: AccountRecoveryRouteDependencies,
): void {
  const { auth, config, householdEvents, limiter, signaling, store } =
    dependencies;
  const emailConfigured = Boolean(config.RESEND_API_KEY && config.RESEND_FROM);

  app.post('/api/auth/password-reset/request', async (request, reply) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid password reset request' });
    // Password reset must never hand the raw token back over HTTP the way
    // household invitations can — the caller here has proven nothing, not
    // even that they own the target email. If email delivery is not
    // configured, fail closed uniformly (before any user lookup) rather
    // than ever falling back to returning the token in the response.
    if (!emailConfigured)
      return reply.code(503).send({ error: 'Password reset is unavailable' });
    const email = normalizeEmail(parsed.data.email);
    if (
      !limiter.take(`password-reset:${request.ip}`, 5, HOUR) ||
      !limiter.take(`password-reset:${hashSecret(email)}`, 3, HOUR)
    )
      return reply.code(429).send({ error: 'Too many requests' });
    const user = await store.findUserByEmail(email);
    if (user?.passwordHash) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL);
      await store.createPasswordResetToken({
        expiresAt,
        tokenHash: hashSecret(token),
        userId: user.id,
      });
      // Never let a delivery failure (e.g. Resend rejecting the recipient)
      // turn into a 500 here -- that would leak account existence through
      // the response status, defeating the enumeration resistance this
      // route exists for. Still logged so a systemic delivery problem is
      // actually visible to operators instead of silently invisible.
      await deliverPasswordResetEmail(config, {
        expiresAt,
        to: email,
        token,
      }).catch((error: unknown) =>
        app.log.warn({ err: error }, 'password reset email delivery failed'),
      );
    } else if (user) {
      await deliverGoogleOnlyPasswordResetEmail(config, email).catch(
        (error: unknown) =>
          app.log.warn(
            { err: error },
            'google-only password reset email delivery failed',
          ),
      );
    }
    // Response and audit success both depend only on account existence, not
    // on which branch above ran, so the API never distinguishes a Google-only
    // account from an unknown email.
    await store.audit(
      user
        ? {
            eventType: 'password_reset_requested',
            householdId: user.householdId,
            ipAddress: request.ip,
            success: true,
            userId: user.id,
          }
        : {
            eventType: 'password_reset_requested',
            ipAddress: request.ip,
            success: false,
          },
    );
    return reply.code(202).send({ requested: true });
  });

  app.post('/api/auth/password-reset/confirm', async (request, reply) => {
    if (
      !limiter.take(`password-reset-confirm:${request.ip}`, 10, FIFTEEN_MINUTES)
    )
      return reply.code(429).send({ error: 'Too many requests' });
    const parsed = passwordResetConfirmSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid password reset' });
    const userId = await store.consumePasswordResetToken(
      hashSecret(parsed.data.token),
      new Date(),
    );
    if (!userId) {
      await store.audit({
        eventType: 'password_reset_failed',
        ipAddress: request.ip,
        success: false,
      });
      return reply.code(400).send({ error: 'Invalid or expired reset link' });
    }
    const user = await store.findUserById(userId);
    if (!user)
      return reply.code(400).send({ error: 'Invalid or expired reset link' });
    const passwordHash = await hashPassword(parsed.data.password);
    await store.updatePassword(userId, passwordHash);
    const revokedSessionIds = await store.revokeAllSessions(userId);
    for (const sessionId of revokedSessionIds) {
      householdEvents.closeSession(sessionId, 'Password reset');
      signaling.disconnectSession(sessionId, 'password_reset');
    }
    await store.audit({
      eventType: 'password_reset_completed',
      householdId: user.householdId,
      ipAddress: request.ip,
      success: true,
      userId,
    });
    if (emailConfigured)
      await deliverPasswordChangedAlert(config, user.email).catch(() => {});
    return reply.code(204).send();
  });

  app.post('/api/account/email/verify/request', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    const user = await store.findUserById(session.userId);
    if (!user) return reply.code(404).send({ error: 'Account not found' });
    if (user.emailVerifiedAt) return reply.code(204).send();
    if (!emailConfigured)
      return reply
        .code(503)
        .send({ error: 'Email verification is unavailable' });
    if (!limiter.take(`email-verify-request:${session.userId}`, 3, HOUR))
      return reply.code(429).send({ error: 'Too many requests' });
    const token = generateToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL);
    await store.createEmailVerificationToken({
      expiresAt,
      tokenHash: hashSecret(token),
      userId: session.userId,
    });
    try {
      await deliverEmailVerificationEmail(config, {
        expiresAt,
        to: user.email,
        token,
      });
    } catch (error) {
      // Unlike password-reset-request, this endpoint is session-authenticated
      // -- there is no account to enumerate, so the caller can be told the
      // send genuinely failed and is worth retrying, rather than a generic
      // 500 with a raw stack trace.
      app.log.warn(
        { err: error },
        'email verification email delivery failed',
      );
      return reply
        .code(503)
        .send({ error: 'The verification email could not be sent' });
    }
    await store.audit({
      eventType: 'email_verification_requested',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    return reply.code(202).send({ requested: true });
  });

  app.post('/api/account/email/verify/confirm', async (request, reply) => {
    if (
      !limiter.take(`email-verify-confirm:${request.ip}`, 10, FIFTEEN_MINUTES)
    )
      return reply.code(429).send({ error: 'Too many requests' });
    const parsed = emailVerificationConfirmSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid email verification' });
    const userId = await store.consumeEmailVerificationToken(
      hashSecret(parsed.data.token),
      new Date(),
    );
    if (!userId)
      return reply
        .code(400)
        .send({ error: 'Invalid or expired verification link' });
    await store.audit({
      eventType: 'email_verified',
      ipAddress: request.ip,
      success: true,
      userId,
    });
    await store
      .recordSecurityEvent({
        now: new Date(),
        securityEventType: 'email_verified',
        userId,
      })
      .catch((error: unknown) =>
        app.log.warn({ err: error }, 'failed to record security event'),
      );
    return reply.code(204).send();
  });

  app.post('/api/account/reauth', async (request, reply) => {
    const session = await auth.authenticateStateChange(request, reply);
    if (!session) return;
    if (!limiter.take(`reauth:${session.id}`, 5, FIFTEEN_MINUTES))
      return reply.code(429).send({ error: 'Too many requests' });
    const parsed = reauthenticationSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid reauthentication' });
    const user = await store.findUserById(session.userId);
    if (!user?.passwordHash)
      return reply
        .code(409)
        .send({ error: 'Sign in again to confirm this action' });
    const matches = await verifyPassword(
      user.passwordHash,
      parsed.data.password,
    );
    if (!matches) {
      await store.audit({
        eventType: 'reauthentication_failed',
        householdId: session.householdId,
        ipAddress: request.ip,
        success: false,
        userId: session.userId,
      });
      return reply.code(401).send({ error: 'Incorrect password' });
    }
    await store.refreshReauthentication(session.id);
    await store.audit({
      eventType: 'reauthentication_succeeded',
      householdId: session.householdId,
      ipAddress: request.ip,
      success: true,
      userId: session.userId,
    });
    return reply.code(204).send();
  });
}
