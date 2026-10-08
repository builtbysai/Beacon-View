#!/usr/bin/env bash
set -Eeuo pipefail

restore_script="${1:-infrastructure/cloud/restore-verify.sh}"

sh -n "$restore_script"

test_dir=$(mktemp -d)
cleanup() { rm -rf "$test_dir"; }
trap cleanup EXIT HUP INT TERM
mkdir -p "$test_dir/bin" "$test_dir/state"

cat >"$test_dir/bin/psql" <<'MOCK'
#!/bin/sh
case "$*" in
  *"table_schema NOT IN"*) printf '%s\n' "${MOCK_TARGET_TABLE_COUNT:-0}" ;;
  *"drizzle.__drizzle_migrations"*) printf '28\n' ;;
  *"table_schema = 'public'"*) printf '23\n' ;;
  *) echo "Unexpected psql call: $*" >&2; exit 1 ;;
esac
MOCK
cat >"$test_dir/bin/restic" <<'MOCK'
#!/bin/sh
touch "$MOCK_STATE/restic-called"
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--target' ]; then
    shift
    mkdir -p "$1/restore"
    : >"$1/restore/postgres.dump"
    exit 0
  fi
  shift
done
exit 1
MOCK
cat >"$test_dir/bin/pg_restore" <<'MOCK'
#!/bin/sh
touch "$MOCK_STATE/pg-restore-called"
MOCK
chmod +x "$test_dir/bin/psql" "$test_dir/bin/restic" "$test_dir/bin/pg_restore"

run_restore() {
  PATH="$test_dir/bin:$PATH" MOCK_STATE="$test_dir/state" \
    POSTGRES_DB=beacon_live POSTGRES_USER=beacon POSTGRES_PASSWORD=test-only \
    RESTIC_REPOSITORY=test RESTIC_PASSWORD=test-only \
    AWS_ACCESS_KEY_ID=test-only AWS_SECRET_ACCESS_KEY=test-only \
    BEACON_ALLOW_DESTRUCTIVE_RESTORE=RESTORE_A_SEPARATE_DATABASE \
    RESTORE_TARGET_DATABASE="$1" MOCK_TARGET_TABLE_COUNT="${2:-0}" \
    sh "$restore_script" latest
}

success_output=$(run_restore beacon_restore_verify)
grep --quiet --fixed-strings 'migration rows: 28; public tables: 23' <<<"$success_output"
test -f "$test_dir/state/restic-called"
test -f "$test_dir/state/pg-restore-called"

rm -f "$test_dir/state/restic-called" "$test_dir/state/pg-restore-called"
if run_restore beacon_restore_nonempty 1 >"$test_dir/nonempty.out" 2>&1; then
  echo 'Expected the non-empty target check to fail.' >&2
  exit 1
fi
grep --quiet --fixed-strings 'Refusing to restore into a non-empty verification database' "$test_dir/nonempty.out"
test ! -e "$test_dir/state/restic-called"

if run_restore beacon_live >"$test_dir/live.out" 2>&1; then
  echo 'Expected the live database target check to fail.' >&2
  exit 1
fi
grep --quiet --fixed-strings 'Refusing to overwrite the live database' "$test_dir/live.out"
test ! -e "$test_dir/state/restic-called"

echo 'Beacon restore verifier safety checks passed.'
