import { z } from 'zod';

const booleanFromEnvironment = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);

const notificationKey = z.string().refine((value) => {
  try {
    return Buffer.from(value, 'base64url').length === 32;
  } catch {
    return false;
  }
}, 'Must be a 32-byte base64url value');
const optionalNotificationText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
    PUBLIC_BACKEND_ORIGIN: z.string().url().default('http://127.0.0.1:3000'),
    SIGNALING_PUBLIC_URL: z
      .string()
      .url()
      .default('ws://127.0.0.1:3000/api/signaling'),
    ALLOW_INSECURE_LOCAL_DEV: booleanFromEnvironment.default(false),
    SESSION_COOKIE_NAME: z.string().min(1).default('beacon_session'),
    VIEWER_STUN_URL: z.string().url().default('stun:127.0.0.1:3478'),
    VIEWER_TURN_URL: z.string().url().default('turn:127.0.0.1:3478'),
    VIEWER_TURN_TCP_URL: z
      .string()
      .url()
      .default('turn:127.0.0.1:3478?transport=tcp'),
    DEVICE_STUN_URL: z.string().url().default('stun:10.0.2.2:3478'),
    DEVICE_TURN_URL: z.string().url().default('turn:10.0.2.2:3478'),
    DEVICE_TURN_TCP_URL: z
      .string()
      .url()
      .default('turn:10.0.2.2:3478?transport=tcp'),
    TURN_SHARED_SECRET: z.string().min(32),
    TURN_CREDENTIAL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(600)
      .default(600),
    ICE_TRANSPORT_POLICY: z.enum(['all', 'relay']).default('all'),
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY:
      optionalNotificationText(notificationKey),
    RECORDING_ENCRYPTION_KEY: optionalNotificationText(notificationKey),
    CONTACT_EMAIL_TO: z.string().email().optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_FROM: z.string().min(3).max(320).optional(),
    NOTIFICATION_ENCRYPTION_KEY: optionalNotificationText(notificationKey),
    NOTIFICATION_FINGERPRINT_KEY: optionalNotificationText(notificationKey),
    FIREBASE_PROJECT_ID: optionalNotificationText(z.string().min(1)),
    GOOGLE_APPLICATION_CREDENTIALS: optionalNotificationText(z.string().min(1)),
    WEB_PUSH_VAPID_PUBLIC_KEY: optionalNotificationText(z.string().min(20)),
    WEB_PUSH_VAPID_PRIVATE_KEY: optionalNotificationText(z.string().min(20)),
    WEB_PUSH_VAPID_SUBJECT: optionalNotificationText(z.string().url()),
    NOTIFICATION_OFFLINE_GRACE_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(900)
      .optional(),
  })
  .superRefine((config, context) => {
    const insecureTransport =
      new URL(config.PUBLIC_BACKEND_ORIGIN).protocol !== 'https:' ||
      new URL(config.WEB_ORIGIN).protocol !== 'https:' ||
      new URL(config.SIGNALING_PUBLIC_URL).protocol !== 'wss:';
    if (!config.ALLOW_INSECURE_LOCAL_DEV && insecureTransport) {
      context.addIssue({
        code: 'custom',
        message: 'HTTPS and WSS are required unless local development opts in',
        path: ['SIGNALING_PUBLIC_URL'],
      });
    }
    if (config.NODE_ENV === 'production' && config.ALLOW_INSECURE_LOCAL_DEV) {
      context.addIssue({
        code: 'custom',
        message: 'Insecure local development cannot be enabled in production',
        path: ['ALLOW_INSECURE_LOCAL_DEV'],
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.TURN_SHARED_SECRET === 'local-development-turn-shared-secret'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The local TURN shared secret is forbidden in production',
        path: ['TURN_SHARED_SECRET'],
      });
    }
    const googleFields = [
      config.GOOGLE_OAUTH_CLIENT_ID,
      config.GOOGLE_OAUTH_CLIENT_SECRET,
      config.GOOGLE_OAUTH_REDIRECT_URI,
    ];
    if (googleFields.some(Boolean) && !googleFields.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message:
          'Google OAuth client ID, secret, and redirect URI must be configured together',
        path: ['GOOGLE_OAUTH_CLIENT_ID'],
      });
    }
    if (
      config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY &&
      !googleFields.every(Boolean)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Google Drive token encryption requires the Google OAuth client configuration',
        path: ['GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY'],
      });
    }
    if (config.RECORDING_ENCRYPTION_KEY && !googleFields.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message:
          'Recording encryption requires the Google OAuth client configuration',
        path: ['RECORDING_ENCRYPTION_KEY'],
      });
    }
    const contactFields = [
      config.CONTACT_EMAIL_TO,
      config.RESEND_API_KEY,
      config.RESEND_FROM,
    ];
    if (contactFields.some(Boolean) && !contactFields.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message:
          'CONTACT_EMAIL_TO, RESEND_API_KEY, and RESEND_FROM must be configured together',
        path: ['CONTACT_EMAIL_TO'],
      });
    }
    const notificationKeyFields = [
      config.NOTIFICATION_ENCRYPTION_KEY,
      config.NOTIFICATION_FINGERPRINT_KEY,
    ];
    const providerConfigured = Boolean(
      config.FIREBASE_PROJECT_ID ||
      config.GOOGLE_APPLICATION_CREDENTIALS ||
      config.WEB_PUSH_VAPID_PUBLIC_KEY ||
      config.WEB_PUSH_VAPID_PRIVATE_KEY ||
      config.WEB_PUSH_VAPID_SUBJECT,
    );
    if (
      notificationKeyFields.some(Boolean) &&
      !notificationKeyFields.every(Boolean)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Both notification encryption and fingerprint keys are required',
        path: ['NOTIFICATION_ENCRYPTION_KEY'],
      });
    }
    if (providerConfigured && !notificationKeyFields.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message:
          'Notification provider configuration requires both notification keys',
        path: ['NOTIFICATION_ENCRYPTION_KEY'],
      });
    }
    const fcmFields = [
      config.FIREBASE_PROJECT_ID,
      config.GOOGLE_APPLICATION_CREDENTIALS,
    ];
    if (fcmFields.some(Boolean) && !fcmFields.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message:
          'Firebase project ID and application credentials path must be configured together',
        path: ['FIREBASE_PROJECT_ID'],
      });
    }
    const webPushFields = [
      config.WEB_PUSH_VAPID_PUBLIC_KEY,
      config.WEB_PUSH_VAPID_PRIVATE_KEY,
      config.WEB_PUSH_VAPID_SUBJECT,
    ];
    if (webPushFields.some(Boolean) && !webPushFields.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message:
          'Web Push public key, private key, and subject must be configured together',
        path: ['WEB_PUSH_VAPID_PUBLIC_KEY'],
      });
    }
    if (
      config.GOOGLE_OAUTH_REDIRECT_URI &&
      new URL(config.GOOGLE_OAUTH_REDIRECT_URI).origin !== config.WEB_ORIGIN
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Google OAuth redirect URI must use the web origin',
        path: ['GOOGLE_OAUTH_REDIRECT_URI'],
      });
    }
    for (const [field, value] of [
      ['VIEWER_STUN_URL', config.VIEWER_STUN_URL],
      ['DEVICE_STUN_URL', config.DEVICE_STUN_URL],
    ] as const) {
      if (new URL(value).protocol !== 'stun:') {
        context.addIssue({
          code: 'custom',
          message: 'STUN URLs must use stun:',
          path: [field],
        });
      }
    }
    for (const [field, value] of [
      ['VIEWER_TURN_URL', config.VIEWER_TURN_URL],
      ['VIEWER_TURN_TCP_URL', config.VIEWER_TURN_TCP_URL],
      ['DEVICE_TURN_URL', config.DEVICE_TURN_URL],
      ['DEVICE_TURN_TCP_URL', config.DEVICE_TURN_TCP_URL],
    ] as const) {
      if (!['turn:', 'turns:'].includes(new URL(value).protocol)) {
        context.addIssue({
          code: 'custom',
          message: 'TURN URLs must use turn: or turns:',
          path: [field],
        });
      }
    }
  });

export type AppConfig = z.infer<typeof environmentSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
