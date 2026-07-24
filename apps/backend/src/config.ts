import { z } from 'zod';

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
    SESSION_COOKIE_NAME: z.string().min(1).default('beacon_session'),
    VIEWER_STUN_URL: z.string().url().default('stun:127.0.0.1:3478'),
    VIEWER_TURN_URL: z.string().url().default('turn:127.0.0.1:3478'),
    DEVICE_STUN_URL: z.string().url().default('stun:10.0.2.2:3478'),
    DEVICE_TURN_URL: z.string().url().default('turn:10.0.2.2:3478'),
    TURN_USERNAME: z.string().min(1).default('beacon-local'),
    TURN_CREDENTIAL: z.string().min(1).default('local-development-only'),
  })
  .superRefine((config, context) => {
    if (
      config.NODE_ENV === 'production' &&
      config.TURN_CREDENTIAL === 'local-development-only'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Local TURN credentials are forbidden in production',
        path: ['TURN_CREDENTIAL'],
      });
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
