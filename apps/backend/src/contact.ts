import type { AppConfig } from './config.js';

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
  const response = await fetch('https://api.resend.com/emails', {
    body: JSON.stringify({
      from: config.RESEND_FROM,
      reply_to: message.email,
      subject: `[Beacon contact] ${message.subject}`,
      text: `${message.name ? `Name: ${message.name}\n` : ''}Email: ${message.email}\n\n${message.message}`,
      to: [config.CONTACT_EMAIL_TO],
    }),
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  if (!response.ok) throw new Error('Contact delivery failed');
}
