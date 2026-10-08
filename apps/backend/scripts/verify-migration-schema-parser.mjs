import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSchemaRequirements } from './verify-migration-schema.mjs';

test('extracts all additive PostgreSQL objects from a migration', () => {
  const requirements = extractSchemaRequirements([
    {
      name: '0001_example.sql',
      sql: `
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";
        CREATE TABLE IF NOT EXISTS "example_records" ("id" uuid PRIMARY KEY);
        ALTER TABLE "example_records"
          ADD COLUMN IF NOT EXISTS "status" text,
          ADD CONSTRAINT "example_records_status_valid" CHECK ("status" IS NOT NULL);
        CREATE UNIQUE INDEX "example_records_status_unique" ON "example_records" ("status");
        CREATE OR REPLACE FUNCTION example_guard() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RETURN NEW; END;
        $$;
        CREATE TRIGGER example_records_guard BEFORE INSERT ON "example_records"
          FOR EACH ROW EXECUTE FUNCTION example_guard();
      `,
    },
  ]);

  assert.deepEqual(requirements, [
    { kind: 'extension', name: 'pgcrypto', migration: '0001_example.sql' },
    { kind: 'table', name: 'example_records', migration: '0001_example.sql' },
    {
      kind: 'column',
      name: 'example_records.status',
      migration: '0001_example.sql',
    },
    {
      kind: 'constraint',
      name: 'example_records_status_valid',
      migration: '0001_example.sql',
    },
    {
      kind: 'index',
      name: 'example_records_status_unique',
      migration: '0001_example.sql',
    },
    { kind: 'function', name: 'example_guard', migration: '0001_example.sql' },
    {
      kind: 'trigger',
      name: 'example_records_guard',
      migration: '0001_example.sql',
    },
  ]);
});

test('checks every statement in a drizzle migration, not only the first', () => {
  const requirements = extractSchemaRequirements([
    {
      name: '0002_breakpoints.sql',
      sql: [
        '-- A leading comment line.',
        'ALTER TABLE "example_records" ADD COLUMN "first" text;',
        '--> statement-breakpoint',
        'ALTER TABLE "example_records" ADD COLUMN "second" text;',
        '--> statement-breakpoint',
        'ALTER TABLE "example_records" ADD CONSTRAINT "example_records_second_valid" CHECK ("second" <> \'\');',
        '--> statement-breakpoint',
        'CREATE INDEX "example_records_second_idx" ON "example_records" ("second");',
      ].join('\n'),
    },
  ]);

  assert.deepEqual(
    requirements.map(({ kind, name }) => `${kind}:${name}`),
    [
      'column:example_records.first',
      'column:example_records.second',
      'constraint:example_records_second_valid',
      'index:example_records_second_idx',
    ],
  );
});
