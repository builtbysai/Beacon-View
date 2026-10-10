# ADR 0108: Security hardening, first batch

- Status: Accepted. Implemented 2026-10-10 on `claude/audit-fixes-live-viewer`.
- Source: the October 2026 audit (`docs/full-audit-2026-10-09.md`). Finding ids
  (F1, V1, and so on) refer to that document.

## Decisions

- **F1, client address.** The backend trusts `X-Forwarded-For` only from the
  networks in `TRUSTED_PROXY_CIDRS`. Production Compose lists the private ranges
  Caddy connects from; local development lists none, so the socket address is
  the client. Rate limits and audit records therefore see the real visitor
  instead of one shared proxy address. Fastify's numeric `trustProxy` was tried
  first and did not read the header in the version used, so ranges are used.
- **V9, pairing limits.** Pairing attempts are limited by caller address (20 per
  15 minutes) and by the code being tried (10 per 15 minutes), never by the
  installation id the client chooses.
- **V3.** The fire-and-forget share-link view count handles its own failure, and
  the process logs a stray rejection instead of exiting.
- **V8.** Web Push endpoints must be on a browser push service (Google FCM,
  Mozilla, Apple, Windows Notification Service), HTTPS on port 443, without
  credentials. Stored endpoints that are not are marked permanent failures.
- **V19, V19b.** Nothing enrolls a camera from a link, QR code, file, installer
  or another app without a person agreeing first. The desktop app shows a native
  confirmation (Cancel by default) before it opens the setup page, enrolls the
  computer or turns on open-at-login. The Android app only fills in the pairing
  code; pairing is a tap. In a plain browser, a link carrying a code no longer
  starts setup by itself.
- **V1.** Android Google sign-in uses PKCE like desktop. The return link's code
  is bound to a challenge and cannot be redeemed without the verifier the app
  kept. A request from Android without a challenge is refused, so an Android app
  older than this change cannot sign in with Google until it is updated. Beacon
  is in private alpha, so the server and the app ship together.
- **V40.** The camera phone forgets its pairing only after at least three
  rejections spread over a minute or more with none accepted between. A 403 is
  never counted: it comes from something between the phone and Beacon.
- **F2.** Caddy sends HSTS (without subdomains, because other Beacon products
  share this VM), `nosniff`, `X-Frame-Options: DENY`, a referrer policy, a
  permissions policy that keeps the camera and microphone for this origin only,
  and a Content-Security-Policy in **report-only** mode. Enforce it once a pass
  through sign-in, live view, Camera Mode, Cast and recordings shows no console
  violations. Google Fonts remain allowed until the font is self-hosted (V12).
- **F3.** Coturn refuses relays to private, loopback, link-local and unique-local
  addresses, and limits relays and bandwidth per credential. The old
  `no-loopback-peers` line was removed because coturn 4.6.3 rejects it as a bad
  option (loopback is already refused by default).

## Not verified

- The TURN limits were checked only for configuration errors with the coturn
  image. An authenticated relay between two real devices has still not been
  proven (the audit's open item), and must be tried after deployment.
- The Android and desktop changes were built and unit tested, not run on a
  device or in the installed app.
- Nothing here has been deployed.
