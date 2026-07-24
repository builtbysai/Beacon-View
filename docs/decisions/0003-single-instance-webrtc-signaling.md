# ADR 0003: Single-instance WebRTC signaling

- Status: Accepted
- Date: 2026-07-24

## Decision

Use Fastify WebSockets for Milestone 2 signaling. Keep device availability and
one active viewer per camera in process. Revalidate browser session, Origin,
household ownership, and device credential at each upgrade. Allow only offer,
answer, ICE, connected, and disconnect messages. Android creates the offer and
sends one video-only track; the browser answers.

Use CameraX `ImageAnalysis` to feed fixed 640×480, 15 fps I420 frames into native
Android WebRTC. Bind CameraX to the visible activity and show a local preview and
capture indicator. Use STUN for discovery and Coturn only as ICE fallback.

## Consequences

The backend never relays media and persists no signaling records. A backend
restart ends active sessions, and replicas are unsupported until signaling uses
shared storage or session affinity. Static TURN credentials and emulator URLs are
local-only. Audio, recording, background capture, commands, and multiple
simultaneous viewers remain out of scope.
