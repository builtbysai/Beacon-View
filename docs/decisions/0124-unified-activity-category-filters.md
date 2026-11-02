# 0124: Unified Activity with saved-history category filters

## Decision

On November 2, 2026 the owner chose one Activity timeline with filters instead
of separate Motion and Security views as the primary way to explore events.
Build on the existing merged motion/household timeline and audit store from
ADR 0057, rather than introducing a second event store or copying raw audit
records into a new client API.

The initial slice adds Motion, Recordings, Devices, Security and Household
filters alongside All. Category selection sends the existing allowlisted
`eventType` query parameters to `/api/activity` before offset pagination. Motion
uses its existing cursor API and is not fetched for a household-only category.
Both feeds retain the selected camera and date filters on subsequent pages.
Search, counts and sorting describe loaded events, not a global search/count.

All retains the existing default timeline: motion and relevant household
activity, with recording lifecycle noise omitted because clips attach to their
originating motion events. Explicit Recordings selection can query those
retained lifecycle events. It does not retrieve expired/deleted audit data or
change retention. No schema or backend contract change is needed for this slice.

Household categories remain owner/admin only. Viewers and guests use authorized
motion history without requesting household audit events. Losing administrator
eligibility clears private history/details and resets a selected household
category to Motion. The Security category uses the existing household access,
privacy and membership allowlist; it does not expose account login records or
broaden access to another household or user.

Filter controls wrap on small screens so every category is discoverable.
Recording share-link events have explicit human-readable labels. A recording
audit row is not itself permission to fetch or share the underlying clip.

## Evidence and remaining scope

Workflow regressions cover recording history outside the default page,
category-aware pagination with camera/date selection preserved, and loss of
administrator access while Security is selected. Existing merge-order, retry,
filter-reset, private-detail and motion-history tests remain in place.

Lint, web typechecking/build and the web regression suite passed. Isolated
Edge fixtures at phone and desktop widths checked category navigation, saved
history queries, fitting controls and automated WCAG checks after transitions
settled. No live account, camera, media or production service was used.

Issue #20 remains open for richer per-event recording/sharing detail where the
current contract lacks it and end-to-end acceptance of the combined product
flow. This UI slice does not close physical-device issue #21 or release gates.
