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
- Every viewer has an independently authorized connection ID. A viewer failure
  cannot terminate sibling viewers; timeout and close cleanup limit stale state.
- Capture is foreground-service-owned and visibly indicated. Android declares
  camera, microphone, foreground-service, and normal internet/network-state access.
  The notification distinguishes camera-only, camera-and-microphone, and privacy
  states; denied microphone permission leaves video usable.
- WebRTC media uses DTLS-SRTP. TURN sees endpoints, timing, and volume but relays
  encrypted packets. Beacon does not claim application-level end-to-end
  encryption.

## Milestone 3 transport and reliability controls

- Production requires HTTPS/WSS and exact browser Origin matching. Local HTTP is
  available only through an explicit non-production opt-in.
- Coturn credentials expire after at most ten minutes and are HMAC-derived from
  a server-held secret only after participant authorization. Clients cannot
  supply ICE URLs.
- Production rejects the documented local TURN secret and invalid or insecure
  transport configuration.
- Active sockets are periodically re-authorized; revoked sessions, ownership,
  and device credentials close signaling promptly.
- Retry budgets, generation checks, and lifecycle cleanup prevent endless retry,
  stale peer replacement, background capture, and orphaned signaling state.
- Structured diagnostics exclude credentials, SDP, raw candidates, private
  ownership identifiers, and raw exception details.
- Push identifiers and browser endpoints are encrypted with per-record data keys; a
  separate keyed fingerprint supports rotation without exposing provider material.
  Subscriptions are bound to an authenticated session, and delivery rechecks that the
  session remains active. Logout, session revocation, account deletion, opt-out, and
  permanent provider invalidation stop sends. Subscription request fields and provider
  responses are excluded from logs.
- Push is a hint, never authority. Payloads contain only an opaque event ID, category,
  and generic route. Fixed client copy excludes camera/household names, email, media,
  confidence, and access tokens; opening Beacon requires a fresh authorized fetch.
- Motion reports contain no media or pixel samples. The server binds each report to
  the authenticated device credential and exact camera source, rejects reports while
  privacy mode or the source is disabled, applies a cooldown, and timestamps accepted
  events itself.
- Viewer microphone capture is opt-in and is never requested by opening Live View. The
  server grants only one talk connection per camera, Android enables incoming audio only
  for the granted connection, and all cleanup paths release ownership and local tracks.

## Device-agnostic producer controls

- Household authorization is performed against the exact camera source and its
  non-revoked parent device; public device or camera IDs are not authority.
- Device credentials can synchronize only sources beneath their own device.
- Browser producer registration and signaling require the owner session, CSRF
  protection for registration, exact Origin, trusted HTTPS, and explicit browser
  permission.
- Browser installation and source identifiers are not authentication secrets.
- Producer replacement is deterministic, and stale socket closure cannot remove
  the replacement.
- Diagnostics expose only public identifiers and sanitized connection state.

## Desktop app controls (ADR 0082)

- The Electron window renders only the canonical Beacon origin. A single tested
  navigation policy sends other web links to the system browser and blocks
  every other scheme. Off-origin subframe navigation and `<webview>` are refused.
- Renderers are sandboxed and context-isolated with no Node integration. The
  preload exposes one frozen `beaconDesktop` object (capture state only), and
  the main process accepts it only from the Beacon origin's main frame.
- Web permissions are limited to camera/microphone, clipboard write, and
  fullscreen for the Beacon origin. Everything else is denied, and macOS adds
  TCC prompts.
- Packaged builds fuse off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and
  `--inspect`. They enable cookie encryption at rest, ASAR integrity, and
  ASAR-only loading.
- Google sign-in runs in the system browser. Its deep-link handoff code is
  single-use, expires after 10 minutes, and is bound to an RFC 7636 S256
  challenge whose verifier never leaves the app, so another app that claims
  `beaconsecureview://` cannot redeem an intercepted code. Any redemption
  attempt consumes the code. The exchange requires a JSON body plus
  `x-beacon-desktop: 1`, so cross-site forms cannot cause login CSRF.
- Camera Mode in a hidden window stays visible through a tray live indicator,
  a notification, and a quit confirmation.
- Residual risks:
  - Builds are unsigned and have no auto-update channel, so Electron/Chromium
    security fixes reach users only when they reinstall.
  - Handoff codes live in process memory.
  - A compromised Beacon origin would control the window exactly as it would
    control a browser tab.

## Residual risk and deferrals

Production secret management, CA lifecycle, TURN abuse controls and capacity,
distributed signaling and rate limiting, account recovery,
email verification, MFA, device attestation, credential rotation, audit retention,
and production operations require later design. Signaling is single-instance
and ends on backend restart. Local emulator HTTP is permitted only for
`10.0.2.2` in debug builds.
