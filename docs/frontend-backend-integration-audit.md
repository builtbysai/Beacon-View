# Frontend/backend integration audit

Verified September 22, 2026 against `frontend-backend-integration` at
`af28b03` and `origin/backend-integration` at `e42f1ce`. This is an implementation
inventory, not a release acceptance report.

## Visual baseline and refs

`frontend-recovery-final-2026-09-17` resolves to `af28b03`, the same commit as
`frontend-backend-integration`. The Settings width, responsive navigation,
Notification Settings cards, Quiet Hours layout, modal stability, and header
alignment commits are all ancestors of that tag. The recovery branch adds
migration documents, a read-only environment script, and executable bits on
Linux scripts after the tag; it adds no web viewer change. The existing tag is
already on GitHub and serves as the visual checkpoint. Do not merge the recovery
branch for frontend integration.

## Verified feature map

| Area                                   | Current contract and status                                                                                                                                                                                                                                                                                 | Integration gap                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                                   | `/api/cameras` and `/api/devices` drive current camera and attention states. Favorites are local preference. Latest activity uses `/api/motion-events?limit=4`.                                                                                                                                             | Latest activity is motion only, not household activity. Keep Home a small current-state preview.                                                                                                                                                                                                                                                                           |
| Cameras and device sources             | Listing, rename, delete, activation, privacy, pairing, and reconnect use backend routes. Device health and source metadata are in device/source records. Search and filters are local or URL state.                                                                                                         | Physical source removal semantics are unproven. Do not infer deletion from an omitted Android sync entry.                                                                                                                                                                                                                                                                  |
| Activity                               | `/api/motion-events` provides paged, real motion metadata; `/api/access-history` provides a separate, admin-only security history. `audit_events` already stores actions and structured metadata.                                                                                                           | Activity currently fabricates person/package/vehicle/animal/sound/doorbell kinds from event IDs. There is no household product activity feed on this branch. Add a permission-aware activity API using `audit_events`; never label motion as object detection without a producer claim.                                                                                    |
| Authentication and household sharing   | `/api/auth/me`, password and Google flows, household switching, invitations, membership, grants, and guest routes exist. Settings calls the sharing API.                                                                                                                                                    | Verify every new activity/realtime read against owner/admin versus granted viewer/guest access. Physical multi-account acceptance remains open.                                                                                                                                                                                                                            |
| Settings and Quiet Hours               | Notification preferences autosave through `PUT /api/notification-preferences/:deviceId`. `quietHours` uses time-of-day and IANA time zone validation, PostgreSQL columns, reload from GET, and motion/offline/recovered delivery suppression. Motion settings and retention have separate persisted routes. | Notification preference storage/query is owner-scoped while Settings renders Notifications for admins too; admin behavior needs a deliberate policy and test. Notification GET failure currently appears as an empty camera list. End-to-end delivery/reload and realtime behavior still need explicit verification. Preserve the current Settings layout and autosave UX. |
| Security, sessions, Drive, recordings  | Browser sessions, access history, Drive connection and verification, and recording routes are backend-backed. Live recording availability is derived from Drive status for the owner.                                                                                                                       | Runtime capability detection is scattered. `origin/backend-integration` adds `/api/capabilities`, but the frontend does not consume it yet. Optional features need explicit unavailable states where relevant.                                                                                                                                                             |
| Browser camera, live viewer, signaling | Browser device registration, producer signaling, live WebRTC viewer, and recording request paths exist. Household WebSocket events refresh current data.                                                                                                                                                    | Add targeted activity/configuration invalidation after the activity contract lands; avoid per-heartbeat broadcasts. Physical network/media acceptance remains separate.                                                                                                                                                                                                    |
| Diagnostics                            | `/api/diagnostics` is admin-only and returns sanitized state.                                                                                                                                                                                                                                               | A rejected request left the page loading indefinitely; repair and test this without changing the normal layout.                                                                                                                                                                                                                                                            |

## Backend branch audit and safe integration order

The backend branch adds household activity querying and event metadata, presence
transitions, source synchronization behavior, and `/api/capabilities`. Its web
file changes are older design variants and must not be merged into the approved
frontend. Start with the activity query/route/authorization commits, then add
device and pairing event metadata, test each group, and wire the approved UI to
the resulting contract. Handle presence and source events only after their
contracts are verified. The capability endpoint can be brought forward as a
separate backend group. No new activity table is needed unless the existing
`audit_events` retention or query model proves insufficient.

Android calls `PUT /api/device/cameras` from `CameraForegroundService` startup
using `CameraManager.cameraIdList`, but drops entries with unknown lens facing
and supplies an `android:default` fallback if no recognized source remains.
Therefore an omitted key does not reliably mean the source was removed. Android
supplies generic hardware names, while web users can rename sources. Preserve
user display names and only treat facing/capabilities as device-owned data.
ADR 0054 records the resulting contract: `0cd4631` and its dependent source
removal commits are withheld; the existing positive-observation sync remains.
The one-time legacy source migration now preserves a user rename.

Progress on this branch: Diagnostics now has a retryable error state; the
owner/admin activity API reads `audit_events`; the capability endpoint reports
configured optional services; and motion history no longer invents object or
sound detection labels from event IDs. Household activity is not yet wired into
the Activity UI, and PostgreSQL-backed validation remains required.
The three inherited frontend test failures were stale assertions/test setup;
after aligning them with the approved UI, the frontend suite passes. Drive
Settings now explains when the server reports Drive unconfigured and offers a
retry when the status request fails, instead of linking to an unavailable OAuth
flow.
Quiet Hours now has browser autosave/reload coverage and a PostgreSQL-backed
delivery check: preferences persist with their IANA time zone, motion remains
recorded during the quiet window, and alert creation resumes outside it. The
full web suite passes 172 tests and the full backend suite passes 205 tests
against the dedicated test database. Admin notification policy and realtime
configuration invalidation remain open.
