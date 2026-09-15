# ADR 0050: Device-bound reconnect codes

Status: accepted and implemented for the private alpha on September 14, 2026.

## Context

A normal pairing code creates a new camera device. That is correct for setup,
but it gives a poor recovery path when an existing Android camera loses or has
its credential revoked: the installation identifier remains unique, settings
belong to the existing device, and asking the owner to delete and recreate the
camera discards useful configuration.

## Decision

Owners and admins can create a ten-minute, one-time reconnect code from the
existing camera's settings in the signed-in viewer. The code is bound to the
existing internal device identifier. Redemption succeeds only when the Android
installation identifier matches that device, rotates the device credential,
clears revocation, and preserves the device, camera-source, motion, and sharing
records.

The Android camera does not create reconnect codes. It only scans or accepts the
code issued by the authenticated household manager. Generic pairing remains the
flow for genuinely new devices.

Choosing Disconnect on Android stops capture and sends an authenticated JSON
disconnect action. The backend revokes the device credential and retains the
device row instead of deleting it, so the viewer can issue the bound reconnect
code. The legacy DELETE route remains available for older Android builds and
has the same revocation semantics.

Viewer APIs distinguish health presence from live availability. A recent
heartbeat remains useful diagnostic information, but a camera or device is
reported online only while its authenticated producer signaling socket is
connected. Revoked devices additionally report `needs_pairing` as their
connection state.

## Consequences

- Recovery no longer requires deleting and recreating a camera.
- A reconnect code cannot move an existing camera record to a different Android
  installation.
- Reconnect rotates rather than restores the previous credential.
- A local disconnect is visible immediately when the signaling socket closes;
  stale heartbeat timestamps no longer make a stopped camera appear ready.
- Disconnect preserves settings and history. Permanent deletion remains an
  explicit owner/admin action in the signed-in viewer.
- Reconnect creation and redemption remain rate-limited and audited.
- Physical acceptance must verify revoked, offline, expired-code, wrong-device,
  and successful reconnect cases.
