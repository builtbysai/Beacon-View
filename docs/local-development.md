# Local development

## Prerequisites

Saved camera groups/wall layouts need no additional setup or migration. They use
browser storage scoped to the signed-in account and household; deleting browser
site data removes them, and a separate Electron profile has its own layouts.
Formatter/linter scans exclude nested `.claude/worktrees` checkouts so local
duplicate repositories are validated in their own checkout instead.

- Node.js 22.13+ (Node 22 only) and pnpm 11.9.0
- Docker with the Compose plugin
- JDK 17 and Android SDK Platform 35 for Android

## Startup

For the recommended one-command Windows workflow, run `.\Start-Beacon.ps1` from
the repository root. It installs dependencies, creates the local environment
when missing, starts Docker services, migrates PostgreSQL, starts secure LAN
development, and opens the dashboard. See
[`quick-start.md`](quick-start.md). The lower-level workflow is:

Pairing codes are displayed both as text and as a QR code. In the Android app,
choose **Scan and connect** to validate the same expiring, one-time code and
begin pairing immediately without a second confirmation. Opening the QR link
with an Android scanner has the same behavior. The QR code does not contain a
session or device credential.

```sh
pnpm install --frozen-lockfile
cp apps/backend/.env.example apps/backend/.env
docker compose -f infrastructure/docker/compose.yaml up -d
pnpm --filter @beacon/backend db:migrate
pnpm dev
```

The backend loads `apps/backend/.env` in development using `dotenv`; existing
process environment values take precedence. It listens on `127.0.0.1:3000`, and
the viewer on `127.0.0.1:5173`.

Backend variables include `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`,
`DATABASE_URL`, `WEB_ORIGIN`, `PUBLIC_BACKEND_ORIGIN`,
`SIGNALING_PUBLIC_URL`, `ALLOW_INSECURE_LOCAL_DEV`, `SESSION_COOKIE_NAME`,
role-specific viewer/device STUN and TURN UDP/TCP URLs,
`TURN_SHARED_SECRET`, `TURN_CREDENTIAL_TTL_SECONDS`, and
`ICE_TRANSPORT_POLICY`. `DATABASE_URL` and a 32-byte-or-longer TURN secret are
required. Local example values are not deployment credentials. Do not commit a
real `.env`.

Encrypted recording uploads additionally require `RECORDING_ENCRYPTION_KEY`: a
separate 32-byte base64url application key. The browser encrypts each clip with
a unique AES-GCM key before the direct Drive upload; the backend encrypts that
per-clip key before storing its metadata. Do not reuse the Drive-token or
notification keys. The Android camera uploader is deliberately blocked until
its own encryption implementation is available, so it cannot export plaintext.

## Migrations

Set `DATABASE_URL` or copy the example file, then use:

```sh
pnpm --filter @beacon/backend db:generate
pnpm --filter @beacon/backend db:migrate
pnpm --filter @beacon/backend db:check
```

Review generated SQL before committing it. Application startup never applies
migrations. To reset only the local Compose database, destroy its named volume
and recreate it:

```sh
docker compose -f infrastructure/docker/compose.yaml down --volumes
docker compose -f infrastructure/docker/compose.yaml up -d postgres
pnpm --filter @beacon/backend db:migrate
```

This permanently deletes local development database data; never use it for a
shared or production database.

## Android

The emulator uses `http://10.0.2.2:3000`. Cleartext is allowed only for that
emulator host; other cleartext destinations remain blocked. Browser ICE uses
`127.0.0.1`, while emulator ICE uses the host alias `10.0.2.2`.
For side-by-side emulator testing, open the viewer at `http://10.0.2.2:5173`
and set the ignored local `apps/backend/.env` value
`WEB_ORIGIN=http://10.0.2.2:5173`, then restart the backend. The origin must
match exactly or browser state changes, including pairing, fail CSRF checks.
The Android debug build uses that viewer URL for pairing and browser-camera
links; override it with `-PbeaconWebUrl=` or `BEACON_WEB_URL` when needed.
Release builds default the pairing-link origin to the HTTPS API origin; set
`-PbeaconReleaseWebUrl=` or `BEACON_RELEASE_WEB_URL` when the viewer has a
separate HTTPS origin.

