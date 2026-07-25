# Architecture

The runtime lifecycle and state-machine design is specified in
[`device-lifecycle.md`](device-lifecycle.md). Android camera operation is owned
by a foreground service rather than the activity. Signaling sessions are keyed
by connection ID, allowing independent viewer cleanup, while an authenticated
household event WebSocket keeps browser camera state current without polling.

## Device and camera model

A household owns devices; each device exposes one or more camera sources.
Android and browser devices may produce video, while any responsive browser may
view it. Producer and viewer roles are not mutually exclusive. See
[`multi-camera-architecture.md`](multi-camera-architecture.md).

The historical SQL `cameras` table now represents devices for migration
compatibility. `camera_sources` contains independently addressable sources.
Existing Android rows receive a default source without changing credentials or
requiring repair.

## Current scope

The Fastify backend owns identity, authorization, device pairing, credential
revocation, presence, and signaling authorization. PostgreSQL is the security
state authority. The React viewer uses cookie-authenticated JSON and WebSocket
endpoints, while Android uses a separate bearer credential.

Android enumerates Camera2 sources and binds the selected CameraX source to the
foreground service.
YUV frames feed a WebRTC I420 video source at a target 640×480 and 15 fps. The
peer connection has one send-only video transceiver and no audio source or track.

## Ownership and credentials

Account creation transactionally creates one household owned by that user.
Devices and camera sources belong to one household. Only that household owner
can create pairing codes, register browser cameras, list inventory, view
cameras, and revoke devices.

Browser session and device tokens contain at least 32 random bytes. Only SHA-256
token hashes are stored. Passwords use Argon2id. Browser sessions have a 7-day
rolling idle limit bounded by a 30-day absolute limit. The session cookie is
HttpOnly, `SameSite=Lax`, and `Secure` outside local HTTP development.

Pairing codes use ten characters from an unambiguous 32-character alphabet
(50 bits). They expire after ten minutes. Redemption locks the code row and
creates the camera and credential before marking the code consumed in the same
transaction.

## Presence

The Android client heartbeats every 30 seconds while its foreground service
participates.
The server updates `last_seen_at`; a camera is online through exactly 90 seconds
after its last successful heartbeat. There are no push channels.

## WebRTC signaling and media

Each active camera source keeps one authenticated producer WebSocket.
An owner opening a live view is reauthorized by browser session, Origin,
household ownership, and active device credential. Multiple viewers are allowed
per camera with independent connection IDs and peer connections.

The camera creates the offer; the browser returns the answer. Both peers exchange
ICE candidates through the authorized connection. A 30-second unanswered
negotiation timeout and WebSocket close handlers remove state. The backend never
receives or relays media.

The backend derives ten-minute Coturn REST credentials only after participant
authorization. STUN/TURN URLs and the `all` or diagnostic `relay` ICE policy are
validated server configuration, not user input. UDP and TCP TURN transports may
be supplied together, while `all` preserves direct ICE.

Active signaling sockets are periodically checked against current browser
session, household ownership, and device credential state. Revocation closes the
socket. Lifecycle diagnostics contain a correlation ID, public camera ID, role,
bounded state/reason categories, and duration—never SDP, raw candidates, tokens,
TURN credentials, household IDs, or database IDs.

Browser viewers use bounded exponential backoff. Android and browser producers
continue transient retries with capped exponential backoff and jitter. Each
connection generation invalidates stale sockets, peer connections, and timers.
Android observes default-network availability while preserving its foreground
service and pairing credential across network loss. Shared CameraX capture is
released after the last viewer or explicit stop. Authorization loss is terminal
rather than endlessly retried.

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
- `PUT /api/device/cameras` and `POST /api/browser-devices`
- `GET /api/devices`, `GET /api/cameras`, `GET /api/diagnostics`, and
  `DELETE /api/cameras/:cameraId/credential`
- `POST /api/device/heartbeat`
- `GET /api/signaling` as an authenticated WebSocket upgrade

Browser state changes require CSRF validation. Device heartbeat uses a bearer
credential and never accepts credentials in URLs.

## Boundaries

Drizzle defines and migrates the PostgreSQL schema through explicit checked-in
SQL. Production startup never mutates schema. Coturn is an ICE relay fallback,
not a media processor. TypeScript packages are not imported by Android.

LAN development is an explicit orchestration mode around one validated laptop
IPv4 address. Caddy terminates trusted development HTTPS/WSS, Vite retains a
strict upstream port, and Coturn advertises and binds the selected address.
PostgreSQL remains loopback-only. These bindings do not change deployment
architecture or release trust policy.
