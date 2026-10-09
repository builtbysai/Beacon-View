# Testing plan

## Governing testing policy

Follow [testing-policy.md](testing-policy.md) before adding or maintaining tests.
The historical validation records below are evidence logs, not coverage targets.

`pnpm check` runs formatting, ESLint, strict TypeScript, backend and web tests,
and all TypeScript builds. Backend unit tests cover security primitives, rate
windows, and the exact presence boundary.

On Windows, `.\Test-Beacon.ps1` is the complete local entry point. It runs
`pnpm check`, creates and migrates the dedicated `beacon_secureview_test`
database, runs integration tests with the existing destructive-target guards,
then runs Android unit tests and `assembleDebug`. Use `-SkipAndroid` or
`-SkipDatabaseIntegration` only when that environment is intentionally
unavailable.

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

Privacy-mode store and signaling tests verify that new viewers are rejected,
active viewers are closed, the control socket remains available, and the device
credential remains valid. Physical Android acceptance must additionally confirm
that CameraX and its audio source release immediately. One-way audio acceptance
must verify muted-by-default viewers, explicit Listen/Mute behavior, microphone
denial falling back to video-only, and direct and TURN-relayed playback.

On Android 14 and newer, physical privacy acceptance must also repeat privacy
on/off transitions without a Java or native process exit, verify that the foreground
service retains a valid declared type while actual camera/microphone operations stop,
and exercise privacy resume while Beacon is backgrounded. Background resume must not
claim capture before a real frame; returning Beacon to the foreground must retry and
restore capture without re-pairing. Front/rear switching must keep the process stable
and restore real frame delivery after each source change.

Motion-event tests must cover the first-frame baseline, small-noise rejection,
meaningful scene-change detection, device cooldown, server cooldown, credential/source
authorization, household isolation, and privacy-mode rejection. Physical acceptance
must profile false positives, CPU, temperature, and battery impact on at least one older
supported Android device before motion alerts can be considered release-ready.
Per-camera settings tests must also cover supported-value validation, household-scoped
owner changes with CSRF, stale device reads, disabled-source suppression, preserved
settings across source synchronization, each cooldown boundary, failed-save retry, and
analysis reset when sensitivity changes.
The connected physical Pixel must also retrieve the current settings over the trusted
LAN endpoint after an update install; that validates authenticated device sync but does
not substitute for a household-owner change or false-positive acceptance run.

Two-way talk automation verifies single-owner arbitration, busy rejection, and lock
release on disconnect. Browser acceptance must verify that opening Live View does not
request microphone permission and that Stop talking, navigation, connection loss, and
privacy mode stop the local microphone indicator. Physical acceptance must verify the
camera-side tones, intelligible speaker output, echo behavior, TURN relay, and recovery
after network interruption.

Web Live View regression coverage also checks that the fullscreen target contains
Listen and Talk controls, fullscreen rejection is explained, playback rejection
restores mute, privacy prevents a new signaling connection, source changes are
serialized, failed source requests preserve selection, and local TURN candidates are
reported as relayed. Stats-read failures must not interrupt the video connection.
Fullscreen interaction across actual supported browsers remains manual acceptance.

Android privacy tests cover a failed local pause without automatic capture restart,
pending intent restored after service recreation, failed Resume, stale startup and
HTTP responses, and repeated actions. Motion reports suppressed by privacy return
409 while retaining valid pairing; revoked credentials still fail authentication.
Physical acceptance must interrupt connectivity while turning privacy on, verify both
camera/microphone indicators stop, restart the process, restore connectivity, and
confirm only an authorized Resume restarts capture. Repeat without microphone and
notification permission and with a late viewer connection.

September 25, 2026 partial N1 evidence — Pixel 7a `34171JEHN07672`, Android 16,
production-targeted debug build from `codex/android-signed-in-camera-setup`, open
`amzn-internet` Wi-Fi after captive-portal validation. Signed-in setup created and
consumed the existing one-time pairing code and entered visible Camera mode. With
Wi-Fi disabled, local **Pause** immediately showed `PRIVACY ON`, CameraX disconnected,
`dumpsys media.camera` reported no active client, and the foreground-service type
dropped from camera+microphone (`0xC0`) to camera-only (`0x40`). A process stop and
restart while offline stayed paused with no camera client. Restoring Wi-Fi produced a
validated network, synchronized the pending privacy state, and did not resume capture.
An explicit **Resume** reopened CameraX. Six consecutive front/rear switches alternated
camera IDs without an app exception or stuck state, and backgrounding the Activity kept
the declared foreground service and camera client active. Pixel camera HAL TNR/flush
warnings occurred during intentional source teardown; Beacon logged no fatal or
CameraX exception. Still open: repeat privacy with an active Listen viewer so a real
microphone source is released, verify remote frame delivery after every switch, late
viewer rejection, denied microphone/notification permissions, and the remaining N2
audio/TURN matrix.