```sh
apps\android-camera\gradlew.bat -p apps/android-camera :app:assembleDebug
apps\android-camera\gradlew.bat -p apps/android-camera :app:testDebugUnitTest
apps\android-camera\gradlew.bat -p apps/android-camera :app:lintDebug :app:assembleRelease
```

The full Windows validator includes Android lint and unsigned release compilation.
This does not provide a deployable release: production signing, versioning, a real
HTTPS API origin, and store acceptance remain separate requirements. CI uses the
same Android tasks and an isolated PostgreSQL test service. It applies migrations
explicitly before integration tests and never migrates at application startup.

The app requests camera, microphone, notification, and foreground-service permissions.
A visible foreground service keeps the registered device online and capture-ready when
the activity is closed. Denying microphone access leaves video-only Camera Mode usable.
The persistent notification distinguishes camera-only from camera-and-microphone
capture. Android privacy mode is modeled and backend-enforced and releases both media
sources immediately. Viewers start muted and require an explicit **Listen** action.
There is no recording or hidden capture. Household
settings now show up to 50 recent live-view, privacy, credential-revocation, and
camera-removal events; the response intentionally excludes network addresses,
signaling details, credentials, and media.

## Manual live-video check

1. Start PostgreSQL and Coturn, apply migrations, and run backend and viewer.
2. Pair the Android emulator, grant camera permission, and leave it visible.
3. Sign in as the owner, select the online camera, and choose **View live**.
4. Confirm Android preview/capture indicator, connected browser status, and video.
5. Confirm the viewer is silent until **Listen**, then verify **Mute** immediately stops
   playback.
6. Close the viewer and confirm only that viewer session ends while Camera Mode remains
   visibly ready.
7. Repeat with direct ICE and relay-only ICE when validating TURN.

## HTTPS/WSS and a physical phone

Use the repeatable Windows workflow in
[physical Android device development](physical-android-device-development.md):

```powershell
.\scripts\Start-BeaconLanDev.ps1 -LanHost 192.0.2.10
.\scripts\Export-BeaconDevCertificate.ps1
.\scripts\Test-BeaconLanDev.ps1 -LanHost 192.0.2.10
.\scripts\Build-Install-BeaconAndroidDebug.ps1 -LanHost 192.0.2.10
```

Replace the documentation address. The script configures strict Vite port 5173,
trusted HTTPS/WSS, exact origins, LAN-reachable STUN/TURN, and debug Android
endpoint injection while retaining localhost/emulator defaults.

Repeated startup is explicit and safe:

```powershell
.\scripts\Start-BeaconLanDev.ps1 -ReuseExisting -NonInteractive
.\scripts\Start-BeaconLanDev.ps1 -RestartExisting -NonInteractive
.\scripts\Start-BeaconLanDev.ps1 -Status
.\scripts\Open-BeaconLanDev.ps1 -Page Dashboard
.\scripts\Open-BeaconLanDev.ps1 -Page CameraMode
.\scripts\Stop-BeaconLanDev.ps1
```

Run the automated portion of Milestone 7 acceptance after LAN startup:

```powershell
.\scripts\Test-BeaconFunctionalMilestone.ps1 -LanHost 192.0.2.10
```

This intentionally reports physical Android, real webcam, multi-viewer, and
forced-relay media checks as manual; service reachability alone does not prove
that media traversed TURN.

When ports 3000 or 5173 are occupied, interactive startup offers reuse,
restart, or quit only for a process proven to belong to this repository. It
prints PID, executable, command line, and listener details for unrelated
processes and never terminates them. `.beacon-dev/lan-dev.json` records owned
PIDs, ports, URLs, commands, and logs; it is gitignored.

LAN surfaces are `https://LAN_HOST:8443/`, `/camera-mode`, `/health`, and
`wss://LAN_HOST:8443/api/signaling`.

