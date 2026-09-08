# ADR 0023: Server-enforced daily motion quiet hours

Status: Accepted for the production-readiness continuation.

## Decision

Each Android camera source may have one optional daily motion quiet-hours interval.
The contract is either `null` (no quiet hours) or an object with `start` and `end`
in zero-padded 24-hour `HH:mm` form plus a canonical IANA time-zone identifier.
`UTC` is accepted as the IANA UTC alias. The server rejects unknown zones, malformed
times, extra fields, and equal start/end values; equal times do not mean all day.

Intervals include their start and exclude their end. An end before the start crosses
midnight. During a daylight-saving fall-back, both occurrences of a repeated local
minute are quiet; spring-forward minutes that do not occur have no effect.

The backend evaluates the interval using its current server time inside the existing
locked motion-ingestion transaction, after device/source authorization and before
insertion. A quiet report is suppressed just like a disabled source: no metadata is
stored and the valid device credential remains paired. Android independently applies
the latest authenticated setting on its analysis thread, resets its detector while
quiet, and avoids uploading reports that it can locally suppress. The server remains
the authority when a phone has stale settings, a changed time zone, or a manipulated
device clock.

The owner controls the setting through the existing CSRF-protected per-camera motion
settings route. Quiet hours affect motion metadata only: they never stop live video,
audio, foreground capture disclosure, or privacy mode.

## Consequences

This adds a schema migration but no scheduler, background worker, notification system,
media storage, or client-only switch. A device refreshes settings through its existing
authenticated status cycle, so a just-saved setting can take up to that cycle to reach
the phone; backend enforcement is immediate. Multiple intervals, day-of-week rules,
activity zones, notifications, and a device-location-derived zone remain separate
decisions.
