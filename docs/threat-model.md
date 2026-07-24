# Threat model

## Protected assets and trust boundaries

Passwords, browser sessions, CSRF tokens, device credentials, pairing codes,
household ownership, presence, and audit history are protected assets. Browser,
Android, backend, PostgreSQL, and TURN are separate trust zones.

## Milestone 1 controls

- Passwords are Argon2id hashes and login errors do not disclose account
  existence.
- Session and device tokens contain at least 32 random bytes; only SHA-256 hashes
  are stored. Authorization and cookie headers and sensitive body fields are
  redacted from logs.
- State-changing browser requests require the HttpOnly session cookie, matching
  CSRF cookie/header values, the stored CSRF hash, and the expected Origin when
  supplied.
- Household ownership is enforced in database queries. Public camera IDs do not
  grant access.
- Pairing codes provide 50 bits of entropy, expire after ten minutes, and are
  locked and consumed transactionally.
- Single-instance in-memory limits reduce guessing and abuse. They reset on
  restart and do not coordinate across replicas; distributed deployment requires
  shared rate-limit storage.
- Android credentials are encrypted using an Android Keystore-backed AES-GCM key.
  Revocation immediately prevents subsequent heartbeat authorization.
- Audit events record security outcomes but not passwords, tokens, credentials,
  cookies, or pairing codes.

## Milestone 2 streaming controls

- Viewer upgrades require the browser session, exact Origin, household ownership,
  and an active camera credential. Device upgrades require a non-revoked device
  credential.
- Rejected upgrades disclose no camera, household, or connection state.
- Signaling schemas cap SDP/ICE size and restrict messages by peer role.
- SDP, ICE, TURN credentials, cookies, and device credentials are not logged.
- One viewer is admitted per camera; an authorized reconnect replaces the prior
  viewer, while timeout and close cleanup limit stale state.
- Capture is activity-bound and visibly indicated. Android declares only camera
  and normal internet/network-state access; no microphone/audio exists.
- WebRTC media uses DTLS-SRTP. TURN sees endpoints, timing, and volume but relays
  encrypted packets. Beacon does not claim application-level end-to-end
  encryption.

## Residual risk and deferrals

TLS/WSS termination, short-lived TURN credentials, secret management,
distributed signaling and rate limiting, account recovery,
email verification, MFA, device attestation, credential rotation, audit retention,
and production operations require later design. Signaling is single-instance and
ends on backend restart. Local emulator HTTP is permitted only for `10.0.2.2`.