September 25, 2026 permission-recovery follow-up — while Camera mode was active,
revoking microphone permission caused Android to recreate Beacon in video-only mode.
The foreground-service type changed from camera+microphone (`0xC0`) to camera-only
(`0x40`), CameraX remained active, and `appops` reported no active microphone use.
Revoking notification permission during active capture did not interrupt the
foreground service or camera. After a forced cold restart with notification
permission still denied, Beacon failed closed: no camera service and no camera
client started. Restoring both permissions and relaunching recovered the declared
camera+microphone foreground service and CameraX without clearing the account,
pairing, or settings; no Android runtime fatal was logged. The in-app denied-state
tap-through still requires an unlocked denied-permission state.

September 25, 2026 unlocked privacy-control follow-up — from active Camera mode,
tapping **Pause** immediately rendered `PRIVACY ON` and **Resume**, disconnected the
Pixel camera client, and reduced the foreground-service type from camera+microphone
(`0xC0`) to camera-only (`0x40`). Tapping **Resume** restored the preview, Online
state, active camera client, and `0xC0` service type. No fatal Android or CameraX
exception was logged. This closes the local privacy tap-through; microphone release
with an active remote Listen session remains open.

September 26, 2026 camera-permission-denial recovery — Pixel 7a `34171JEHN07672`,
production-targeted debug build from `codex/android-privacy-evidence`. While Camera
mode was active with a real capture client, `pm revoke android.permission.CAMERA`
killed the process as expected; the restarted `CameraForegroundService` detected the
missing permission in `onCreate()`, set `Disabled`/"Camera permission is required",
and called `stopSelf()` before declaring a camera foreground-service type. No
`SecurityException` or other fatal exception was logged, `dumpsys activity services`
showed no service and no crash-restart loop, and `onStartCommand` returned
`START_NOT_STICKY` while permission remained absent. Relaunching `MainActivity`
presented the system permission request (`GrantPermissionsActivity`); granting camera
access through that normal UI brought the service back as an active foreground camera
client with a live preview, without re-pairing. This closes the camera-denied flow
gap that blocked PR #66.

September 26, 2026 pairing-link and build-configuration fixes, found during the
recovery test above — two independent problems surfaced while re-pairing the same
Pixel after its app data was cleared:

1. Android's `parsePairingQr` only accepted the original `/pair` path. ADR 0067
   (2026-09-24) added a second valid link shape, `/camera-mode/setup?code=...`, and
   updated the web app's own scanner (`pairingCodeFromScan`) to accept both, but never
   updated Android, which rejected the newer link with "That is not a Beacon setup
   link." Fixed by accepting both paths on the trusted host; `PairingQrTest` covers
   the newly-accepted path and confirms an arbitrary third path is still rejected.
2. A debug APK built without explicitly exporting `BEACON_API_URL` silently compiles
   against the emulator-only `http://10.0.2.2:3000` default (see
   [physical-android-device-development.md](physical-android-device-development.md)),
   which is unreachable from a physical device and explained the remaining sign-in and
   "cannot reach your account" failures independent of the path bug above.

September 26, 2026 live two-device viewer evidence (N1/N2/U-checklist follow-up,
`builtbysai/Beacon-SecureView#21`) -- Pixel 7a `34171JEHN07672` as the camera, a
signed-in Chrome session as the viewer, against production `beacon.builtbysai.com`
after deploying `392bd7b`. Beyond UI state, device-side ground truth was checked
directly. Listen: `adb shell appops get ... RECORD_AUDIO` showed `allow ...
(running)` on the Pixel continuously while Listen was enabled from the viewer.
Talk: `adb shell dumpsys audio` showed a real `AudioTrack`
(`usage=USAGE_VOICE_COMMUNICATION`, `content=CONTENT_TYPE_SPEECH`, 48kHz,
`state:started`) on the Beacon process while speaking from the viewer. Camera
source switching produced a genuine `CONNECTING` -> `LIVE` renegotiation and real
new frames after switching back; one intermediate source showed a black frame,
most likely the covered/misdirected rear lens rather than a software fault, not
confirmed either way. The browser's "1 other viewer" count matched the Pixel's
own on-device viewer badge during the switch. An interrupted connection recovered
automatically ("Beacon is retrying - attempt 1" then `LIVE`) without a repair
action. Still open: after ending Talk, `dumpsys audio` still showed the
`AudioTrack` in `state:started` several seconds later -- not a privacy issue
since this is speaker output rather than microphone capture, but worth checking
whether `TalkSession.stop()` and its Android-side counterpart fully tear down the
audio sink. Recording/Drive states as seen by a viewer and Browser Camera Mode's
own states remain open per the roadmap.

