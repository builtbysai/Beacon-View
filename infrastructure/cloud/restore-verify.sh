#!/bin/sh
set -eu
umask 077

required() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "Missing required restore setting: $1" >&2
    exit 64
  fi
}

for setting in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RESTORE_TARGET_DATABASE; do
  required "$setting"
done

if [ "${BEACON_ALLOW_DESTRUCTIVE_RESTORE:-}" != "RESTORE_A_SEPARATE_DATABASE" ]; then
  echo "Refusing restore. Set BEACON_ALLOW_DESTRUCTIVE_RESTORE=RESTORE_A_SEPARATE_DATABASE." >&2
  exit 64
fi

if [ "${RESTORE_TARGET_DATABASE}" = "${POSTGRES_DB:-}" ]; then
  echo "Refusing to overwrite the live database. Use a separately-created verification database." >&2
  exit 64
fi

target_table_count=$(PGPASSWORD="$POSTGRES_PASSWORD" psql \
  --host=postgres --username="$POSTGRES_USER" --dbname="$RESTORE_TARGET_DATABASE" \
  --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');")
if [ "$target_table_count" -ne 0 ]; then
  echo "Refusing to restore into a non-empty verification database." >&2
  exit 64
fi

snapshot=${1:-latest}
workdir=$(mktemp -d)
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT HUP INT TERM

restic restore "$snapshot" --target "$workdir"
dump=$(find "$workdir" -type f -name postgres.dump -print -quit)
if [ -z "$dump" ]; then
  echo "The selected snapshot does not contain a PostgreSQL dump." >&2
  exit 65
fi

PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
  --host=postgres --username="$POSTGRES_USER" \
  --dbname="$RESTORE_TARGET_DATABASE" --no-owner --no-privileges "$dump"
migration_count=$(PGPASSWORD="$POSTGRES_PASSWORD" psql --host=postgres --username="$POSTGRES_USER" \
  --dbname="$RESTORE_TARGET_DATABASE" --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --command 'SELECT count(*) FROM drizzle.__drizzle_migrations')
public_table_count=$(PGPASSWORD="$POSTGRES_PASSWORD" psql --host=postgres --username="$POSTGRES_USER" \
  --dbname="$RESTORE_TARGET_DATABASE" --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 \
  --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
if [ "$migration_count" -eq 0 ] || [ "$public_table_count" -eq 0 ]; then
  echo "Restore completed without the expected migration or application schema." >&2
  exit 65
fi
# The schema being present proves little: an empty restore has it too. Compare the data that matters with the
# live database (V74). A backup is a day old, so the restored copy may hold fewer rows than the live one, but
# never none of them.
row_count() {
  PGPASSWORD="$POSTGRES_PASSWORD" psql --host=postgres --username="$POSTGRES_USER" \
    --dbname="$1" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command "SELECT count(*) FROM public.$2"
}
summary=""
for table in users households cameras recordings; do
  restored=$(row_count "$RESTORE_TARGET_DATABASE" "$table")
  live=$(row_count "$POSTGRES_DB" "$table")
  if [ "$live" -gt 0 ] && [ "$restored" -eq 0 ]; then
    echo "Restore produced no rows in $table, but the live database has $live." >&2
    exit 65
  fi
  if [ "$restored" -gt "$live" ]; then
    echo "Restored $table holds more rows ($restored) than the live database ($live); is this the right database?" >&2
    exit 65
  fi
  summary="$summary $table $restored/$live"
done
echo "Restore verification completed for $RESTORE_TARGET_DATABASE (migration rows: $migration_count; public tables: $public_table_count; rows restored/live:$summary)."
