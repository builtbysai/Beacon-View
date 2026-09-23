# ADR 0063: Verify the PostgreSQL schema after migrations

## Status

Accepted

## Context

Drizzle's PostgreSQL migrator records only the latest applied migration timestamp and
uses that high-water mark to decide what to run. Its migration ledger therefore cannot
prove that the database contains the DDL expected by every checked-in migration. The
project observed this failure mode when migration 0025 appeared in the ledger while its
`camera_sources.motion_record_enabled` column was absent.

The exact historical trigger cannot be reproduced after the manual repair: the current
database has all 27 ledger entries and the expected column. The repository also has an
independent historical snapshot-chain gap, but that affects `drizzle-kit generate`, not
the runtime migration loop, so it is not accepted as the cause of the silent apply.

## Decision

After every `db:migrate`, run `db:verify`. The verifier reads all checked-in migration
SQL and queries PostgreSQL system catalogs for each additive table, column, named
constraint, index, extension, function, and trigger. Any missing object fails the
release.

The database CI job applies the complete migration history to an empty PostgreSQL 17
instance and runs the verifier. Oracle deployment invokes the equivalent `migrate-verify`
Compose job before restarting the backend or web containers.

New migrations that create a non-additive invariant need a matching verifier check in
the same change. The verifier deliberately does not infer correctness of data updates,
column defaults, check expressions, or destructive operations; those need migration
tests specific to the change.

## Consequences

The release pipeline fails before application code runs on an incomplete additive schema.
It does not replace a future migration-tool upgrade or full restore testing, but it makes
the prior ledger-without-DDL failure observable in CI and deployment.