September 26, 2026 smart-detection real-device verification (ADR 0074/0075) --
Pixel 7a `34171JEHN07672`, debug build with `SMART_DETECTION_ENABLED=true` (the
production default remains off; this flag exists only for controlled test
builds). `downloadSmartDetectionModel` fetched and checksum-verified
`efficientdet_lite0.tflite` at build time; the app loaded it and ran real
MediaPipe inference roughly once per second with zero crashes across a
multi-minute session. With the camera facing an empty wall/ceiling it correctly
reported no detections. With the owner standing in frame, it reported real,
sustained `person` detections for about 19 consecutive cycles at confidence
0.55-0.89. `top` showed the process using roughly 1.5 CPU cores and
`dumpsys battery` reported 43.6C during this window -- a preliminary signal
only, not the dedicated thermal/battery/false-positive study roadmap N9 still
requires. The Pixel was reinstalled with the flag-off build afterward; the
experiment is not left running on it.

With both fixed and `BEACON_API_URL=https://beacon.builtbysai.com` set explicitly,
scanning a freshly generated production pairing code completed a real pairing: the
Pixel reached an active `CameraForegroundService`, front-camera preview rendered a
real room image, and Pause/flip controls worked, confirmed by screenshot and
`dumpsys`/logcat with no fatal exception.

September 25, 2026 recording diagnosis — Chrome manually recorded two Android
camera clips. PostgreSQL retained valid encrypted upload metadata for both:
460,095 bytes / 2,740 ms and 488,949 bytes / 2,808 ms. Recording creation returned
202 and each Drive session returned 201, followed by the browser's explicit
upload-failure transition without a completion request. This proves capture and
local encryption completed and isolates the failure to the cross-origin Drive
PUT. The owner session initiation now sends Beacon's configured web origin;
repeat upload, playback, retry, removal, and Drive-file verification after deploy.

Activity regression tests cover server-side camera/time filters, household isolation,
bounded cursor validation, more than 100 rows, equal timestamps, and PostgreSQL
microsecond precision. Web tests cover day grouping, source-camera navigation,
older-page retries, late responses after filter changes, storage denial, explicit
refresh for incoming activity, and invalidation on household history deletion.
Manual acceptance must still check large histories, screen readers, and timezone
changes. Automatic retention remains a separate readiness requirement.

Milestone 8 web coverage includes authentication and empty states, pairing
completion, device detail, Live View connection state, Browser Camera Mode,
source handoff, and responsive design contracts. Milestone 9 adds workspace
creation/switching, grid layouts, reported health, platform filtering, drag and
keyboard ordering, tile-local source switching, expanded-tile Escape behavior,
and hidden-tab suspension. Real multi-camera capacity and cross-network media
still require manual acceptance.

Quiet-hours coverage validates strict `HH:mm` and IANA time-zone input, midnight
intervals, daylight-saving behavior, owner and device reads, server-side insertion
suppression, and Android detector reset while quiet. Manual acceptance must change a
physical phone's settings and verify that metadata pauses while live viewing remains
available, including an interval boundary and a daylight-saving transition where
applicable.

Notification transport coverage validates 32-byte key configuration, randomized
AES-GCM envelope encryption, tamper failure, provider fingerprint idempotency, default-off
preferences, session-bound revocation, atomic motion event/outbox creation, the exact
90-second presence plus 120-second offline threshold, single offline/recovery transitions,
and permission prompts only after user action. PostgreSQL cases require the dedicated
`*_test` database. Physical acceptance must cover current Android FID registration,
Doze/background delivery, denial, opt-out, logout, uninstall, FID rotation, installed-PWA
subscription lifecycle, quiet hours, brief reconnect suppression, and real provider-invalid
cleanup. Inspect database/log output to prove provider identifiers and payload details are
not exposed.

On September 12, 2026, `pnpm check`, Drizzle migration validation, clean and repeated
migration execution, cloud Compose configuration validation, and Android
`testDebugUnitTest lintDebug assembleDebug` passed locally. All 118 backend tests passed
against a dedicated PostgreSQL 18 `beacon_secureview_test` database, including the 37
PostgreSQL-backed cases and notification persistence. Docker Desktop was unavailable, so
the database ran in the local Ubuntu WSL environment and was stopped after validation.

