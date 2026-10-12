# Testing plan

Follow [testing-policy.md](testing-policy.md) before adding or maintaining tests. This file is the standing part of the
plan: how to run the checks, how to run the database suites, and what automated tests cannot prove and so needs a
person with a real device. Dated validation records used to live here; git history keeps them, and release evidence
goes in [oracle-cloud-staging.md](oracle-cloud-staging.md) or the pull request.

## Running the checks

`pnpm check` runs formatting, ESLint, strict TypeScript, the backend and web tests, and all TypeScript builds. Android
unit tests and lint run with Gradle (`apps/android-camera/gradlew.bat -p apps/android-camera :app:testDebugUnitTest
:app:lintDebug`). `pnpm exec node scripts/Test-BeaconResponsive.mjs` (add `BEACON_QA_AXE=1` for the accessibility
rules) is the viewport and accessibility audit ([responsive-audit.md](responsive-audit.md)).

Validate migration state with `db:check`, apply migrations to a clean local database with `db:migrate`, and inspect the
SQL. Validate Compose health and published ports separately. For Android also review the manifest for permissions
nobody approved.

## Database suites

The PostgreSQL integration suites run only when both `NODE_ENV=test` and a dedicated `TEST_DATABASE_URL` are set:

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

`DATABASE_URL` points at the test database only for the migration, then goes back. The destructive helper rechecks the
explicit test marker, the `_test` suffix, the forbidden default and development names, and that the URL differs from
`DATABASE_URL` immediately before every truncation, and it prints only the host and database name. Each suite truncates
only its own tables.

## What automated tests cover

Authentication, CSRF, session and credential lifecycle, pairing concurrency and reuse, household isolation and
authorization, signaling roles and cleanup, TURN credential expiry and production transport validation, retry and
backoff, privacy-mode rejection, motion and notification persistence, quiet hours, activity history queries, and the web
and Android presentation rules. They do not prove that a particular handset, browser, network or relay can render
video, hear audio or receive a push.

## Manual acceptance

Run these on real devices before a release that touches the area, and record the device, browser, network and time with
the result. The Android procedure and preflight are in
[physical-android-device-development.md](physical-android-device-development.md); the multi-viewer matrix is in
[multi-viewer-testing.md](multi-viewer-testing.md); browser capture is in [browser-camera-mode.md](browser-camera-mode.md).

**Media.** Direct and TURN-relayed playback (with `ICE_TRANSPORT_POLICY` both ways); Wi-Fi loss for 15 to 30 seconds
recovers without a restart or re-pairing; Android and browser producers as separate devices; two webcams under one
browser device; two independent viewers; a hidden-tab warning in Camera Mode.

**Privacy (Android).** Privacy on and off repeatedly with no process exit; camera and microphone indicators stop at
once and the foreground service keeps a valid declared type; interrupt connectivity while turning privacy on, restart
the process, restore connectivity and confirm only an authorized Resume restarts capture; resume while backgrounded
does not claim capture before a real frame and recovers in the foreground; repeat without microphone and notification
permission and with a late viewer.

**Permissions.** Revoking camera permission stops the service without a crash loop and relaunch asks again; revoking
microphone falls back to video only; revoking notification permission does not stop capture; none of this loses the
pairing.

**Switching.** Front and rear switching keeps the process stable, restores real frames after each change, and the
viewer renegotiates and shows the new picture.

**Audio.** Viewers start muted; Listen and Mute work and the camera's microphone indicator follows; denied microphone
falls back to video only; Talk is single-owner, plays intelligibly on the camera with no bad echo, and stops on Stop,
navigation, connection loss and privacy; opening Live View never asks for the microphone; direct and relayed.

**Motion and alerts.** False positives, CPU, temperature and battery on at least one older Android phone before motion
alerts are called release-ready; settings change on the phone, quiet-hours boundaries and a daylight-saving change;
phone alerts across Doze, denial, opt-out, sign-out, uninstall, token change, an installed PWA's subscription, brief
reconnect suppression and provider-invalid cleanup, and no provider identifier in logs or the database output.

**Recording and Drive.** Record, upload, play, retry, remove and the Drive file itself; reconnect after Drive access
expires.

**Activity and history.** Large histories, screen readers and a time-zone change.

**Web viewing.** Fullscreen, picture in picture and Cast across the supported browsers; a camera group with online,
offline and privacy cameras; revoking a camera grant while viewing; switching account or household tears down the
previous streams; the sleep timer while listening, talking, parked in picture in picture, during a manual recording and
across a suspend and wake; repeat the wall and live checks in the installed desktop app.

**Android app (ADR 0121).** Sign in with password and with Google; Add device starts the native camera; live view,
picture in picture (leave the app during a live view) and fullscreen; saving a clip or snapshot to Downloads; turning
phone alerts on shows the Android permission prompt and a real alert arrives; the update check offers a newer build.
