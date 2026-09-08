# ADR 0019: Atomic motion ingestion

Status: Accepted.

## Context

The first ingestion query checked for recent motion and inserted an event in one
statement. Concurrent requests could each see no recent event and insert duplicates.
A controlled PostgreSQL test reproduced eight events in one cooldown window. A
concurrent privacy, source-disable, or credential change could also occur after
authorization was read and before insertion completed.

## Decision

Use one short Read Committed transaction per report. Lock the authorized device,
then revalidate and lock its credential and source. Keep those locks through the
cooldown check and insertion. Check recent events in a separate statement after
obtaining the locks, so a waiting request sees the preceding writer's committed
event. PostgreSQL's [Read Committed behavior](https://www.postgresql.org/docs/17/transaction-iso.html)
provides a fresh snapshot for each statement and rechecks rows changed while waiting.

Authorization still requires the exact reporting credential, matching source,
enabled device/source, non-revoked access, and privacy off. Invalid credentials
remain unauthorized. Suppressed duplicate reports still return the existing no-content
response. The server-controlled occurrence time is unchanged. The default
30-second cooldown is now one of the per-camera values described in
[ADR 0021](0021-per-camera-motion-settings.md).

## Consequences

No additional service, database migration, or media collection is needed. Reports
from one physical device briefly serialize; different devices remain independent.
A report holding the locks may complete before a concurrent restriction commits.
Once the restriction commits, waiting reports must observe and honor it. Transaction
failures roll back and release the pooled connection.

## Validation

The eight-writer reproduction now inserts one event. Tests verify suppression one
millisecond before the cooldown boundary, acceptance at the boundary, rollback on a
database constraint failure, and rejection of waiting reports when privacy, source
disablement, device revocation, or credential revocation commits first.
