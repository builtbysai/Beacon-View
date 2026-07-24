import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for migration commands');
}

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  out: './drizzle',
  schema: './src/db/schema.ts',
  strict: true,
});
