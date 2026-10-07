import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(scriptDirectory, '..', 'drizzle');

const identifier = '(?:"([^"]+)"|([a-z_][a-z0-9_$]*))';
function identifierFrom(match) {
  return match[1] ?? match[2];
}

function addRequirement(requirements, kind, name, migration) {
  requirements.push({ kind, name, migration });
}

/**
 * Extract additive database objects from the checked-in PostgreSQL migrations.
 *
 * The migrator's journal is only an execution record. This independent contract
 * turns the additive DDL in every migration into post-apply catalog checks.
 */
export function extractSchemaRequirements(files) {
  const requirements = [];

  for (const { name: migration, sql } of files) {
    // Drizzle separates statements with "--> statement-breakpoint" comment
    // lines; left in place, they precede every statement after the first and
    // defeat the start-anchored patterns below, so only each file's first
    // object was ever checked. Drop full-line SQL comments before splitting.
    const statements = sql.replace(/^[ \t]*--.*$/gm, '').split(';');
    for (const statement of statements) {
      const createTable = new RegExp(
        `^\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}`,
        'i',
      ).exec(statement);
      if (createTable) {
        addRequirement(
          requirements,
          'table',
          identifierFrom(createTable),
          migration,
        );

        const tableConstraint = new RegExp(
          `\\bCONSTRAINT\\s+${identifier}`,
          'gi',
        );
        for (const constraint of statement.matchAll(tableConstraint)) {
          addRequirement(
            requirements,
            'constraint',
            identifierFrom(constraint),
            migration,
          );
        }
      }

      const createIndex = new RegExp(
        `^\\s*CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}`,
        'i',
      ).exec(statement);
      if (createIndex) {
        addRequirement(
          requirements,
          'index',
          identifierFrom(createIndex),
          migration,
        );
      }

      const createExtension = new RegExp(
        `^\\s*CREATE\\s+EXTENSION\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}`,
        'i',
      ).exec(statement);
      if (createExtension) {
        addRequirement(
          requirements,
          'extension',
          identifierFrom(createExtension),
          migration,
        );
      }

      const createFunction = new RegExp(
        `^\\s*CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${identifier}`,
        'i',
      ).exec(statement);
      if (createFunction) {
        addRequirement(
          requirements,
          'function',
          identifierFrom(createFunction),
          migration,
        );
      }

      const createTrigger = new RegExp(
        `^\\s*CREATE\\s+TRIGGER\\s+${identifier}`,
        'i',
      ).exec(statement);
      if (createTrigger) {
        addRequirement(
          requirements,
          'trigger',
          identifierFrom(createTrigger),
          migration,
        );
      }

      const alterTable = new RegExp(
        `^\\s*ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${identifier}`,
        'i',
      ).exec(statement);
      if (!alterTable) {
        continue;
      }

      const table = identifierFrom(alterTable);
      const addColumn = new RegExp(
        `\\bADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}`,
        'gi',
      );
      for (const column of statement.matchAll(addColumn)) {
        addRequirement(
          requirements,
          'column',
          `${table}.${identifierFrom(column)}`,
          migration,
        );
      }

      const addConstraint = new RegExp(
        `\\bADD\\s+CONSTRAINT\\s+${identifier}`,
        'gi',
      );
      for (const constraint of statement.matchAll(addConstraint)) {
        addRequirement(
          requirements,
          'constraint',
          identifierFrom(constraint),
          migration,
        );
      }
    }
  }

  return requirements;
}

async function readMigrationFiles() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(join(migrationsDirectory, name), 'utf8'),
    })),
  );
}

const queries = {
  table: `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
  column: `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
  index: `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
  constraint: `
    SELECT 1
    FROM pg_constraint AS catalog_constraint
    JOIN pg_namespace AS catalog_namespace ON catalog_namespace.oid = catalog_constraint.connamespace
    WHERE catalog_namespace.nspname = 'public' AND catalog_constraint.conname = $1`,
  extension: `SELECT 1 FROM pg_extension WHERE extname = $1`,
  function: `
    SELECT 1
    FROM pg_proc AS catalog_procedure
    JOIN pg_namespace AS catalog_namespace ON catalog_namespace.oid = catalog_procedure.pronamespace
    WHERE catalog_namespace.nspname = 'public' AND catalog_procedure.proname = $1`,
  trigger: `
    SELECT 1
    FROM pg_trigger AS catalog_trigger
    JOIN pg_class AS catalog_relation ON catalog_relation.oid = catalog_trigger.tgrelid
    JOIN pg_namespace AS catalog_namespace ON catalog_namespace.oid = catalog_relation.relnamespace
    WHERE catalog_namespace.nspname = 'public'
      AND NOT catalog_trigger.tgisinternal
      AND catalog_trigger.tgname = $1`,
};

function parametersFor(requirement) {
  return requirement.kind === 'column'
    ? requirement.name.split('.', 2)
    : [requirement.name];
}

export async function verifySchema({ client, requirements }) {
  const missing = [];
  for (const requirement of requirements) {
    const result = await client.query(
      queries[requirement.kind],
      parametersFor(requirement),
    );
    if (result.rowCount === 0) {
      missing.push(requirement);
    }
  }
  return missing;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to verify the migrated schema.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const requirements = extractSchemaRequirements(await readMigrationFiles());
    const missing = await verifySchema({ client, requirements });
    if (missing.length > 0) {
      const details = missing
        .map(
          ({ kind, name, migration }) =>
            `- ${kind} ${name} (required by ${migration})`,
        )
        .join('\n');
      throw new Error(
        `Migration schema verification failed. Missing database objects:\n${details}`,
      );
    }
    console.log(
      `Migration schema verification passed (${requirements.length} additive objects checked).`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
