import type { AppConfig } from './config.js';

type ResendConfig = Pick<AppConfig, 'RESEND_API_KEY' | 'RESEND_FROM'>;

interface ResendMessage {
  from: string;
  replyTo?: string | undefined;
  subject: string;
  text: string;
  to: string;
}

export interface ContactMessage {
  email: string;
  message: string;
  name?: string | undefined;
  subject: string;
}

export async function deliverContactMessage(
  config: Pick<
    AppConfig,
    'CONTACT_EMAIL_TO' | 'RESEND_API_KEY' | 'RESEND_FROM'
  >,
  message: ContactMessage,
): Promise<void> {
  if (
    !config.CONTACT_EMAIL_TO ||
    !config.RESEND_API_KEY ||
    !config.RESEND_FROM
  ) {
    throw new Error('Contact delivery is unavailable');
  }
  await deliverResendEmail(config, {
    from: config.RESEND_FROM,
    replyTo: message.email,
    subject: `[Beacon contact] ${message.subject}`,
    text: `${message.name ? `Name: ${message.name}\n` : ''}Email: ${message.email}\n\n${message.message}`,
    to: config.CONTACT_EMAIL_TO,
  });
}

export async function deliverHouseholdInvitation(
  config: Pick<AppConfig, 'RESEND_API_KEY' | 'RESEND_FROM' | 'WEB_ORIGIN'>,
  invitation: {
    expiresAt: Date;
    role: 'admin' | 'guest' | 'viewer';
    token: string;
    to: string;
  },
): Promise<void> {
  if (!config.RESEND_API_KEY || !config.RESEND_FROM)
    throw new Error('Invitation delivery is unavailable');
  await deliverResendEmail(config, {
    from: config.RESEND_FROM,
    subject: 'You have a Beacon SecureView invitation',
    text: [
      'You have been invited to share a Beacon SecureView household.',
      '',
      `Access level: ${invitation.role}`,
      `Invitation code: ${invitation.token}`,
      `Expires: ${invitation.expiresAt.toISOString()}`,
      '',
      `Open ${config.WEB_ORIGIN} and paste the code in Settings → Household sharing.`,
      '',
      'If you were not expecting this invitation, you can ignore this email.',
    ].join('\n'),
    to: invitation.to,
  });
}

async function deliverResendEmail(
  config: ResendConfig,
  message: ResendMessage,
): Promise<void> {
  if (!config.RESEND_API_KEY || !config.RESEND_FROM)
    throw new Error('Email delivery is unavailable');
  const response = await fetch('https://api.resend.com/emails', {
    body: JSON.stringify({
      from: message.from,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      subject: message.subject,
      text: message.text,
      to: [message.to],
    }),
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  if (!response.ok) throw new Error('Email delivery failed');
}
