#!/usr/bin/env bash
set -Eeuo pipefail

monitor_script="${1:-infrastructure/cloud/beacon-monitor.sh}"

bash -n "$monitor_script"
grep --quiet --fixed-strings 'beacon-backup.service' "$monitor_script"
grep --quiet --fixed-strings 'beacon-backup-check.service' "$monitor_script"
grep --quiet --fixed-strings 'coturn' "$monitor_script"
grep --quiet --fixed-strings 'daily_backup_max_age_seconds' "$monitor_script"
grep --quiet --fixed-strings 'weekly_backup_check_max_age_seconds' "$monitor_script"
grep --quiet --fixed-strings '[[ -n "$completed_at" ]] || return 0' "$monitor_script"
grep --quiet --fixed-strings '/ready' "$monitor_script"

echo 'Beacon monitor static checks passed.'
