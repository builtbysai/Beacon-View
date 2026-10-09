# ADR 0100: Activity date filters and search scope

Status: Accepted for the owner's October 9, 2026 continuation.

Activity already supports camera filters, 24-hour/7-day presets, text search,
event kinds, and pagination. Improve that existing view without introducing a
new backend service or an unbounded background history download.

Add a 30-day preset and a local-calendar Since date control. Convert the date to
local midnight and send its UTC instant through the existing `since` parameter
to both authorized motion and household queries. Preserve the exact query when
loading subsequent pages. Empty or invalid dates block requests, rather than
silently broadening them to all history. Since date has no end-date bound.

Search trims whitespace and searches loaded event labels, device/source names,
and household actors. Event kind, counts, and sorting also apply to loaded
pages. Explain this beside the controls and encourage Load more while either
history has additional pages. Never claim zero matches across unloaded history.
Reset restores all cameras, 24 hours, all kinds, empty search, and newest first.
Show device and source labels together to distinguish camera choices.

Remember camera/time/date preferences only in account/household-scoped local
storage. Remount Activity when that scope changes and reload when household
activity eligibility changes. Existing server authorization remains authoritative.
Older account-only filter preferences are not migrated into a household scope.
No events, media, or credentials are stored by this preference feature.

No API schema, database migration, dependency, capture behavior, or native
Android change is required. Retention can remove older events regardless of the
selected date. Global server-side text search and end-date ranges remain outside
this milestone.
