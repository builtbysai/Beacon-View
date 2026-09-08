# ADR 0013: Android monitor account sessions

## Context

Beacon's Android camera credential is deliberately restricted to registration,
heartbeat, signaling, source synchronization, privacy, and self-removal. A combined
Android camera and monitor application also needs household viewer authority, but
granting that authority to the unattended camera credential would violate least
privilege.

## Decision

Android Monitor uses a separate, revocable account session obtained from a dedicated
rate-limited login endpoint. The raw bearer token is returned only at login, hashed in
PostgreSQL, redacted from server logs, and encrypted with an independent Android
Keystore key at rest. Existing household authorization remains authoritative. Bearer
requests do not require browser CSRF tokens because they are not ambient credentials;
browser cookie requests retain CSRF and origin validation.

Camera Mode and Monitor Mode remain independent. Opening Monitor does not stop the
visible camera foreground service. Pairing or removing the camera credential does not
sign the household viewer session in or out.

## Consequences

- A camera credential cannot enumerate household cameras.
- A stolen viewer session has household authority and must therefore be revocable and
  handled as sensitive account material.
- Android live playback uses the same signaling authorization and household ownership
  checks as browser viewers. Native clients present the session as an Authorization
  bearer header; cookie viewers retain exact browser-origin validation.
- Every native live view owns and disposes its WebSocket, peer connection, decoder,
  EGL context, and renderer. Transient failures recreate only that viewer session;
  Camera Mode and other cameras remain untouched.
- Monitor observes the Android lifecycle through the Jetpack lifecycle Compose bridge.
  Stopping the Activity releases the remote viewer rather than consuming network,
  decoder, and TURN capacity invisibly. Starting it creates a fresh renderer and
  connection. The foreground Camera Mode service remains independent.
- A later production authentication review should consider shorter-lived access tokens
  with refresh rotation; the current session inherits the existing seven-day idle and
  thirty-day absolute limits.
