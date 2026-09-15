import type { AppConfig } from './config.js';
import { deliverResendEmail } from './contact.js';

type ResendConfig = Pick<AppConfig, 'RESEND_API_KEY' | 'RESEND_FROM'>;

export async function deliverEmailVerificationEmail(
  config: ResendConfig & Pick<AppConfig, 'WEB_ORIGIN'>,
  input: { to: string; token: string; expiresAt: Date },
): Promise<void> {
  await deliverResendEmail(config, {
    from: config.RESEND_FROM!,
    subject: 'Verify your Beacon SecureView email address',
    text: [
      'Confirm this email address for your Beacon SecureView account.',
      '',
      `${config.WEB_ORIGIN}/account/verify-email?token=${encodeURIComponent(input.token)}`,
      '',
      `This link expires ${input.expiresAt.toISOString()}.`,
      '',
      'If you did not create a Beacon SecureView account, you can ignore this email.',
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
    subject: 'Reset your Beacon SecureView password',
    text: [
      'A password reset was requested for this Beacon SecureView account.',
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
    subject: 'Beacon SecureView password reset',
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

export async function deliverPasswordChangedAlert(
  config: ResendConfig,
  to: string,
): Promise<void> {
  await deliverResendEmail(config, {
    from: config.RESEND_FROM!,
    subject: 'Your Beacon SecureView password was changed',
    text: [
      'Your Beacon SecureView account password was just changed and every',
      'other browser session was signed out.',
      '',
      'If this was not you, your email account may be compromised — reset your',
      'password again immediately and contact support from the account you',
      'used to sign up.',
    ].join('\n'),
    to,
  });
}
