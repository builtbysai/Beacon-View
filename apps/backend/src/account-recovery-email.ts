import type { AppConfig } from './config.js';
import { deliverResendEmail } from './contact.js';

type ResendConfig = Pick<AppConfig, 'RESEND_API_KEY' | 'RESEND_FROM'>;

export async function deliverEmailVerificationEmail(
  config: ResendConfig & Pick<AppConfig, 'WEB_ORIGIN'>,
  input: { to: string; token: string; expiresAt: Date },
): Promise<void> {
  await deliverResendEmail(config, {
    from: config.RESEND_FROM!,
    subject: 'Verify your Beacon View email address',
    text: [
      'Confirm this email address for your Beacon View account.',
      '',
      `${config.WEB_ORIGIN}/account/verify-email?token=${encodeURIComponent(input.token)}`,
      '',
      `This link expires ${input.expiresAt.toISOString()}.`,
      '',
      'If you did not create a Beacon View account, you can ignore this email.',
    ].join('\n'),
    to: input.to,
  });
}

export async function deliverPasswordResetEmail(
  config: ResendConfig & Pick<AppConfig, 'WEB_ORIGIN'>,
  input: { to: string; token: string; expiresAt: Date },
): Promise<void> {
  await deliverResendEmail(config, {
    from: config.RESEND_FROM!,
    subject: 'Reset your Beacon View password',
    text: [
      'A password reset was requested for this Beacon View account.',
      '',
      `${config.WEB_ORIGIN}/account/reset-password?token=${encodeURIComponent(input.token)}`,
      '',
      `This link expires ${input.expiresAt.toISOString()} and can only be used once.`,
      '',
      'If you did not request this, you can ignore this email and your password will not change.',
    ].join('\n'),
    to: input.to,
  });
}

export async function deliverGoogleOnlyPasswordResetEmail(
  config: ResendConfig,
  to: string,
): Promise<void> {
  await deliverResendEmail(config, {
    from: config.RESEND_FROM!,
    subject: 'Beacon View password reset',
    text: [
      'A password reset was requested for this email address, but this Beacon',
      'SecureView account signs in with Google and has no password to reset.',
      '',
      'Use "Sign in with Google" instead. If you did not request this, you can',
      'ignore this email.',
    ].join('\n'),
    to,
  });
}

/** Tells an owner that Google stopped accepting their Drive connection (ADR 0116). */
export async function deliverDriveExpiredReminder(
  config: ResendConfig & Pick<AppConfig, 'WEB_ORIGIN'>,
  to: string,
): Promise<void> {
  await deliverResendEmail(config, {
    from: config.RESEND_FROM!,
    subject: 'Reconnect Google Drive so Beacon View can save your clips',
    text: [
      'Google stopped accepting the Google Drive connection Beacon View uses to save your clips.',
      'Until you reconnect it, new clips cannot be saved. Clips already saved stay in your Drive.',
      '',
      `Reconnect in Settings, Data & storage: ${config.WEB_ORIGIN}/settings?section=data`,
      '',
      'This usually happens when access is removed in your Google account, the connection has not been used for six months, or your Google password changed.',
      'We will remind you a few more times, then stop.',
    ].join('\n'),
    to,
  });
}

export async function deliverAccountDeletedAlert(
  config: ResendConfig,
  to: string,
): Promise<void> {
  await deliverResendEmail(config, {
    from: config.RESEND_FROM!,
    subject: 'Your Beacon View account was deleted',
    text: [
      'This Beacon View account and its household were just deleted.',
      '',
      'If this was not you, your email account may be compromised --',
      'secure it immediately. There is nothing further to recover here: the',
      'account, its cameras, and its data are already gone.',
    ].join('\n'),
    to,
  });
}

export async function deliverPasswordChangedAlert(
  config: ResendConfig,
  to: string,
): Promise<void> {
  await deliverResendEmail(config, {
    from: config.RESEND_FROM!,
    subject: 'Your Beacon View password was changed',
    text: [
      'Your Beacon View account password was just changed and every',
      'other browser session was signed out.',
      '',
      'If this was not you, your email account may be compromised — reset your',
      'password again immediately and contact support from the account you',
      'used to sign up.',
    ].join('\n'),
    to,
  });
}
