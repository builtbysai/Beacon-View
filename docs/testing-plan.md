# Testing plan

`pnpm check` runs formatting, ESLint, strict TypeScript, backend and web tests,
and all TypeScript builds. Backend unit tests cover security primitives, rate
windows, and the exact presence boundary.

PostgreSQL integration suites run only when both `NODE_ENV=test` and a
dedicated `TEST_DATABASE_URL` are defined:

```powershell
docker exec beacon-secureview-local-postgres-1 createdb `
  -U beacon_local beacon_secureview_test
$env:NODE_ENV = 'test'
$env:TEST_DATABASE_URL = `
  'postgresql://beacon_local:local-development-only@127.0.0.1:5432/beacon_secureview_test'
$developmentDatabaseUrl = $env:DATABASE_URL
$env:DATABASE_URL = $env:TEST_DATABASE_URL
pnpm.cmd --filter @beacon/backend db:migrate
$env:DATABASE_URL = $developmentDatabaseUrl
pnpm.cmd --filter @beacon/backend test
```

The commands set `DATABASE_URL` to the dedicated test URL only for migration,
then restore the development URL before tests. The destructive helper rechecks the explicit
test marker, `_test` suffix, forbidden default/development names, and inequality
with `DATABASE_URL` immediately before every truncation. It prints only the
target host and database name.

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

The device-agnostic milestone adds migration coverage for default sources,
household-isolated source synchronization, stale producer replacement,
simultaneous browser-producer peers, stale reconnect cancellation, explicit
browser permission/registration, and duplicate Android retry prevention. Run
the manual matrices in
[`multi-viewer-testing.md`](multi-viewer-testing.md) and
[`browser-camera-mode.md`](browser-camera-mode.md).

Physical acceptance includes Android Wi-Fi loss for 15-30 seconds and automatic
recovery without restart or repair; Android and browser producers as distinct
devices; two webcams beneath one browser device; two independent viewers; a
background-tab warning; and repeated LAN startup with reuse/restart/quit.

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