## Physical-device validation checklist

Record browser, handset/Android, network, and time with the result:

1. Pair the phone through the non-loopback HTTPS backend and confirm WSS in
   browser developer tools.
2. Keep the Android streaming UI visible; confirm preview and advancing browser
   video for five minutes.
3. With `ICE_TRANSPORT_POLICY=all`, record a direct host or server-reflexive
   candidate when the network permits.
4. Restart with `ICE_TRANSPORT_POLICY=relay`; confirm a relay candidate and
   advancing video through Coturn.
5. Disable phone Wi-Fi for 15-30 seconds, restore it, and verify
   `offline` -> `reconnecting` -> `online/idle` recovery. Confirm live video
   resumes without Stop Camera, Start Camera, or re-pairing.
6. Close the browser and verify viewer teardown; leave the Android streaming
   screen and verify camera release.
7. Revoke the device credential and verify new signaling and TURN issuance stop.
8. Inspect backend, browser, Android, and Coturn logs for secrets, SDP, raw ICE
   candidates, crashes, and restart loops.

Record physical-device evidence before claiming completion.

Local PostgreSQL, Coturn, and their deliberately weak example credentials are
loopback-only. Never reuse those credentials outside an isolated developer
machine.

## Desktop app

`apps/desktop` is the Electron desktop app (ADR 0082). `pnpm install` downloads the
Electron runtime. To run it against your local web viewer:

```bash
BEACON_DESKTOP_ORIGIN=http://127.0.0.1:5173 pnpm --filter @beacon/desktop dev
```

The real-Electron smoke test is `node scripts/Test-BeaconDesktop.mjs`. It runs against a
fixture-only local viewer. Packaging, signing, and environment variables are in
[apps/desktop/README.md](../apps/desktop/README.md).

## Web viewport regression audit

Run the local, fixture-only browser audit documented in [responsive-audit.md](responsive-audit.md)
after shell, form, navigation or layout changes. Screenshots and measurements are stored
under ignored `.beacon-dev/responsive-audit/`. It requires Playwright with an installed
browser; the Codex bundled runtime can be supplied through `BEACON_PLAYWRIGHT_MODULE`.
It creates no real accounts, streams, emails or production data.

## Activity filter preferences

Activity camera/time/date preferences are local and scoped to the signed-in
account and selected household (ADR 0100). Existing account-only preferences are
not migrated; the first visit uses all cameras and the last 24 hours. No backend
migration or environment change is needed. Since date uses the viewer's local
midnight. Text search and event kinds filter loaded pages; Load more extends them.

## Motion-alert snooze

Apply migration 0037 before running the updated backend. Web/desktop notification
settings offer personal 15/30/60-minute motion snooze and early resume. The server
enforces deadlines while the viewer is closed; no timer worker or extra environment
variable is required. Existing Android preference updates preserve the deadline.
Native Android snooze controls are outside this milestone. See ADR 0101.

## Connection troubleshooting report

The existing manager-only Connection details page now builds an allowlisted
local report with preview and clipboard copy (ADR 0102). No API migration or
environment change is required. Clipboard availability depends on browser/OS
permission; the readonly preview supports manual copy. Reports contain status
snapshots, not media connectivity or notification-delivery evidence.

## Setup health checks and clip bookmarks

No additional services, migrations, or environment variables are required for
these two features. In Connection details, choose **Check setup** to read existing
authenticated connection, Drive, and personal alert preference status. Permissions
must be reviewed on the camera device; media and delivery require deliberate
manual tests. Failed services remain unknown. Leaving the household-scoped page
cancels pending checks.

In Clips, bookmark a clip and enable **Bookmarked only**. Bookmarks save only IDs
under an account/household-specific browser key. Reload to verify persistence;
switch accounts/households to verify separation. Check blocked browser storage
and deletion/retention: bookmarks must never restore inaccessible clips. Load more
searches older authorized pages. Existing playback and deletion permissions still
apply. The [testing policy](testing-policy.md) governs new tests and maintenance.
