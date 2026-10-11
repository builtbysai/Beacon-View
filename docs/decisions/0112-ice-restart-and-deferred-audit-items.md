# ADR 0112: Repair live connections with an ICE restart; what the audit leaves open

- Status: Accepted (2026-10-11, audit findings V21 and V65)

## Context

A live view dropped for good about ten minutes after a relayed connection started or after a short
network change: the viewer waited eight seconds in the `disconnected` state and then tore everything
down. Nothing could renew the relay credentials or restart ICE.

## Decision

- When the viewer's connection becomes `disconnected`, it sends `ice-restart`. The signaling server
  answers the viewer with `ice-config` (fresh relay servers) and tells the camera `ice-restart` with
  fresh servers for that side. The camera applies them and sends a new offer with ICE restart; the
  viewer answers it like any offer. One request per five seconds per connection is honoured; extras
  are dropped without an error because an error ends the session.
- The eight second rebuild stays as the fallback, so an old camera app that ignores the message
  behaves as before.
- Implemented in the backend hub, the web viewer, the browser camera, the Android camera and the
  Android viewer.

## Not proven

Unit tests cover each end, but no two-network test longer than the credential lifetime has been run,
which the audit asked for. Treat the repair as unproven until that test is done.

## Findings left open, with the reason

- V30, V60 (chunked clip format): changes the stored format on every platform.
- V43, V22, V70, V71: decided on 2026-10-11 (ADR 0113).
- V22 (device credential rotation): a lost reply would lock a camera out; needs a two-step design and a
  real-phone test.
- V61, V70, V71: need field data or a device matrix.
- V50: Android 14 restricts starting the camera service from boot; needs a device check.
- F3: the coturn container is shared with Beacon Remote and stays untouched until the owner says.
- F5, V14, V58: in-process limits and one-time codes are correct for one backend instance; move them to
  PostgreSQL before running a second.
- F8, V35, V36, V37, V79: refactors with no user-visible change.
