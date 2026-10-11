#!/usr/bin/env bash
set -Eeuo pipefail

monitor_script="${1:-infrastructure/cloud/beacon-monitor.sh}"

bash -n "$monitor_script"
grep --quiet --fixed-strings 'beacon-backup.service' "$monitor_script"
grep --quiet --fixed-strings 'beacon-backup-check.service' "$monitor_script"
grep --quiet --fixed-strings 'coturn' "$monitor_script"
grep --quiet --fixed-strings 'daily_backup_max_age_seconds' "$monitor_script"
grep --quiet --fixed-strings 'weekly_backup_check_max_age_seconds' "$monitor_script"
grep --quiet --fixed-strings '/ready' "$monitor_script"
# A backup timer that is disabled must be reported, not read as healthy (V68).
grep --quiet --fixed-strings 'systemctl is-enabled "$timer"' "$monitor_script"
grep --quiet --fixed-strings 'has never completed since its timer was enabled' "$monitor_script"
# Open problems are repeated, and the web container is watched.
grep --quiet --fixed-strings 'alert_repeat_minutes' "$monitor_script"
grep --quiet --fixed-strings 'web container is not running' "$monitor_script"

# The JSON helper must keep a quote, backslash or newline in a value from
# breaking the email request.
function_source=$(awk '/^json_escape\(\) \{/{found=1} found{print} found && /^}/{exit}' "$monitor_script")
[[ -n "$function_source" ]]
eval "$function_source"
escaped=$(json_escape $'Beacon "Security" <a\\b@example.com>\nsecond line')
[[ "$escaped" == 'Beacon \"Security\" <a\\b@example.com>\nsecond line' ]]

echo 'Beacon monitor static checks passed.'
