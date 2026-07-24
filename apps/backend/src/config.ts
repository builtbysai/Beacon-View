import { z } from 'zod';

const environmentSchema = z.object({
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
