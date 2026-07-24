# Architecture

## Milestone 1 scope

The Fastify backend owns identity, authorization, device pairing, credential
revocation, and presence. PostgreSQL is the security state authority. The React
viewer uses cookie-authenticated JSON endpoints, while the Android app uses a
separate bearer credential for heartbeat. No media capture, signaling, WebRTC,
audio, recording, or background service exists.

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
after its last successful heartbeat. There are no push channels or signaling.

## API surface

- `POST /api/auth/register`, `/api/auth/login`, and `/api/auth/logout`
- `GET /api/auth/me`
- `POST /api/pairing-codes` and
  `DELETE /api/pairing-codes/:pairingCodeId`
- `POST /api/devices/register`
- `GET /api/cameras` and
  `DELETE /api/cameras/:cameraId/credential`
- `POST /api/device/heartbeat`

Browser state changes require CSRF validation. Device heartbeat uses a bearer
credential and never accepts credentials in URLs.

## Boundaries

Drizzle defines and migrates the PostgreSQL schema through explicit checked-in
SQL. Production startup never mutates schema. Coturn remains local foundation
only and is not used by Milestone 1. TypeScript packages are not imported by
Android.
