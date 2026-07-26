import type { Pool } from 'pg';

const FORBIDDEN_DATABASE_NAMES = new Set([
  'beacon',
  'beacon_secureview',
  'postgres',
  'template0',
  'template1',
]);

export interface TestDatabaseEnvironment {
  DATABASE_URL?: string | undefined;
  NODE_ENV?: string | undefined;
  TEST_DATABASE_URL?: string | undefined;
}

export interface SafeTestDatabase {
  databaseName: string;
  host: string;
  url: string;
}

export function assertSafeTestDatabase(
  environment: TestDatabaseEnvironment = process.env,
): SafeTestDatabase {
  const value = environment.TEST_DATABASE_URL;
  if (!value) {
    throw new Error(
      'TEST_DATABASE_URL is required for destructive database tests',
    );
  }
  if (environment.NODE_ENV !== 'test') {
    throw new Error('NODE_ENV=test is required for destructive database tests');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('TEST_DATABASE_URL must use PostgreSQL');
  }

  const databaseName = decodeURIComponent(
    parsed.pathname.slice(1),
  ).toLowerCase();
  if (!databaseName || FORBIDDEN_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `TEST_DATABASE_URL targets forbidden database "${databaseName || '(empty)'}"`,
    );
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      'TEST_DATABASE_URL must name a dedicated database ending in "_test"',
    );
  }

  if (environment.DATABASE_URL) {
    const development = new URL(environment.DATABASE_URL);
    if (development.href === parsed.href) {
      throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL');
    }
  }

  return {
    databaseName,
    host: parsed.hostname,
    url: value,
  };
}

export function testDatabaseUrl(): string | undefined {
  if (!process.env.TEST_DATABASE_URL) return undefined;
  return assertSafeTestDatabase().url;
}

export async function resetTestDatabase(
  pool: Pick<Pool, 'query'>,
  environment: TestDatabaseEnvironment = process.env,
): Promise<void> {
  const target = assertSafeTestDatabase(environment);
  console.info(
    `Resetting dedicated test database host=${target.host} database=${target.databaseName}`,
  );
  await pool.query(
    'TRUNCATE audit_events, pairing_codes, device_credentials, cameras, browser_sessions, households, users CASCADE',
  );
}
