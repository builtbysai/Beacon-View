# ADR 0054: Preserve user-owned camera source names during device sync

Status: accepted for the current integration baseline, September 22, 2026.

## Context

Android calls `PUT /api/device/cameras` when its foreground service starts. It
builds the payload from `CameraManager.cameraIdList`, omits entries whose lens
facing is unrecognized, and sends an `android:default` fallback if none remain.
The request has no explicit complete-snapshot flag or removal list. The web
viewer lets a user rename each source. The pre-integration repository already
preserves names in the normal upsert, but the one-time `legacy-default` source
key migration replaced a user rename with Android's generic name.

The backend branch's proposed topology sync (`0cd4631`) overwrites display
names on every request and marks every omitted source removed. Those semantics
are not justified by the Android caller.

Browser Camera Mode also calls `POST /api/browser-devices` on start and source
switch. Its installation ID makes this an upsert. Re-registering the same
installation must not replace names changed later in Camera Settings with stale
browser-local labels.

## Decision

- Treat `sourceKey`, facing, and reported capabilities as device-owned.
- Treat `displayName` as user-owned after initial source creation. The Android
  name is an initial suggestion only.
- Treat the current sync payload as positive observations. Do not remove
  sources because a key is absent.
- Keep explicit user deletion as the existing removal path. Do not import
  implicit source removal or display-name overwrite from the backend branch.
- Preserve the display name when converting `legacy-default` to a real Android
  source key.
- Treat browser registration names as initial suggestions for a new device or
  source. On an existing installation, preserve user-owned device and source
  display names while refreshing reported facing, capabilities, and presence.
- Return the canonical device and source names to Browser Camera Mode after
  registration so its local display follows names saved in Camera Settings.

## Consequences

A physically removed or temporarily unenumerated source can remain registered
until the user removes it. Its availability still depends on the live producer
connection. Automated physical removal needs a separate, authenticated contract
that proves a complete source inventory or carries explicit removal events,
followed by acceptance tests across permission loss, hardware changes, Android
restart, and user rename.
