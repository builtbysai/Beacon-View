# ADR 0030: Backup freshness in private-alpha monitoring

Status: Accepted for the single-VM Oracle private alpha.

## Decision

Extend the existing five-minute Beacon monitor to inspect the most recent systemd
result and completion time for the daily backup and weekly Restic repository check.
It reports one failure when a job exits unsuccessfully or a previously successful job
becomes overdue: 30 hours for the daily backup and nine days for the weekly check. A
newly enabled weekly timer is not considered overdue until it has completed at least
once. The existing alert marker still suppresses duplicate mail during one continuous
failure and sends one recovery message after all checks pass.

## Consequences

This closes the gap where the public service remains healthy while backup jobs stop
succeeding. It does not prove a usable restore, verify backup content beyond the
weekly Restic check, add a dashboard, or replace an application restore drill. The
monitor reads only systemd status and timestamps; it does not read backup credentials,
database contents, Restic output, or media.