On September 22, 2026, the frontend/backend integration candidate passed Prettier,
ESLint, web and backend typechecks, both production builds, all 178 web tests, and
all 211 backend tests against a freshly migrated dedicated
`beacon_secureview_test` database. All 27 migrations applied successfully. A
web/PWA smoke pass covered 390x844, 768x1024, and 1440x900 layouts, a clean browser
console with the local backend, the linked standalone manifest, all five manifest
icons, and the service worker. Android was outside that integration pass because
the candidate did not change its request/response contract.

## Saved camera groups and wall layouts — October 9, 2026

ADR 0098 adds local browser/desktop wall preferences. The full web suite passed
341 tests across 68 files, including six saved-layout tests. Workspace typechecks
and builds passed. Lint passed after excluding duplicate nested Claude worktrees;
formatting was rechecked after removing the temporary preview harness. Vite emits
a bundle-size warning; no new dependency was introduced.

An isolated development browser preview used three fictional offline cameras.
The actual editor was exercised at 390×844 and 1280×800: create, reorder, save,
reopen/edit, and named selection worked. At narrow width the document content
width matched its client width (375px after the scrollbar), with no horizontal
page overflow. This proves UI behavior with fixtures, not live WebRTC or installed
Electron acceptance. Temporary preview HTML/server were removed/stopped.

Still required on real fixtures: load a group with online/offline/privacy cameras,
change lenses, revoke a camera grant while viewing, stop/change Announce groups,
and confirm account/household switching tears down prior streams. Repeat in the
installed desktop app. Layouts stay local to the browser profile and do not sync.

## Live-view sleep timer — October 9, 2026

ADR 0099 adds Off/15/30/60-minute viewing deadlines. The final web suite passed
347 tests across 69 files, including hook deadline/cancel/replace/wake/reset
coverage, live socket/peer teardown with explicit resume, and disabling active
PiP. Browser preview at 390×844 and 1280×800 confirmed the selected timer and
countdown remain usable without horizontal overflow. The preview used a fictional
camera and stub signaling, so it did not prove real capture, Talk, PiP or Cast.
Temporary preview files/server were removed/stopped.

Device acceptance still required: arm a timer while listening/talking, confirm
microphone and viewer-count release, expire while parked in PiP, expire during a
manual recording, stop a real Cast session, and suspend/wake the browser. Camera
privacy/capture configuration must remain unchanged. A suspended page executes
teardown only when the browser schedules it again; do not describe this as an
unattended camera shutdown guarantee. Native Android timer is not included.

## Activity date filters and search scope — October 9, 2026

The final web suite passed 353 tests across 70 files. Workspace lint, formatting,
typechecks, and production builds passed. Vite's existing large-chunk warning
remains; no new dependency was added.

ADR 0100 adds 30-day and Since date filters, reset, camera/source labels, and
loaded-page search guidance. Coverage validates local-midnight conversion,
invalid dates, exact query continuity across both histories and pagination,
trimmed search with a next-page match, reset, and discarding household responses
and closing details when household activity eligibility is removed. Existing
tests retain abort/retry, clip labels, refresh, and deletion behavior.

An isolated browser preview at 390×844 and 1280×800 exercised Since date, a
search with zero loaded matches, Load more finding the next-page match, and
reset. Neither viewport had horizontal overflow. Fictional event fixtures were
used; this is UI evidence, not production-history or installed-Electron
acceptance. Temporary preview HTML and server were removed/stopped.

Repeat with real authorized histories: date-boundary events in multiple
timezones, expired retention, mixed motion/household pagination, account and
household switching, and permission revocation. Search and sorting cover loaded
pages; server-side text search and an end-date bound remain out of scope.

## Personal motion-alert snooze — October 9, 2026

ADR 0101 introduces migration 0037 and manager-only, CSRF-protected personal
15/30/60-minute motion snooze with early resume. The clean PostgreSQL 18 test
database applied all 38 migrations, accepted a repeated migration run, and
passed verification of 164 additive schema objects and the migration journal.
All 309 backend tests passed with the dedicated database, including snooze
expiry, metadata preservation, quiet-hour preservation through ordinary edits,
foreign/revoked camera rejection, another manager's independent delivery,
security delivery, queued-alert discard, and prevention of retry resurrection.
Route tests cover allowed durations, strict bodies, session/role checks, and CSRF.

Web tests cover snooze/resume autosave, confirmed-state rollback after failure,
and wake/focus expiry without changing the motion-enabled flag. All 356 web
tests passed across 70 files. Workspace lint, formatting, typechecks, and production builds passed;
Vite's existing large-chunk warning remains. An isolated
browser preview with a fictional camera passed at 390×844 and 1280×800, including
early resume, extension, unchanged quiet hours, and no horizontal overflow.
Temporary preview files/server were removed/stopped. These are fixture checks,
not evidence of real FCM/Web Push/Electron delivery.

