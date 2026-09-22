#!/bin/sh
set -eu
umask 077

required() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "Missing required backup setting: $1" >&2
    exit 64
  fi
}

for setting in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  required "$setting"
done

command=${1:-run}

case "$command" in
  init)
    restic init
    ;;
  run)
    workdir=$(mktemp -d)
    dump="$workdir/postgres.dump"
    cleanup() { rm -rf "$workdir"; }
    trap cleanup EXIT HUP INT TERM

    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --host=postgres --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" --format=custom --file="$dump" --no-owner --no-privileges
    restic backup "$dump" --tag beacon-postgres --tag automatic
    restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune
    ;;
  check)
    restic check
    ;;
  *)
    echo "Usage: beacon-backup {init|run|check}" >&2
    exit 64
    ;;
esac
