# Workspace layouts

## Model

A workspace is a presentation preference, not an authorization boundary.
Version 1 stores:

- stable workspace ID and user-visible name
- ordered camera-source public IDs
- layout capacity: 1, 2, 4, 6, 9, 12, or 16
- fullscreen preference reserved for restoration behavior
- refresh preference: visible or continuous

Preferences are stored in browser `localStorage` under a user-scoped key.
Credentials, household IDs, signaling data, media, and private diagnostics are
never stored with a workspace. Invalid or unknown versions safely fall back to
a Home workspace. Deleted camera IDs are removed when camera metadata updates.

## Persistence choice

Local persistence is the smallest secure implementation supported by the
current backend. It avoids presenting cross-device synchronization that does
not exist and avoids a database migration before sharing semantics are defined.
A future server model may synchronize workspaces after household membership,
write authorization, limits, audit requirements, and conflict handling are
approved.

## Ordering and filtering

Ordering is persisted independently from active filters. Dragging a tile or
using its earlier/later buttons moves its camera ID in the workspace order.
React keys remain camera IDs, so the stream component moves without being
recreated.

Filters are temporary view controls for device, reported status, and platform.
Room filtering is intentionally omitted because Beacon does not currently store
room metadata. Future platform types automatically remain representable; named
filter options should be added only when that platform is functional.

## Known limitations

- Workspaces do not synchronize between browsers or devices.
- Rename and deletion use existing browser-native management interactions.
- A source-switch request that fails leaves the original tile selection.
- Fullscreen is an in-application expansion so navigation and controls remain
  available; it is not an operating-system display mode.
- Refresh timing is visibility-based and is not a configurable polling system.
