# ADR 0018: Household-scoped motion history pagination

Status: Accepted for implementation; retention policy remains a release gate.

## Context

The web viewer filtered the latest 100 motion events in memory. A busy camera
could hide an older event from another camera even when the user selected that
camera. The API exposed no way to read older history.

## Decision

Filter in PostgreSQL by optional public camera ID and UTC lower time bound. Every
query joins camera ownership and constrains the authenticated household. Unknown
or foreign cameras return an empty history without exposing their existence.

Use keyset pagination ordered by occurrence time and event UUID descending, with
50 events by default and a maximum of 100 per request. Fetch one extra row to
determine whether another page exists. The opaque, bounded base64url cursor holds
only a timestamp and event UUID. Preserve PostgreSQL microseconds in the cursor;
JavaScript Date truncation would otherwise skip events within the same millisecond.
The cursor is validated but not an authorization credential. Every page applies
household authorization independently, including when a cursor is edited.

The web timeline groups metadata by the viewer's local calendar day, keeps the
time cutoff fixed while paging, and retains loaded rows on a failed older-page
request. Filter changes abort pending reads and invalidate late results. New
activity offers an explicit refresh so reading position is retained; a household
history-clear notification immediately invalidates the displayed history.

## Consequences

No schema migration, media collection, background stream, or new dependency is
required. Existing metadata-only deletion remains household-wide, CSRF protected,
and explicitly confirmed, including when a filter is selected. Cursor pagination
is not a database snapshot: subsequent deletions remove entries and new activity
appears on refresh. Very large histories still require capacity measurements and
automatic retention; pagination does not close those release gates.

## Validation

Automated cases cover malformed filters, foreign cameras, unauthenticated reads,
more than 100 events, equal timestamps, microsecond differences, retries, stale
responses, unavailable browser storage, realtime updates/deletion, and camera
navigation. Integration tests use a dedicated PostgreSQL test database.
