export function testDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = new URL(value).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      'TEST_DATABASE_URL must name a dedicated database ending in "_test"',
    );
  }
  return value;
}
