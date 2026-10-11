#!/usr/bin/env bash
set -Eeuo pipefail

readonly state_dir=/var/lib/beacon-monitor
readonly alert_marker="$state_dir/alert-sent"
# The units run this script from the release the timers were installed from;
# point /opt/beacon/app at the current release so nothing runs older code.
readonly app_dir=/opt/beacon/app/infrastructure/cloud
readonly daily_backup_max_age_seconds=$((30 * 60 * 60))
readonly weekly_backup_check_max_age_seconds=$((9 * 24 * 60 * 60))
# A standing problem is reported again after this many minutes (V68).
readonly alert_repeat_minutes=$((24 * 60))

mkdir -p "$state_dir"
chmod 700 "$state_dir"

# Escapes text for a JSON string, so a quote or backslash in RESEND_FROM or in
# a message cannot break the request body.
json_escape() {
  local text="$1"
  text=${text//\\/\\\\}
  text=${text//\"/\\\"}
  text=${text//$'\n'/\\n}
  text=${text//$'\r'/}
  text=${text//$'\t'/\\t}
  printf '%s' "$text"
}

send_email() {
  local subject="$1"
  local body="$2"
  local from to
  from=$(json_escape "${RESEND_FROM:?RESEND_FROM is required}")
  to=$(json_escape "${ALERT_EMAIL_TO:?ALERT_EMAIL_TO is required}")
  subject=$(json_escape "$subject")
  body=$(json_escape "$body")
  curl --fail --silent --show-error --max-time 20 \
    --request POST 'https://api.resend.com/emails' \
    --header "Authorization: Bearer ${RESEND_API_KEY:?RESEND_API_KEY is required}" \
    --header 'Content-Type: application/json' \
    --data "{\"from\":\"${from}\",\"to\":[\"${to}\"],\"subject\":\"${subject}\",\"text\":\"${body}\"}" \
    >/dev/null
}

backup_job_failure() {
  local unit="$1"
  local label="$2"
  local max_age_seconds="$3"
  local timer="${unit%.service}.timer"
  local result completed_at completed_epoch now enabled_state active_since active_epoch

  # A timer that is not enabled never runs the backup, so "no failure recorded"
  # must not read as healthy.
  enabled_state=$(systemctl is-enabled "$timer" 2>/dev/null || true)
  if [[ "$enabled_state" != 'enabled' ]]; then
    printf '%s is not scheduled (%s is %s).' "$label" "$timer" "${enabled_state:-unknown}"
    return
  fi

  result=$(systemctl show "$unit" --property=Result --value)
  if [[ "$result" != 'success' ]]; then
    printf '%s last finished with result %s.' "$label" "$result"
    return
  fi

  now=$(date +%s)
  completed_at=$(systemctl show "$unit" --property=ExecMainExitTimestamp --value)
  if [[ -z "$completed_at" ]]; then
    # Enabled but never completed: give a newly enabled timer one full window to
    # make its first run, then report it.
    active_since=$(systemctl show "$timer" --property=ActiveEnterTimestamp --value)
    if [[ -n "$active_since" ]] && active_epoch=$(date --date="$active_since" +%s); then
      if ((now - active_epoch > max_age_seconds)); then
        printf '%s has never completed since its timer was enabled.' "$label"
      fi
    fi
    return 0
  fi

  completed_epoch=$(date --date="$completed_at" +%s) || {
    printf 'Could not read the last completion time for %s.' "$label"
    return
  }
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
elif ! (cd "$app_dir" && docker compose --env-file /etc/beacon/production.env ps --status running --services | grep --quiet --fixed-strings web); then
  failure='The Beacon web container is not running.'
else
  failure=$(backup_job_failure beacon-backup.service 'The daily Beacon backup' "$daily_backup_max_age_seconds")
  if [[ -z "$failure" ]]; then
    failure=$(backup_job_failure beacon-backup-check.service 'The weekly Beacon backup integrity check' "$weekly_backup_check_max_age_seconds")
  fi
fi

if [[ -n "$failure" ]]; then
  logger --tag beacon-monitor -- "$failure"
  # Alert once, and again each day the same problem is still open.
  if [[ ! -f "$alert_marker" ]] || [[ -n "$(find "$alert_marker" -mmin "+$alert_repeat_minutes" 2>/dev/null)" ]]; then
    send_email 'Beacon service needs attention' "$failure Check the Oracle VM and Beacon service status."
    date --utc --iso-8601=seconds >"$alert_marker"
  fi
  exit 1
fi

if [[ -f "$alert_marker" ]]; then
  send_email 'Beacon service recovered' 'The public readiness endpoint, required service containers and backups are healthy again.'
  rm -f "$alert_marker"
fi

logger --tag beacon-monitor -- 'Beacon public readiness and required services are healthy.'
