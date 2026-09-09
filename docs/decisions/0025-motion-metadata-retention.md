# ADR 0025: Household-configured motion metadata retention

Status: Accepted

## Context

Beacon motion history contains only on-device scene-change metadata, but an
unbounded history is still sensitive household activity information. Manual
history deletion is insufficient because it relies on continuous owner action.

## Decision

Each household has one server-enforced motion-metadata retention duration. The
allowed values are 1, 7, 30, and 90 days; new households default to 30 days.
The authenticated owner changes this setting through a CSRF-protected API and
the web Settings screen. Changes are recorded as audit events without event
contents.

The backend excludes expired rows from reads immediately. A single-instance
hourly backend job permanently deletes expired rows and records a deletion-count
audit event for each affected household. The job never deletes access history,
device data, credentials, media, or recordings; Beacon does not store media.

## Consequences

The policy gives owners a clear, limited choice while keeping deletion
server-enforced even if a device is stale or manipulated. The hourly job is
appropriate only for the current single-instance deployment. A future
multi-instance deployment must use a singleton scheduled job or database-backed
coordination so deletion auditing is not duplicated.

Database backups may retain deleted rows until their separate expiry policy.
Backup retention, restore verification, account deletion, and access-history
retention remain production release gates.