Before release, apply migration 0037 and test real-channel snooze, browser closure,
early resume, mixed quiet hours/Home mode, multiple managers, clock differences,
household switching, and expiry during a provider retry. Already claimed delivery
batches or provider-accepted alerts may still arrive. Snooze must never stop
camera capture, remove event history, or silence problem/security categories.
Android preferences preserve snooze but native snooze controls are not included.

The temporary dedicated test database and role were dropped, its isolated
PostgreSQL cluster was stopped, and the temporary credential script was removed.

## Connection help and sanitized report — October 9, 2026

The full web suite passed 362 tests across 71 files; the final focused report/view
suite passed eight tests. Workspace lint, formatting, typechecks, and production builds
passed. Vite's existing large-chunk warning remains. No backend schema or behavior
changed in this milestone.

ADR 0102 improves the existing manager-only Connection details page with refresh,
snapshot time, practical device guidance, and local report preview/copy. Tests
cover omission of identifiers/raw times/arbitrary extra fields, unexpected string
values and viewer counts, missing/invalid/future heartbeat times, partial failure,
successful copy, clipboard denial/manual fallback, refresh, and request abort on
unmount. Account/household/role changes remount the view.

A fictional local browser fixture passed at 390×844 and 1280×900 with no horizontal
overflow. Preview, copy, and refresh were exercised. No real household information
was copied. Temporary preview HTML/server were removed/stopped. This does not
prove media connectivity, TURN fallback, or real notification delivery.

Before release, repeat in the installed desktop app and supported mobile browsers,
including clipboard denial, scoped-account switching, partial backend failure,
and invalid viewer/device clocks. The report is a point-in-time backend snapshot;
it intentionally omits identifying context and never uploads itself.

## Convenience completion and testing policy — October 9, 2026

Setup health checks (ADR 0103) and local clip bookmarks (ADR 0104) complete the
currently approved convenience implementation queue. All changes remain local
and undeployed on `codex/saved-camera-layouts`.

Added setup workflow coverage for partial status failure without automatic capture
and aborting requests on unmount. Extended the existing clip-library workflow
suite for account/household storage separation, persistence, loaded-page filtering,
authorized disappearance, and corrupt/blocked storage recovery. The tests use real
components and the request helper with fictional HTTP responses; they do not prove
server authorization. Existing playback-resource and deletion-permission tests
were retained because they protect meaningful lifecycle and access behavior.
No tests were deleted or merged; nearby tests were reviewed and remain useful.
Existing test cleanup now resets local storage and restores storage spies so
bookmark scenarios cannot contaminate other workflows. No separate tests were
added for constants, copy, or simple rendering.

The full web suite passed, followed by the affected setup/bookmark suites after
final fixture and storage-bound changes. Workspace lint, formatting, typechecks,
production builds, and diff whitespace checks passed. Initial lint failures in
test fixture typing were corrected. Vite's existing large-chunk warning remains.
Backend and Android code were unchanged by these two milestones; earlier snooze
database validation remains recorded above.

Browser review used a temporary local fixture with fictional connection, Drive,
alert and clip data at 390×844 and 1280×900. Check setup, bookmark/filter, and reload
persistence were exercised with no horizontal overflow. The fixture/server were
removed/stopped and the viewport reset. Real capture, remote permissions, alert
delivery, encrypted recording round trips, installed desktop and physical Android
acceptance still require device validation. Nothing was recorded or uploaded.

The owner testing policy is now a repository requirement in AGENTS.md and
[testing-policy.md](testing-policy.md). Future changes must search existing coverage,
identify realistic regressions, choose the strongest useful boundary, review
nearby tests, and report validation without count or coverage targets.

## Release CI schedule recovery — October 9, 2026

The first PR release validation failed in the existing weekly Home/Away schedule
workflow, after the schedule switch was clicked but before Save schedule appeared.
The editor's initial passive synchronization could overwrite the newly enabled
draft. Initial state already matches the saved schedule, so synchronization now
only resets the draft when the saved server value changes. The existing workflow
test is retained; no additional tiny unit test or weakened assertion was added.
The first run's database, schema, migration-rerun, secret-scan and SBOM checks passed.
The next release run passed the schedule workflow but exposed a test timing race
in snooze expiry: it dispatched focus before the async-loaded preference row's
effect registered the listener. That existing test now awaits the asynchronous
React mount before focus; expiry, preference preservation, and no-mutation
assertions are unchanged. No notification behavior or security boundary changed.
