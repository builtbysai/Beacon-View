# Local development

## Prerequisites

- Node.js 22.13+ (Node 22 only) and pnpm 11.9.0
- Docker with the Compose plugin
- JDK 17 or newer and Android SDK Platform 35, for the Android app (Android Studio's bundled JDK works)

`bash scripts/dev/verify-environment.sh` checks the tools, Docker access and the backend `.env` and says what is missing.

## Run it

```sh
pnpm install --frozen-lockfile
cp apps/backend/.env.example apps/backend/.env
docker compose -f infrastructure/docker/compose.yaml up -d
pnpm --filter @beacon/backend db:migrate
pnpm dev
```

The backend loads `apps/backend/.env` in development; real environment values win. It listens on `127.0.0.1:3000`
and the web viewer on `127.0.0.1:5173`. `DATABASE_URL` and a TURN shared secret of 32 bytes or more are required;
the example values are weak, loopback-only and must never be reused. Never commit a real `.env`.
`apps/backend/src/config.ts` is the authoritative list of settings, and `apps/backend/.env.example` and
`infrastructure/cloud/production.env.example` show them with comments.

Keys that encrypt stored data (recording keys, Drive tokens, push endpoints) are separate values; do not reuse one
for another. Application startup never applies migrations.

## Migrations

```sh
pnpm --filter @beacon/backend db:generate   # after changing src/db/schema.ts
pnpm --filter @beacon/backend db:migrate
pnpm --filter @beacon/backend db:check
```

Review generated SQL before committing it; migrations must be additive so a rollback can run on the new schema.
To reset only the local Compose database: `docker compose -f infrastructure/docker/compose.yaml down --volumes`,
then `up -d postgres` and migrate again. This deletes local data; never do it to a shared database.

## Checks

`pnpm check` runs formatting, ESLint, strict TypeScript, all tests and the builds. The database-backed backend
suites need a dedicated test database and run only when both `NODE_ENV=test` and `TEST_DATABASE_URL` are set; the
URL must differ from `DATABASE_URL`:

```sh
docker run -d --rm --name beacon-test-db -p 127.0.0.1:5544:5432 \
  -e POSTGRES_USER=beacon_ci -e POSTGRES_PASSWORD=ci-only-test-password \
  -e POSTGRES_DB=beacon_secureview_test postgres:17.6-alpine
export TEST_DATABASE_URL=postgresql://beacon_ci:ci-only-test-password@127.0.0.1:5544/beacon_secureview_test
export NODE_ENV=test
pnpm --filter @beacon/backend db:migrate   # with DATABASE_URL set to the same URL
pnpm --filter @beacon/backend test
```

Android: `apps/android-camera/gradlew.bat -p apps/android-camera :app:testDebugUnitTest :app:lintDebug`
(use `./gradlew` outside Windows). The [testing policy](testing-policy.md) governs what to test and how much.

## Android against local services

The Android app shows the web app inside the app (ADR 0121), so a local build needs both the backend and the web
viewer running (`pnpm dev`). The emulator reaches the host at `http://10.0.2.2:3000` (cleartext is allowed only for that
host). For the viewer
at `http://10.0.2.2:5173`, set `WEB_ORIGIN=http://10.0.2.2:5173` in the ignored `apps/backend/.env` and restart the
backend; the origin must match exactly or pairing fails the CSRF check. Debug builds take the viewer URL from
`-PbeaconWebUrl=` or `BEACON_WEB_URL`; release builds use `-PbeaconReleaseWebUrl=` or `BEACON_RELEASE_WEB_URL`.
Release signing and publishing are in [android-release.md](android-release.md) and
[release-procedure.md](release-procedure.md).

## HTTPS/WSS and a physical phone (Windows)

A phone needs trusted HTTPS/WSS and LAN-reachable STUN/TURN. The scripts in `scripts/` set that up; replace the
documentation address with your LAN address. Details are in
[physical-android-device-development.md](physical-android-device-development.md).

```powershell
.\scripts\Start-BeaconLanDev.ps1 -LanHost 192.0.2.10
.\scripts\Export-BeaconDevCertificate.ps1
.\scripts\Test-BeaconLanDev.ps1 -LanHost 192.0.2.10
.\scripts\Build-Install-BeaconAndroidDebug.ps1 -LanHost 192.0.2.10
.\scripts\Open-BeaconLanDev.ps1 -Page CameraMode   # opens the running LAN site (Dashboard or CameraMode)
.\scripts\Stop-BeaconLanDev.ps1
```

`-ReuseExisting`, `-RestartExisting`, `-Status` and `-NonInteractive` make repeat runs safe; the script only
stops processes it proved belong to this repository. State is in the gitignored `.beacon-dev/`. The checks report
physical-phone, real-webcam, multi-viewer and forced-relay media as manual: service reachability does not prove
media went through TURN. Record browser, handset, network and time with any manual result.

## Desktop app

`apps/desktop` is the Electron app (ADR 0082). Against your local viewer:

```sh
BEACON_DESKTOP_ORIGIN=http://127.0.0.1:5173 pnpm --filter @beacon/desktop dev
```

`node scripts/Test-BeaconDesktop.mjs` is the real-Electron smoke test. Packaging, signing and environment
variables are in [apps/desktop/README.md](../apps/desktop/README.md).

## Looking at the web app without a backend

`scripts/qa-fixtures.mjs` holds offline fixtures, and Playwright drives them:

- `node scripts/Capture-BeaconScreens.mjs [screen ...]` captures screens to `.beacon-dev/screens/` (see the
  script header for sizes and dark mode);
- `node scripts/Test-BeaconResponsive.mjs` is the viewport regression audit ([responsive-audit.md](responsive-audit.md)).

Both need `pnpm --filter @beacon/web-viewer dev` running and `BEACON_QA_URL` pointing at it (default ports differ
per script), use fixtures only, and create no accounts, streams or emails.
