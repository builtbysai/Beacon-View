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
  --dbname="$RESTORE_TARGET_DATABASE" --clean --if-exists --no-owner --no-privileges "$dump"
PGPASSWORD="$POSTGRES_PASSWORD" psql --host=postgres --username="$POSTGRES_USER" \
  --dbname="$RESTORE_TARGET_DATABASE" --tuples-only --no-align \
  --command 'SELECT 1 FROM users LIMIT 1' >/dev/null
echo "Restore verification completed for $RESTORE_TARGET_DATABASE."
