# ADR 0081: Authorize Android manual recording through a server-owned camera command

- Status: Accepted for the active Android parity milestone
- Date: 2026-09-27

## Context

The web viewer records the `MediaStream` it receives in the browser. The native
Android viewer renders a WebRTC video track directly and does not have a safe,
existing container recorder for that remote track. The Android camera device
already has a bounded CameraX clip recorder plus encrypted Google Drive upload,
completion verification, failure reporting, and visible capture UI for
motion-triggered clips.

Allowing a viewer socket to send an arbitrary recording command would weaken the
authorization boundary. Recording creation is owner-only, requires the recording
Drive scope, checks camera access and presence, and creates the audited recording
row through `POST /api/recordings`.

## Decision

- `POST /api/recordings` accepts an optional `captureMode`. Existing web callers
  retain the default `viewer` mode and continue capturing their received stream.
  Android sends `camera` mode.
- After all existing owner, storage, access, and online checks pass and the
  recording row is created, the backend sends a `recording-request` directly to
  the authenticated camera-device socket. Viewer sockets cannot originate or
  forward this message.
- The camera reuses its existing CameraX capture, client-side AES-GCM encryption,
  Drive upload, backend verification, completion, and failure paths. Manual clips
  are bounded to 15 seconds; motion-triggered clips keep their existing duration.
- Recording remains unmistakable: the camera UI shows `RECORDING`, its foreground
  notification says a clip is being recorded, and the Android viewer shows the
  same manual-recording lifecycle language as the PWA.
- A command-dispatch race is terminally marked failed rather than leaving a
  requested recording stranded indefinitely.

## Consequences

- Android gains manual recording without another media-storage system or a new
  encryption policy.
- The implementation records at the camera, so it remains independent of the
  native viewer renderer and captures the camera's configured audio permission.
- The new backend and APK must be deployed together before physical end-to-end
  acceptance. Older backends reject Android's strict `captureMode` request, while
  older camera builds do not understand the server command.
- A camera can record only one clip at a time. Concurrent motion/manual requests
  fail through the existing recording-failure path instead of overlapping
  CameraX recorders.
