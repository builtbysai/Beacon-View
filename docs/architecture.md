# Architecture

## Milestone 2 scope

The Fastify backend owns identity, authorization, device pairing, credential
revocation, presence, and signaling authorization. PostgreSQL is the security
state authority. The React viewer uses cookie-authenticated JSON and WebSocket
endpoints, while Android uses a separate bearer credential.

Android binds rear-camera CameraX preview and analysis to the visible activity.
YUV frames feed a WebRTC I420 video source at a target 640×480 and 15 fps. The
peer connection has one send-only video transceiver and no audio source or track.

## Ownership and credentials

Account creation transactionally creates one household owned by that user.
Cameras belong to one household. Only that household owner can create pairing
codes, list cameras, and revoke camera credentials.

Browser session and device tokens contain at least 32 random bytes. Only SHA-256
token hashes are stored. Passwords use Argon2id. Browser sessions have a 7-day
rolling idle limit bounded by a 30-day absolute limit. The session cookie is
HttpOnly, `SameSite=Lax`, and `Secure` outside local HTTP development.

Pairing codes use ten characters from an unambiguous 32-character alphabet
(50 bits). They expire after ten minutes. Redemption locks the code row and
creates the camera and credential before marking the code consumed in the same
transaction.

## Presence

The Android client heartbeats every 30 seconds while its activity participates.
The server updates `last_seen_at`; a camera is online through exactly 90 seconds
after its last successful heartbeat. There are no push channels.

## WebRTC signaling and media

The device keeps one authenticated WebSocket open while its activity is visible.
An owner opening a live view is reauthorized by browser session, Origin,
household ownership, and active device credential. One viewer is allowed per
camera.

The camera creates the offer; the browser returns the answer. Both peers exchange
ICE candidates through the authorized connection. A 30-second unanswered
negotiation timeout and WebSocket close handlers remove state. The backend never
receives or relays media.

WebRTC uses DTLS-SRTP transport encryption. The backend can see SDP and ICE but
does not log their contents. Coturn may relay encrypted packets and observe
connection metadata, but cannot decrypt the WebRTC media. This is not an
application-level end-to-end-encryption claim.

## API surface

- `POST /api/auth/register`, `/api/auth/login`, and `/api/auth/logout`
- `GET /api/auth/me`
- `POST /api/pairing-codes` and
  `DELETE /api/pairing-codes/:pairingCodeId`
- `POST /api/devices/register`
- `GET /api/cameras` and
  `DELETE /api/cameras/:cameraId/credential`
- `POST /api/device/heartbeat`
- `GET /api/signaling` as an authenticated WebSocket upgrade

Browser state changes require CSRF validation. Device heartbeat uses a bearer
credential and never accepts credentials in URLs.

## Boundaries

Drizzle defines and migrates the PostgreSQL schema through explicit checked-in
SQL. Production startup never mutates schema. Coturn is an ICE relay fallback,
not a media processor. TypeScript packages are not imported by Android.
