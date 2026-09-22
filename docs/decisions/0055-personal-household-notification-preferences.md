# ADR 0055: Make household notification preferences personal to each manager

Status: accepted for the integration baseline, September 22, 2026.

## Context

Settings exposes Notifications to household owners and administrators, but the
backend previously listed, saved, and delivered camera preferences only for the
household owner. An administrator therefore saw an empty camera list and could
not receive motion, offline, or recovery alerts. Preferences and subscriptions
already carry a `user_id`, so the database model implied personal settings even
though the queries did not implement them.

## Decision

- Allow owners and administrators to read and update their own notification
  preferences for devices in their active household.
- Keep viewers and guests out of this household-wide manager surface until a
  grant-filtered notification contract is designed.
- Generate motion notification events for every opted-in user on the device,
  applying each user's Quiet Hours independently.
- Track offline/recovery state by `(user_id, device_id)` so each recipient has
  an independent transition and delivery record.
- Scope event deduplication by user so one recipient cannot suppress another
  recipient's event.

Migration 0026 upgrades existing presence rows to the household owner, changes
presence state to a composite key, and changes notification event uniqueness to
`(user_id, deduplication_key)`.

## Consequences

Owners and administrators receive only the alerts they personally enable, on
their own active subscriptions. A user's settings do not alter another user's
delivery. Removing or revoking membership still relies on the existing session
and subscription revocation paths. Viewer and guest notifications remain a
future grant-filtered feature.
