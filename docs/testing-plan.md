# Testing plan

`pnpm check` runs formatting, ESLint, strict TypeScript, backend and web tests,
and all TypeScript builds. Backend unit tests cover security primitives, rate
windows, and the exact presence boundary.

PostgreSQL integration suites run when `TEST_DATABASE_URL` is defined:

```sh
TEST_DATABASE_URL=postgresql://... pnpm --filter @beacon/backend test
```

They cover normalized duplicate accounts, generic login errors, session expiry,
logout revocation, CSRF, transactional concurrent pairing, expired/invalid/reused
codes, heartbeat authorization, and credential revocation. Each suite truncates
only its designated test database tables.

Milestone 2 tests cover role-restricted messages, SDP/ICE forwarding, household
isolation, expired-session and revoked-device rejection, disconnect cleanup, and
deterministic negotiation timeout cleanup. Web tests cover the connecting state
and absence of recording controls. Android unit tests cover streaming-state
boundaries; the debug build validates CameraX/WebRTC integration.

Milestone 3 adds deterministic tests for Coturn HMAC credential expiry,
production transport validation, role/camera isolation, periodic revocation,
sanitized failure handling, retry exhaustion, exponential backoff, and stale
generation cancellation. Browser and Android retry tests inject deterministic
jitter rather than sleeping.

Automated tests do not prove a particular handset, browser, NAT, or relay can
render video. Run the manual direct and TURN-relayed matrix before release.
The PowerShell preflight and deterministic physical-device procedure are in
`docs/physical-android-device-development.md`.

Validate migration state with `db:check`, apply migrations to a clean local
database with `db:migrate`, and inspect the SQL. Validate Compose health and
published ports separately. Android validation runs `assembleDebug` and
`testDebugUnitTest`, followed by a manifest review for prohibited permissions.

Future milestones must add audio and privacy shutdown tests only when approved.
Audio remains explicitly outside Milestone 3.
