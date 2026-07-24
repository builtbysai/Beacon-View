import { z } from 'zod';

const booleanFromEnvironment = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
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
    const fields = result.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ');
    throw new Error(`Invalid environment configuration for: ${fields}`);
  }

  return result.data;
}
