# Architecture

The runtime lifecycle and state-machine design is specified in
[`device-lifecycle.md`](device-lifecycle.md). Android camera operation is owned
by a foreground service rather than the activity. Signaling sessions are keyed
by connection ID, allowing independent viewer cleanup, while an authenticated
household event WebSocket keeps browser camera state current without polling.

## Application module boundaries

The Android app has two parts (ADR 0121). The viewer is the web app itself, hosted in a locked-down WebView (`WebShellActivity`, `WebShellPolicy`) that exposes one origin-restricted message bridge (`NativeBridge`, `NativeBridgeProtocol`) for the things a page cannot do: starting the camera, privacy, push registration, saving files, Google sign-in hand-off. The camera agent stays native: capture, signaling, credentials and runtime state are independent services, and `CameraModeUi` is the camera-device screen that keeps capture visible. UI modules may request actions but do not own camera or microphone lifetime.

The web application shell coordinates authenticated routing and cross-feature realtime
state. Public authentication-return, pairing, trust, diagnostics, and device-guidance
surfaces are separate components. Domain contracts and independently testable feature surfaces live in separate modules. The
backend application composes authentication, account, enrollment, service, signaling,
camera-management, activity, and device-runtime features around one store contract; HTTP validation, camera response
presentation, and session/CSRF policy are centralized modules. New recovery, notification, or sharing
work must add policy and persistence boundaries rather than growing the application
assembly files. See [ADR 0041](decisions/0041-maintainability-boundaries.md).

The PostgreSQL store remains the application-facing persistence facade, while cohesive
query families may be delegated to internal repositories. Motion settings, event
insertion, cooldown and quiet-hours enforcement, history, and retention form one such
repository. Audit insertion, access-history projection, and retention form another;
transactional callers retain their existing database client. This preserves atomic
behavior without exposing SQL concerns to routes or future notification services.
Pairing lifecycle and registration throttling are isolated together, while browser
session creation, rolling-expiry lookup, listing, and revocation form a session
repository. Account creation, identity lookup, profile updates, and deletion form an
account repository; account/household creation remains atomic with its audit event. The
device repository owns inventory, source synchronization, browser registration,
heartbeat health, privacy/revocation lifecycle, and signaling identity lookup.

Notification transport is another PostgreSQL-backed boundary. Authenticated Android and
web installations register an encrypted provider identifier against the current Beacon
session. Per-device preferences default off. Accepted motion metadata creates its
notification event and outbox rows in the same transaction. A bounded in-process worker
leases outbox rows with `SKIP LOCKED`, sends generic data-only payloads through FCM HTTP
v1 or standards-based Web Push, and resumes pending work after restart. Physical-device
presence uses the existing 90-second online window plus a 120-second grace, with durable
state ensuring one offline and one recovery transition. See
[ADR 0044](decisions/0044-notification-transport-v1.md).

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
Its authenticated heartbeat may include the current bounded battery percentage and
charging state. These advisory fields are household-scoped device health, never media
or capture authorization.
YUV frames feed a WebRTC I420 video source at a target 640×480 and 15 fps. The
peer connection has send-only video and audio transceivers backed by one shared
CameraX/WebRTC media source. Viewer audio is muted until the user explicitly chooses
Listen.

Web live viewers may additionally request a single-owner talk channel. The signaling
server arbitrates one talker per camera connection set, while Android keeps its incoming
audio track disabled until that exact connection is granted. Viewer microphone capture
is explicit and is released on stop, navigation, disconnection, or privacy shutdown.

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

Each active camera source keeps one authenticated producer WebSocket. Viewer presence is
counted only after the device confirms that the WebRTC peer is connected; negotiating
sessions remain internal and bounded by timeout. Connected-viewer transitions publish a
household event so badges refresh without waiting for polling. A transient browser
`disconnected` state receives an eight-second recovery grace period before bounded
renegotiation begins (ADR 0046).
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
- `GET /api/access-history` for a household-scoped, 50-event security activity
  window covering live-view attempts, privacy changes, credential revocation,
  and camera/device removal without returning IP addresses or connection data
- `GET /api/devices/:deviceId` with its child sources and aggregate viewer count
- `GET /api/cameras/:cameraId` for an independently addressable source
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
