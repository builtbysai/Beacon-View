# ADR 0006: Persistent camera service and connection-scoped viewers

- Status: accepted
- Date: 2026-07-25

## Context

The Android activity previously owned heartbeat, signaling, CameraX, and a
single peer connection. `ON_STOP` disconnected the camera. Backend signaling
stored one session per camera and replaced the existing viewer. Browser pairing
was a permanent page fragment with no completion event.

## Decision

Use an Android foreground service as the device-runtime boundary. The activity
is a state-rendering and command UI. Keep one authenticated device signaling
socket and index viewer negotiations by connection ID. Add an
origin-checked, session-authenticated, household-scoped browser event socket
for camera lifecycle changes.

Capture remains visible and starts only for active authorized viewers. The
service, heartbeat, and signaling connection remain ready while no viewer is
present. Each viewer disconnect cleans up only its own peer connection.

## Consequences

Browser navigation and activity recreation no longer define device uptime.
Multiple viewers can negotiate independently without server media relay.
Android must show an ongoing foreground notification and must release all
camera resources when Camera Mode is explicitly stopped or authorization is
revoked. Multiple simultaneous encoders require physical-device performance
and thermal profiling.
