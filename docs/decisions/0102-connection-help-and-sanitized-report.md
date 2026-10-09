# ADR 0102: Connection help and a sanitized troubleshooting report

Status: Accepted for the owner's October 9, 2026 roadmap continuation.

Improve the existing web/desktop Connection details page rather than add a new
diagnostics service. Keep the authenticated manager-only API and its partial
failure handling. Add manual refresh, a snapshot timestamp, practical guidance
for online/offline/paused/revoked devices, and preview/copy of a local report.
Abort pending requests on refresh/unmount and remount for account/household/role changes.

The report constructs a new allowlisted object instead of serializing the API
response. Include report version, check time, unavailable sections, numbered
devices/cameras, known platform/state/facing values, bounded viewer counts, and
heartbeat recency buckets. Unexpected strings become unknown. Exclude account,
household, device, camera, viewer, and source identifiers; names; software version;
precise heartbeat timestamps; credentials; SDP; ICE; raw errors; and arbitrary
capability fields. API identifiers remain internal React keys only in this view.

Report generation is local and user initiated copying writes to the clipboard.
Show the complete report in a readonly text field for review and manual copy if
clipboard permission is denied or unsupported. No upload, email, telemetry, or
automatic support submission is introduced.

The check describes a backend connection snapshot, not an end-to-end media or
notification test. Heartbeat recency uses the viewer clock; invalid/future times
are unknown. Refresh is explicit, so an old snapshot must not be presented as a
continuous monitor or a setup-health guarantee. The report omits identifying
context, which can limit support's ability to distinguish otherwise similar
devices; a user can supply that context separately if needed.

No API schema, dependency, environment variable, database migration, native
Android change, or recurring cost is required. Real video/audio, TURN, notification,
and installed-desktop acceptance remain separate roadmap evidence items.
