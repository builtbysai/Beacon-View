#!/usr/bin/env bash
set -Eeuo pipefail

readonly state_dir=/var/lib/beacon-monitor
readonly alert_marker="$state_dir/alert-sent"
readonly app_dir=/opt/beacon/app/infrastructure/cloud
readonly daily_backup_max_age_seconds=$((30 * 60 * 60))
readonly weekly_backup_check_max_age_seconds=$((9 * 24 * 60 * 60))

mkdir -p "$state_dir"
chmod 700 "$state_dir"

send_email() {
  local subject="$1"
  local body="$2"
  curl --fail --silent --show-error --max-time 20 \
    --request POST 'https://api.resend.com/emails' \
    --header "Authorization: Bearer ${RESEND_API_KEY:?RESEND_API_KEY is required}" \
    --header 'Content-Type: application/json' \
    --data "{\"from\":\"${RESEND_FROM:?RESEND_FROM is required}\",\"to\":[\"${ALERT_EMAIL_TO:?ALERT_EMAIL_TO is required}\"],\"subject\":\"${subject}\",\"text\":\"${body}\"}" \
    >/dev/null
}

backup_job_failure() {
  local unit="$1"
  local label="$2"
  local max_age_seconds="$3"
  local result completed_at completed_epoch now

  result=$(systemctl show "$unit" --property=Result --value)
  if [[ "$result" != 'success' ]]; then
    printf '%s last finished with result %s.' "$label" "$result"
    return
  fi

  completed_at=$(systemctl show "$unit" --property=ExecMainExitTimestamp --value)
  # A newly enabled timer has not completed its first run yet. Its scheduled run is
  # still the source of truth until systemd records a completion timestamp.
  [[ -n "$completed_at" ]] || return 0

  completed_epoch=$(date --date="$completed_at" +%s) || {
    printf 'Could not read the last completion time for %s.' "$label"
    return
  }
  now=$(date +%s)
  if ((now - completed_epoch > max_age_seconds)); then
    printf '%s has not completed successfully within its expected window.' "$label"
  fi
  return 0
}

failure=''
if ! curl --fail --silent --show-error --max-time 15 https://"${BEACON_DOMAIN:?BEACON_DOMAIN is required}"/ready >/dev/null; then
  failure='The public Beacon readiness endpoint did not respond successfully.'
elif ! (cd "$app_dir" && docker compose --env-file /etc/beacon/production.env ps --status running --services | grep --quiet --fixed-strings backend); then
  failure='The Beacon backend container is not running.'
elif ! (cd "$app_dir" && docker compose --env-file /etc/beacon/production.env ps --status running --services | grep --quiet --fixed-strings postgres); then
  failure='The Beacon PostgreSQL container is not running.'
elif ! (cd "$app_dir" && docker compose --env-file /etc/beacon/production.env ps --status running --services | grep --quiet --fixed-strings coturn); then
  failure='The Beacon TURN relay container is not running.'
else
  failure=$(backup_job_failure beacon-backup.service 'The daily Beacon backup' "$daily_backup_max_age_seconds")
  if [[ -z "$failure" ]]; then
    failure=$(backup_job_failure beacon-backup-check.service 'The weekly Beacon backup integrity check' "$weekly_backup_check_max_age_seconds")
  fi
fi

if [[ -n "$failure" ]]; then
  logger --tag beacon-monitor -- "$failure"
  if [[ ! -f "$alert_marker" ]]; then
    send_email 'Beacon service needs attention' "$failure Check the Oracle VM and Beacon service status."
    date --utc --iso-8601=seconds >"$alert_marker"
  fi
  exit 1
fi

if [[ -f "$alert_marker" ]]; then
  send_email 'Beacon service recovered' 'The public readiness endpoint and required service containers are responding again.'
  rm -f "$alert_marker"
fi

logger --tag beacon-monitor -- 'Beacon public readiness and required services are healthy.'
