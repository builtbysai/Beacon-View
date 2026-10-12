# Beacon View full audit — October 9, 2026

Scope: **Beacon View only** (`C:\Dev\Beacon-SecureView`, all branches). Beacon
Remote was audited earlier in this session and is deliberately excluded from this
document. This extends [code-review-findings-2026-10-09.md](code-review-findings-2026-10-09.md),
whose findings **F1–F13** still stand. The index in section 3 lists every open
finding in one place.

**The audit itself changed no code.** Fixes began on October 10, 2026 on branch
`claude/audit-fixes-live-viewer` (cut from `origin/main` `c42c277`); section 0 says
what is fixed, with the commit, and what is not. The rest of this document is the
audit as written, so a fixed finding still reads as it did.

Severity: **High** fix before wider release; **Medium** fix soon; **Low** improve.
Status: **Confirmed** = read in code/config; **Verify** = plausible, needs a runtime
check before acting.

## 0. Fix status (October 10, 2026)

Everything below is merged to `main`. The first batch (PRs #99, #100) and the owner-decision batch (#102, deployed with migration 0038) are live on the Oracle VM; later rows say where they stand. Original branch name: `claude/audit-fixes-live-viewer`. "Verified"
below means the stated test or build ran here; no fix has been run on a device, in the installed desktop
app, or in production.

| Finding                                                                        | Status                                                                                                                                                                                                                                                                                                                                                              | How it was verified                                                                                             | Commit                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| V19 desktop enrollment                                                         | **Fixed.** Native confirmation (Cancel by default) before a link, file or installer enrolls the camera or enables open-at-login; a code link no longer auto-starts in a plain browser                                                                                                                                                                               | desktop and web tests, red then green                                                                           | 579f2c2                                  |
| V19b Android pairing                                                           | **Fixed.** A link or QR code only fills in the code; pairing needs a tap                                                                                                                                                                                                                                                                                            | compiles, unit tests, lint; not run on a device                                                                 | b31a9e3                                  |
| V1 Android PKCE                                                                | **Fixed.** Challenge and verifier like desktop; Android sign-in without a challenge is refused (needs the app and server released together)                                                                                                                                                                                                                         | backend integration tests, Android unit test of the RFC 7636 vector                                             | b31a9e3                                  |
| V40 credential erase                                                           | **Fixed.** Cleared only after three rejections over at least a minute; a 403 never counts                                                                                                                                                                                                                                                                           | Android unit tests                                                                                              | b31a9e3                                  |
| F1, V9 client address, pairing limits                                          | **Fixed.** `TRUSTED_PROXY_CIDRS`; pairing limited by address and code                                                                                                                                                                                                                                                                                               | backend tests, red then green                                                                                   | fd35699                                  |
| V3 floating promise                                                            | **Fixed** with a process-level rejection logger                                                                                                                                                                                                                                                                                                                     | integration test, red then green                                                                                | fd35699                                  |
| V8 push endpoint                                                               | **Fixed.** Browser push services only                                                                                                                                                                                                                                                                                                                               | unit test                                                                                                       | fd35699                                  |
| F2 security headers                                                            | **Fixed in config, CSP report-only.** Enforce after a console pass                                                                                                                                                                                                                                                                                                  | Caddy validates the file                                                                                        | 2f30967                                  |
| F3 TURN                                                                        | **Fixed and proven (ADR 0114).** View owns its relay (pinned image, repository entrypoint, hardened config, new secret). Private addresses are refused, relay-to-relay sessions work, the owner confirmed live views over different networks                                                                                                                        | local rehearsal; live probe on the server; owner test                                                           | #114, #115, deployed                     |
| V4, V5 sessions                                                                | **Fixed.** No write per read; hourly purge                                                                                                                                                                                                                                                                                                                          | integration tests                                                                                               | afbb7de                                  |
| V20 viewer caps                                                                | **Fixed.** Eight viewers per camera, message-rate and size limits                                                                                                                                                                                                                                                                                                   | unit tests                                                                                                      | afbb7de                                  |
| V67 close codes, V66 polling                                                   | **Fixed.** Android answers close frames; offline camera closes 4004; poll every 5 s                                                                                                                                                                                                                                                                                 | backend tests; Android compiles and passes unit tests                                                           | 1dcf969                                  |
| V68 monitoring                                                                 | **Fixed.** Disabled or never-run backups reported, daily repeat, safe JSON, web container watched                                                                                                                                                                                                                                                                   | script test, shellcheck                                                                                         | 1dcf969                                  |
| V23, V31, V10                                                                  | **Fixed.** Email timeout and non-blocking reset mail; recording key in the env template; deploy workflow needs `BEACON_AUTO_DEPLOY`                                                                                                                                                                                                                                 | tests                                                                                                           | 1dcf969                                  |
| V29 reconnect, and the unreachable Reconnect button                            | **Fixed.** Keeps retrying at a bounded pace; Reconnect shows whenever the stream is down                                                                                                                                                                                                                                                                            | web tests, red then green                                                                                       | 3158ce3                                  |
| V69 reset message                                                              | **Fixed**                                                                                                                                                                                                                                                                                                                                                           | web tests                                                                                                       | 3158ce3                                  |
| V59, V44, V78 clips and cache                                                  | **Fixed.** Upload steps retried; separate cache prefixes; stale files swept                                                                                                                                                                                                                                                                                         | Android unit tests                                                                                              | 82fe8c7                                  |
| V42 Drive files on delete                                                      | **Fixed for account deletion.** Clip and thumbnail files removed before the Drive token is revoked; retention and ownership transfer remain                                                                                                                                                                                                                         | integration test                                                                                                | 82fe8c7                                  |
| F4 container                                                                   | **Fixed.** Runs as `node`; migrate, schema check and server were run in the built image                                                                                                                                                                                                                                                                             | image run against a database                                                                                    | fddab44                                  |
| V16 dependencies                                                               | **Fixed for production.** Fastify 5.12.5; `pnpm audit --prod` is clean                                                                                                                                                                                                                                                                                              | all suites after the update                                                                                     | fddab44                                  |
| F7, V24 Android release                                                        | **Partly fixed.** Versioning and signing from environment; an unsigned bundle builds. R8, per-ABI, device test and Play steps remain (`docs/android-release.md`)                                                                                                                                                                                                    | `bundleRelease` builds                                                                                          | fddab44                                  |
| V25, V27, V45, V46, V48                                                        | **Fixed**                                                                                                                                                                                                                                                                                                                                                           | tests                                                                                                           | 8500a26                                  |
| V21 TURN lifetime, V65 rebuild instead of repair                               | **Fixed in code, not yet proven on two networks.** A dropped connection asks for an ICE restart; the server sends fresh relay credentials to both ends and the camera offers again; the old 8 second rebuild stays as the fallback. ADR 0112                                                                                                                        | backend, web viewer and web producer tests; Android compiles                                                    | in main by 9893657 (#121)                |
| V32 new-viewer default                                                         | **Fixed (owner decision: ask at invite time).** A viewer invitation must say all cameras or list cameras; migration 0038                                                                                                                                                                                                                                            | backend and web tests; Android compiles                                                                         | #102, deployed                           |
| V41 local pause                                                                | **No change (owner decision).** Owners already edit pause permission per viewer and guest                                                                                                                                                                                                                                                                           | ADR 0109                                                                                                        | n/a                                      |
| V2 unsigned desktop updates                                                    | **Fixed for the update feed (owner decision).** Ed25519-signed `latest*.yml`, verified by the app; Windows Authenticode still to buy                                                                                                                                                                                                                                | unit tests; real key signed and verified end to end                                                             | #102; desktop 0.4.1 published separately |
| V6, V7 recording keys                                                          | **Fixed (owner decision: keep design, say it plainly).** Copy corrected on the Trust page, clips page, privacy policy and security overview; key bound to recording and purpose; rotation via `RECORDING_ENCRYPTION_KEY_PREVIOUS`; daily rewrap job                                                                                                                 | unit and integration tests; live: job ran, 0 unreadable                                                         | #102, deployed                           |
| F6 registration hint                                                           | **No change (owner decision: keep the hint)**                                                                                                                                                                                                                                                                                                                       | n/a                                                                                                             | n/a                                      |
| F10 guest cookie, V51 guest lockout, V64 time zones, V52 removed-camera clips  | **Fixed**                                                                                                                                                                                                                                                                                                                                                           | integration tests (V52 red then green)                                                                          | #103                                     |
| V57, V76, V86, V87                                                             | **Fixed** (credential-read log line; sign-in Back and alert; Review link; Drive "reconnect")                                                                                                                                                                                                                                                                        | web tests; Android compiles, tests, lint                                                                        | #103                                     |
| V61 motion detection (part)                                                    | **Partly fixed.** Whole-picture brightness shifts and rotation changes no longer count as movement; thresholds and latency unchanged; the sustained filter still needs device validation                                                                                                                                                                            | unit tests                                                                                                      | #104                                     |
| V49 motion-settings polling, V77 clipboard, V63 Drive warning, V88 copy        | **Fixed**                                                                                                                                                                                                                                                                                                                                                           | tests; Android tests and lint                                                                                   | #104                                     |
| V43 viewer updates                                                             | **Fixed (owner decision, ADR 0113).** Viewers refresh every 20 s and can opt in to alerts for the cameras they were granted; guests get none                                                                                                                                                                                                                        | backend integration test; web                                                                                   | #112, deployed                           |
| V47 email verification gates nothing (part)                                    | **Partly fixed.** Sending an invitation needs a verified email where email is configured                                                                                                                                                                                                                                                                            | integration test                                                                                                | #105, deployed                           |
| V72 clip recording unavailable                                                 | **Fixed.** The phone reports whether it can record clips; the camera settings warn when it cannot                                                                                                                                                                                                                                                                   | web test; Android tests and lint                                                                                | #105, deployed                           |
| V33 Android reads error text, V75 LAN warning                                  | **Fixed**                                                                                                                                                                                                                                                                                                                                                           | Android compiles                                                                                                | #106, deployed                           |
| V26 email squatting (owner decision: verify before first sign-in), rest of V47 | **Fixed.** Password accounts verify their email before first sign-in where email is configured; a completed reset also verifies; ADR 0111                                                                                                                                                                                                                           | backend integration (web and Android sign-up and sign-in); web and Android screens                              | #107, deployed                           |
| V16 dev tooling advisories                                                     | **Fixed except one.** `pnpm audit` 25 to 1 (sprintf-js, no patched release); weekly full audit workflow added                                                                                                                                                                                                                                                       | all suites and builds                                                                                           | #108, deployed                           |
| V12 Google Fonts                                                               | **Fixed and checked live.** Only same-origin requests on the public pages; Inter Variable loads                                                                                                                                                                                                                                                                     | browser check of the live site                                                                                  | #99, deployed                            |
| Desktop 0.4.1                                                                  | **Published** for Windows, macOS and Linux with signed feeds                                                                                                                                                                                                                                                                                                        | live feed verified against the embedded key                                                                     | n/a                                      |
| V73 account deletion on Android                                                | **Fixed.** Asks for the password when the server wants a recent sign-in                                                                                                                                                                                                                                                                                             | Android tests and lint                                                                                          | #110, no deploy needed                   |
| V74 restore drill                                                              | **Fixed.** Compares row counts with the live database and fails on an empty restore                                                                                                                                                                                                                                                                                 | script test                                                                                                     | #110                                     |
| F11, V89                                                                       | **Fixed.** Service-worker asset cache keeps the newest 80 files; bookmarks for vanished clips are dropped once the whole list is loaded                                                                                                                                                                                                                             | web tests                                                                                                       | in main by 9893657 (#121)                |
| V62 MediaPipe                                                                  | **Fixed.** The runtime is compiled and shipped only with `-PsmartDetectionEnabled=true`                                                                                                                                                                                                                                                                             | default and enabled builds compile; tests and lint                                                              | in main by 9893657 (#121)                |
| V56 schemas                                                                    | **Fixed where safe.** Capability metadata bounded; rename requests strict. Device-facing schemas stay lenient so older apps keep working                                                                                                                                                                                                                            | backend tests                                                                                                   | in main by 9893657 (#121)                |
| V53 Drive                                                                      | **Partly fixed.** Thumbnails get their own file name and marker. Tokens are still refreshed every time on purpose: reusing one would hide a revoked connection for up to 30 minutes                                                                                                                                                                                 | backend tests                                                                                                   | in main by 9893657 (#121)                |
| V80, V81                                                                       | **Fixed.** Welcome-card quality claim, pairing instructions, device name from the phone model, admins no longer offered "Remove" on another admin                                                                                                                                                                                                                   | Android compiles; web tests                                                                                     | in main by 9893657 (#121)                |
| V39                                                                            | **Fixed.** Up to eight notification sends at a time                                                                                                                                                                                                                                                                                                                 | backend test                                                                                                    | in main by 9893657 (#121)                |
| F9                                                                             | **Improved.** Main chunk 587 kB to 442 kB by loading rarely used screens on demand                                                                                                                                                                                                                                                                                  | build; web tests                                                                                                | in main by 9893657 (#121)                |
| V24 Gradle scan                                                                | **Fixed.** Release dependencies are locked and the weekly workflow scans them with OSV                                                                                                                                                                                                                                                                              | scan of the lockfile found nothing                                                                              | in main by 9893657 (#121)                |
| V38, F12                                                                       | **Fixed.** Per-feature notes moved from the README to `docs/feature-notes.md`; the remote tool's attachment folder is ignored                                                                                                                                                                                                                                       | n/a                                                                                                             | in main by 9893657 (#121)                |
| V22 device credential rotation                                                 | **Fixed (ADR 0113).** A camera swaps its credential at 30 days; the old one stays valid until the new one is first used; use is recorded                                                                                                                                                                                                                            | backend integration tests; Android compiles                                                                     | #112, deployed                           |
| V70, V71                                                                       | **Decided (ADR 0113).** Snapshots stay in Photos with a note; Standard or HD video quality in the camera screen                                                                                                                                                                                                                                                     | Android compiles                                                                                                | #112                                     |
| V21, V65 repair of dropped connections                                         | **Proven on different networks (owner test, 2026-10-11)**                                                                                                                                                                                                                                                                                                           | owner test                                                                                                      | #111, deployed                           |
| Cast receiver                                                                  | **Fixed.** The receiver called a method that does not exist (`addCustomMessageHandler`, correct name `addCustomMessageListener`), and X-Frame-Options DENY would have blocked its guest-page frame                                                                                                                                                                  | unit test with the real method names; Caddy header check                                                        | in main by 9893657 (#121)                |
| Android download                                                               | **Added.** The sideload app is a release build signed with the alpha key, 68 MB (MediaPipe no longer shipped), listed on the downloads page                                                                                                                                                                                                                         | manifest and loader tests                                                                                       | in main by 9893657 (#121)                |
| Monitor and backups on the server                                              | **Found broken and fixed (2026-10-12).** The health monitor failed on every run since October 10 (script not executable, stale copy under /opt/beacon/app) and the daily backup timer was off since September 23. Units now run from /opt/beacon/current; backups and the weekly check are enabled; a restore drill compared 2/2 users, 2/2 households, 1/1 cameras | server runs; restore drill                                                                                      | #117                                     |
| V30, V60 clip memory                                                           | **Fixed (ADR 0115).** Chunked authenticated format on web and Android with a shared known-answer test; the web player no longer holds about three copies of a clip and Android no longer writes a second whole copy. Playback still starts after the download                                                                                                       | web and Android tests                                                                                           | in main by 9893657 (#121)                |
| Drive expiry reminders (owner request, 2026-10-12)                             | **Added (ADR 0116).** Hourly check, email now and every 3 days (five in all), banner on web and Android                                                                                                                                                                                                                                                             | backend integration tests; web and Android                                                                      | in main by 9893657 (#121)                |
| Motion history setting                                                         | The "Recommended" label on 30 days was removed (owner request)                                                                                                                                                                                                                                                                                                      | web                                                                                                             | in main by 9893657 (#121)                |
| Settings page layout (owner request, 2026-10-12)                               | **Reworked.** Sections grouped (Household, Alerts & storage, This device, Account), one 32 px rhythm instead of three stacked overrides, notification table adapts to its section width                                                                                                                                                                             | responsive audit passes at 114 captures                                                                         | in main by 9893657 (#121)                |
| Add a device flow (ADR 0117)                                                   | **Reworked on web and Android.** One question, then the steps for the chosen device                                                                                                                                                                                                                                                                                 | web and Android tests                                                                                           | in main by 9893657 (#121)                |
| Downloads and updates (ADR 0118)                                               | **Added.** Shared downloads component (landing, Settings, Add a device); update bar for open web pages with a busy-aware auto reload; desktop status in Settings; Android update card                                                                                                                                                                               | web, desktop and Android tests                                                                                  | in main by 9893657 (#121)                |
| V90 standby cameras fail sometimes                                             | **Fixed (ADR 0118).** A camera the system ended is no longer handed to the next viewer; an always-on camera restarts; a briefly busy camera is retried                                                                                                                                                                                                              | camera mode tests                                                                                               | in main by 9893657 (#121)                |
| Live viewer redesign (request of October 10)                                   | **Done on web and Android.** Four controls and a More menu; sleep timer and stream details moved; Fit or Fill added                                                                                                                                                                                                                                                 | web: tests plus the responsive harness at five widths; Android: compiles, tests, lint, **not seen on a device** | 819cfa3, ff3316f                         |

**Not fixed, and why** (decision record: ADR 0112)

- **V61 sustained-motion filter:** needs field data.
- **V50 resume after reboot:** Android 14 limits starting a camera service at boot; needs a device check.
- **F5, V14, V58 in-process limits and handoff codes:** correct while one backend instance runs; they move to PostgreSQL before a second instance.
- **F8, V35, V36, V37, V79:** large refactors with no user-visible change; done when the files are next touched.
- **V11 backups exclude keys:** the env template now says so; keeping the keys is an owner routine.
- The remaining Low items stay as listed in section 2.3 unless named above.

**New findings made while fixing**

- The web live view's **Reconnect button was never rendered** in the normal failure case.
- coturn 4.6.3 rejects `no-loopback-peers` as a bad option (it was silently ignored).
- Fastify's numeric `trustProxy` did not read `X-Forwarded-For` in the version in use; ranges are used.
- A reused-secret check (V27) showed an existing test configured one key for three secrets.
- A new `UPDATE` with an untyped timestamp parameter failed only against PostgreSQL, which the
  integration suite caught.

## 1. Scope, method and limits

| Area                  | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo state            | 16 local branches compared with `main`: 13 fully merged, 3 documentation-only. `origin/main` is `c42c277` (PR #98); local `main` is `429b654`, three commits behind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Static checks         | format, lint, typecheck, build pass. Backend (172) and web (366) tests pass. 137 backend tests skip locally without `TEST_DATABASE_URL`; CI runs them against PostgreSQL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Dependencies          | `pnpm audit`: 32 advisories (4 low, 19 moderate, 9 high). Only 4 moderate are production (`fastify`, `fast-uri`); the 9 high are in dev/build tooling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Code read             | Session/CSRF, authentication and OAuth handoffs, pairing, guest links, recording and share-link routes, Drive client, signaling, TURN, notifications, crypto helpers, session repository, retention jobs, migrations (index/cascade scan), deploy workflow, backup script, Caddy/Compose/Dockerfiles, Android manifest/build/privacy service, Electron main process, deep-link and camera-setup handling and packaging, web service worker, storage and camera auto-start, Cast receiver, signaling hub and route, account recovery, household authorization and sharing, motion-event access control, device runtime routes, config validation, Android dependencies and Play-relevant settings. |
| Not examined in depth | Remaining Kotlin UI, most React components, `store.ts` internals, individual migration SQL, `LiveVideo` media logic, the physical-device and production behaviour. Android and Electron were not run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 1.1 Runtime verification added in the second deep pass

A disposable PostgreSQL 17.6 container (removed afterwards, repository untouched) ran the
whole backend suite: **all 55 files and 309 tests pass**, including the 137 that skip without a
database, and the migration schema check (164 objects) passes. Three throwaway probes against
the built backend then **reproduced** findings that had only been read in code:

| Probe                                                                                                            | Result                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Seven different clients behind one proxy, each with its own `X-Forwarded-For`, register                          | Clients 1–5 succeed (`201`); clients 6 and 7 get `429`. Registration is limited to **5 per hour for everyone** (F1). |
| Twelve wrong logins for one victim from twelve attacker addresses, then the real owner with the correct password | Ten `401`, then `429`; the **owner with the right password also gets `429`** (F1 lockout).                           |
| Fourteen wrong pairing codes, new `installationId` each                                                          | Fourteen `400`, never `429`: the limiter never engages (V9).                                                         |
| One session, 100 authenticated `GET /api/cameras`                                                                | `browser_sessions` row updates rose by exactly **100** (V4).                                                         |

### 1.2 Reading coverage after the third and fourth passes

Read in full or in the parts that carry logic: all backend route files and the device, account, recording,
pairing, recovery and session repositories; `signaling.ts`, `household-events.ts`, the Drive and crypto helpers,
all background jobs; the desktop main process, deep-link, sign-in, permission, preload and packaging files;
Android `BeaconApi`, the camera service, signaling client, WebRTC sessions, capturer, motion detector,
credential stores, clip upload, talk session, viewer session, `MonitorUi` and the launch and push entry points;
the web `api`, `LiveVideo` connection logic, `BrowserProducer`, guest and shared-clip pages, Cast sender and
receiver, recording playback, downloads and setup dialog; Compose, Caddy, coturn, backup, restore and monitor
files; the first and a sample of later migrations; the CI and deploy workflows.
Skimmed or only searched, not read line by line: the Compose UI layout files (`MonitorComponents`,
`CameraModeUi`, `HouseholdSharingPanel`, `RecordingLibrary`, `ActivityFeedUi`, navigation and design files),
most React presentation components and CSS (`MotionEventList`, `CameraWall`, `NotificationSettings`,
`SettingsPage`, `Sidebar` and similar), the remaining migrations, `store-contract.ts`, and the test files.
Nothing was run on a device, an installed desktop app, or production.

## 2. Findings

### 2.1 High

**V1 — Android Google sign-in handoff has no PKCE (Confirmed).**
`authentication-routes.ts` (≈ lines 706–719) redirects the system browser to
`beaconsecureview://auth/mobile?code=<token>`, and `POST /api/mobile/auth/google`
exchanges the code for a full session token. The desktop flow binds its code to a
challenge/verifier; Android does not. The manifest keeps the custom scheme as a
fallback beside the verified App Link, and any other installed app can register the
same scheme. Whoever exchanges the code first (10-minute lifetime, single use) gets
the user's session (30-day absolute lifetime).
Fix: reuse the desktop PKCE mechanism, prefer the verified `https` App Link, treat the
custom scheme as development-only. Test that an exchange without the verifier fails.

**V19 — A deep link or file can enroll a computer's camera and microphone with no confirmation (Confirmed in code; end-to-end Verify on an installed app).**
This is the most serious finding of the deeper pass. The desktop app registers the
`beaconsecureview://` scheme and the `.beaconcamera` file type (ADR 0083).
`camera-setup.ts` accepts `beaconsecureview://camera/setup?code=<pairing code>&mic=1&power=always`,
and `main.ts:startCameraSetup` immediately:

1. turns on **open at login** (only a notification, no prompt),
2. brings the window to the front and loads `/camera-mode/setup?code=…&autostart=1&mic=1`.

The web page then redeems the code and starts capture without clicks
(`readAutoStartRequest`, `BrowserCameraMode.tsx` auto-start effect), and `POST /api/browser-devices/pair`
needs only a valid pairing code and the right `Origin`, not a signed-in session. The
Electron permission handler grants the app's camera and microphone request for its own
origin with no further prompt on Windows and Linux. The pairing code can belong to **any**
household. So a web page, email link or downloaded `.beaconcamera` file can make a computer with
Beacon installed start streaming its webcam (and microphone) into an attacker's household and
stay enrolled across restarts. The browser's "open external app" prompt is the only
friction, and a window does appear, but nothing tells the person whose household the
camera is joining. This conflicts with the project rule that capture must be visible and
consented to by the camera-device user.
Fix: always show a native confirmation dialog naming the household or owner, the camera
and microphone being enabled and the persistence, before any pairing or capture, and make
`autostart` for deep links and files require that confirmation (resume after restart may keep
using a stored local flag the user already approved). Do not enable open-at-login or the
microphone from a link. Consider tying setup links to the signed-in household of the app, or
displaying the household name returned by the pairing endpoint before streaming. Add tests for
the dialog and for rejecting a link when it is declined.

**V19b — The Android app has the same flaw: an unpaired phone pairs itself from a link, QR code or any app's intent (Confirmed in code).**
`MainActivity` is exported, parses `intent.dataString` with `parsePairingQr` on every launch and every
`onNewIntent`, and a `LaunchedEffect` in `BeaconCameraApp` calls `pairCamera(code)` immediately whenever the
phone has no stored credential. There is no confirmation dialog and no display of which household the code
belongs to. A verified App Link (`https://beacon.builtbysai.com/pair?code=…`), a scanned QR code, or any
other installed app sending an explicit intent with `beacon://pair?code=…` (accepted by the parser even
though no filter declares it) is enough. Once paired, the foreground service starts capture as soon as the
permissions it already holds allow. Any phone with Beacon installed and not currently paired (a new
install, or one that has just erased its pairing under V40) can be enrolled into someone else's household by
one tap or one hostile app. The same activity also accepts a Google sign-in handoff code from any intent
(`parseMobileGoogleAuthLink`), so an attacker app can sign the phone into the attacker's account (V1).
Fix: show a confirmation that names the household and the camera and microphone being enabled before any
pairing, never pair from an intent that did not come from the in-app scanner or an explicit "Pair" tap, and
make `MainActivity` ignore data from non-verified senders. The in-app copy ("Open this one-time setup link on an Android device with a camera") shows one-tap setup is intended, so keep the speed but add a single interstitial that names the household.

**V2 — Desktop auto-update trusts an unsigned feed on the same server (Confirmed).**
`apps/desktop/electron-builder.yml` publishes updates from
`https://beacon.builtbysai.com/downloads/`, and builds are unsigned. `electron-updater`
checks only the SHA-512 inside `latest*.yml`, served from the same host. Anyone able
to write `/opt/beacon/downloads` (compromised VM, deploy key, publishing mistake) can
push a silent update to every installed desktop app — a camera and microphone app.
Fix: Windows code signing with publisher verification, a signed manifest checked by the
app, and a separate low-privilege publishing path. Certificate purchase needs the
owner's decision; until then limit auto-update to the owner's machines.

**F1 — Client IP is the proxy's IP (Confirmed; detail in the earlier document).**
No `trustProxy` is set, so every `request.ip`-keyed limit is shared by all users.
New concrete consequences found in this pass:

- `share-link-playback:${ip}` allows **20 plays per hour for the entire site**, so
  shared clips stop playing for every recipient after 20 views.
- `guest-enter:${ip}` (30/hour) and `share-link-lookup:${ip}` (30/hour) are also global.
- Login collapses to a per-email limit (10 per 15 minutes), so anyone can lock out a
  known user by sending bad attempts.
- `register` (5/hour), `password-reset` (5/hour), `contact` (3/hour) are global.
  Fix and validation are unchanged: trust only the Caddy hop and test that a spoofed
  `X-Forwarded-For` from outside is ignored.

**F2 — No security headers on the production web edge (Confirmed).**
Refinement from this pass: the Cast receiver (`/cast/index.html`) loads the guest
viewer in a same-origin iframe, so the policy for `/g/*` must use
`frame-ancestors 'self'` (not `'none'`), and `/cast/` needs its own relaxed policy for
the Google Cast SDK. All other paths can use `frame-ancestors 'none'`.

**F3 — TURN can relay to private ranges (Verify).** Only loopback and multicast are
denied. See the earlier document. A recorded relay smoke test also **failed** with
`403 Forbidden IP` (unmerged commit `4db9dd7`), so end-to-end relay has not been
proven for any product.

### 2.2 Medium

**V3 — Unauthenticated share-link route can crash the backend (Confirmed).**
`recording-routes.ts:400` calls `void store.touchRecordingShareLinkAccess(...)` with no
`.catch`. If that database call rejects (a transient connection drop or timeout), Node 22's
default unhandled-rejection behaviour terminates the process, and no
`unhandledRejection` handler exists in `index.ts`. An unauthenticated request path can
therefore turn a brief database hiccup into a restart that drops every live viewer.
Fix: await it inside a `try/catch` or add `.catch`, and register process-level handlers
that log and exit cleanly. Add a test where the store rejects.

**V20 — Live-view admission has no viewer cap and no message rate limit (Confirmed).**
`signaling-route.ts` and `SignalingHub` admit any number of viewer sockets per camera,
per account and per guest link, and forward `ice`/`answer` messages (SDP up to 1 MB) without a
per-socket rate. Every admitted viewer makes the phone create a peer connection and encode
video. Any signed-in member, or anyone holding a guest link with live view, can exhaust a
camera on an older device or burn its battery. N9 already lists safe viewer limits as an open
item. Fix: per-camera and per-household concurrent-viewer caps (configurable by device
class), per-socket message-rate and size limits for ICE, per-guest-link concurrency, and
audit/alert when a cap is hit.

**V21 — TURN credentials expire after 10 minutes and nothing renews them (Verify).**
`TURN_CREDENTIAL_TTL_SECONDS` defaults to 600 and credentials are issued once, in the
`ready`/`viewer-ready` message. Neither the web viewer nor the Android client calls
`restartIce`, `setConfiguration` or otherwise requests fresh credentials (searched
`LiveVideo.tsx` and the Kotlin sources). coturn re-checks the time-limited username when
an allocation is refreshed, so a relayed session may drop about ten minutes in. Direct
(non-relayed) sessions are unaffected. There is also no ICE restart on a network change.
Because the earlier relay smoke test failed, this has never been shown to work for sessions
longer than one credential lifetime. Fix: have signaling push refreshed ICE configuration
before expiry, call `restartIce()` on connectivity loss, and add a forced-relay test that
runs longer than the credential TTL on two real networks.

**V22 — Camera device credentials never expire, rotate or record use (Confirmed).**
`device_credentials` holds one hash per camera with only `created_at` and `revoked_at`.
A copied credential (rooted phone, backup of a browser camera cookie, support bundle) lets
someone impersonate the camera indefinitely — connect as the producer, submit heartbeats and
motion events and request upload sessions — until the owner revokes it. There is no `last_used_at`
so the owner cannot spot a second user either. Fix: add `last_used_at` and last IP/user agent, rotate
the credential periodically over the authenticated channel, and show "last active" in device
management.

**V4 — Every authenticated request writes to `browser_sessions` (Confirmed).**
`PostgresSessionRepository.findActive` is an `UPDATE … RETURNING` over a four-table
join, executed on every authenticated call, on every WebSocket re-check
(`household-events.ts` every 15 seconds per connection) and on every device-adjacent
poll. That is write and lock amplification on the smallest database.
Fix: a read-only `SELECT` plus a throttled touch (for example once per few minutes).

**V5 — Expired data is never purged (Confirmed).**
Only audit and motion events have retention jobs. Sessions, password-reset and
email-verification tokens, pairing codes, guest links, invitations and share links
accumulate forever, and `browser_sessions` has only a `user_id` and `household_id`
index (none on expiry).
Fix: a batched purge job with retention margins and expiry indexes.

**V6 — The server hands the recording data key to every authorized player (Confirmed; design).**
`relayRecordingPlayback` unwraps the data key and returns it in the
`X-Beacon-Recording-Key` response header, including to anonymous share-link recipients.
Drive therefore holds ciphertext only, but Beacon's server holds the master key, the
wrapped key and the Drive access token, so recordings are **not end-to-end encrypted** from
the operator. The threat model says so; UI, store listing and legal copy must stay
consistent with it (Play data-safety and privacy policy included). It also means a
share link is equivalent to a bearer capability for the clip until it expires or is revoked.

**V7 — Cryptographic envelopes lack a key id and associated data (Confirmed).**
`recording-crypto.ts`, `google-drive-crypto.ts` and `notification-crypto.ts` use
AES-256-GCM with random 96-bit nonces (sound), but one environment master key each, no
key version and no AAD. Keys cannot be rotated without a bulk re-encrypt, and a
database-level attacker could swap wrapped values between rows undetected.
Fix: add a key-id column, bind the row id as AAD, document rotation.

**V8 — Web Push endpoint accepts any HTTPS URL (Confirmed; exploitability Verify).**
`notification-routes.ts` only requires `https:`; the backend later POSTs to it. A
signed-in user can register an internal HTTPS host and cause server-side requests
(blind SSRF). Fix: allowlist the known push-service host suffixes and reject IP
literals and private resolutions at send time.

**V9 — Pairing rate-limit key is attacker-controlled (Confirmed).**
`pairing-redeem:${ip}:${installationId}` uses a client-supplied `installationId`, so
every attempt can use a fresh bucket. Brute force is still impractical (50-bit code,
short lifetime, 10 cameras per household per hour), but the limiter is ineffective.
Key on IP (after F1) and on the code hash.

**V10 — Deploy workflow has no rollback and builds on the production VM (Confirmed).**
`deploy-web.yml` builds on the Oracle VM, runs migrations, replaces services and then
health-checks; a failed check leaves the new release running. Old release directories and
images are never pruned on a free-tier disk that has already needed capacity recovery.
ADR 0106 says the workflow "remains disabled", yet the file has no disabling condition.
Fix: keep and restore the previous image on failure, prune old releases, build in CI,
make the disabled state explicit.

**V11 — Backups cannot be restored without separate secrets (Confirmed; operational).**
`backup.sh` dumps PostgreSQL only. The Drive-token, notification and recording keys live in
`/etc/beacon/production.env` and are not backed up, so a restore on a new host leaves that
data unreadable. `restic check` runs without `--read-data`, and the timers are still
disabled (N3). Fix: a rehearsed key-escrow procedure kept apart from the backup
repository password, periodic `--read-data` checks, and the N3 decisions.

**V23 — Password-reset request leaks account existence by timing; email calls have no timeout (Confirmed).**
`password-reset/request` awaits `deliverPasswordResetEmail` (a network call to Resend) only when the
account exists and has a password, but returns immediately for unknown addresses, so response time
reveals which emails are registered even though the status and body match. `deliverResendEmail`
uses `fetch` with no `AbortSignal`, so a stalled provider also holds requests open. Per-email limits
(3 per hour) let anyone exhaust a victim's reset quota. Fix: queue delivery after responding (or
pad to a constant time), add a timeout, and rate-limit by IP and email separately from the victim's
own successful attempts.

**V24 — Android store and supply-chain readiness (Confirmed unless noted).**

- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is a restricted Play permission; a camera that must run in the
  background needs a documented justification or a different approach (foreground-service only, with a
  settings deep link) or review may reject it.
- `targetSdk = 35`, AGP 8.7.3, Kotlin 2.1.0, Compose BOM 2024.12.01, OkHttp 4.12.0: **Verify** the current
  Play target-API requirement before submission; the toolchain is a year or more behind.
- Nothing audits Gradle dependencies (`pnpm audit` covers npm only); add an OSV or Dependency-Check scan
  of the Android lockfile/catalog in CI. The WebRTC library is a third-party build
  (`io.github.webrtc-sdk`), which needs a documented update/CVE-watch owner.
- `versionCode = 1` is hard-coded; the release process must derive it from CI.

**V29 — Web live view gives up after about 30 seconds (Confirmed).**
`reconnect.ts` allows 5 automatic retries (1, 2, 4, 8, 16 seconds with jitter, about 31 seconds in
total) and `LiveVideo.tsx` then shows a failure that needs a manual Reconnect. A router reboot,
a phone changing from Wi-Fi to mobile data, or a camera restart longer than half a minute ends the
view permanently. That contradicts the "reliability on unstable networks" priority, and it is worst
for unattended screens: the camera wall, picture-in-picture and Cast guest views on a TV.
Fix: keep retrying with a capped backoff (for example 30 seconds) while the page is visible, show
clear status, stop only on authorization loss or an explicit stop, and test a 5-minute outage.

**V30 — Clips are processed whole, not streamed (Confirmed).**
Playback downloads the entire ciphertext (up to 250 MB) before anything plays. The web player
(`recording-playback.ts`) holds the ciphertext as one `Uint8Array`, decrypts it into a second
buffer and then builds a Blob, so peak memory can reach roughly three times the clip size. Android
(`downloadRecordingForPlayback`) writes a ciphertext file and then a plaintext copy, doubling
storage use. Recording and upload encrypt the clip with a single AES-GCM operation, which forces
this. On the older phones the product targets, a long clip can run out of memory or storage.
Fix: a chunked authenticated format (fixed-size chunks, per-chunk nonce, final-chunk flag, version
byte) enabling bounded memory and progressive playback, plus a lower per-clip size cap until then.

**V31 — Production Compose has no least privilege or resource limits (Confirmed).**

- The backend, migrations and verification connect as `POSTGRES_USER`, the PostgreSQL **superuser**.
  A SQL injection or a compromised backend then has superuser rights over the database. Use a
  separate migrator role and a low-privilege application role with only table-level rights.
- None of `postgres`, `backend`, `coturn` or `web` sets `mem_limit`, `cpus`, `read_only`,
  `cap_drop`, `no-new-privileges`, a non-root `user`, or a backend health check. With another
  product on the same small VM, one runaway container can take the host down.
- `production.env.example` does **not** list `RECORDING_ENCRYPTION_KEY` although Compose passes it
  through; an operator following the template silently gets `503` for every recording. It appears only
  in `apps/backend/.env.example`. Add it with the same "separate 32-byte key" note.

**V32 — The new-viewer default exposes every existing camera (Confirmed; privacy default).**
`acceptInvitation` grants an invited **viewer** access to _all_ enabled cameras with the inviter's
default listen/talk/flip/pause choices, and only afterwards can an admin restrict it. For a product
whose first priority is privacy, new members should start with no cameras (or an explicit selection at
invite time), especially for bedrooms and other sensitive rooms. Guests already start narrow. This
needs an owner decision because it changes the sharing experience.

**V40 — A camera phone erases its own pairing on any 401 or 403 (Confirmed).**
`BeaconApi.heartbeat` returns `false` for **both** 401 and 403, `CameraForegroundService` then calls
`requirePairing()`, which runs `CredentialStore.clear()` and stops the service. `CameraSignalingClient`
does the same when the WebSocket upgrade fails with 401 or 403 or closes with `4003`
(`authorizationLost`), and every other API call treats a single 401 as `AuthorizationLostException`.
A captive portal, hotel or office proxy, CDN or firewall rule that answers 403 to one request, or a
backend bug that returns 401 for a moment, therefore **permanently unpairs a remote camera** that
only someone holding the phone can re-pair. A bad deploy would unpair every camera at once.
Fix: treat 403 as transient; act on a credential loss only after several consecutive 401 responses
with the server's explicit revoked-credential code, with backoff between them; keep the encrypted
credential until the user chooses to re-pair or the server positively reports revocation; and add a
distinct `credential_revoked` error code on the server.

**V41 — A remote viewer can switch capture back on after the person at the phone paused it (Verify).**
`PrivacyGate` gives a local pause precedence only until the server confirms it. After that,
`onPrivacyMode(false)` from the server (any signed-in member whose grant has `canPause`, via
`PUT /api/devices/:id/privacy`) resumes camera and microphone capture with no local action.
The status-bar notification still shows, but the project rule is that privacy mode must stop
capture and the device user must stay in control. Decide whether a _locally_ initiated pause
should be locally resumable only (or resumable remotely only by the owner, with a notification
and a short delay), and make the grant wording in the sharing screens say what `canPause` includes.

**V42 — Deleting data leaves encrypted clips orphaned in the owner's Drive; clips never expire (Confirmed).**
`recordings` rows cascade-delete with a camera, household or user, but the Drive file is deleted only
by the explicit `DELETE /api/recordings/:id` route. Removing a device, account or household therefore
leaves ciphertext (and thumbnails) in Google Drive forever, with no list of what to clean up, and the
keys are gone so nothing can open them. Separately, no job deletes a clip when it ages out: clips
live until someone deletes them (motion events do have retention). The owner's account deletion also
destroys the whole household for every admin and member with no ownership transfer, no warning to
members, and revokes the Drive token before the database deletion has succeeded.
Fix: delete Drive files before cascading deletes (best effort with a retry queue), add a clip retention
setting, an ownership-transfer step, and move the Drive revocation after a successful delete.

**V43 — Viewer and guest accounts never get live updates, alerts or polling (Confirmed).**
`/api/events` is administrator-only and the web hook is disabled for other roles; the alert pipeline
queries only `owner`/`admin` members; and the web app has no polling. A viewer's camera list, online
status and privacy state change only on a reload, even though they can watch cameras. Viewers also cannot
receive motion or offline alerts for the cameras they are allowed to see. Either document this as owner-
and-admin-only, or add camera-scoped events (the code comments already name this as future work) and a
per-user alert opt-in.

**V44 — Android clip cache can collide and leaves plaintext behind (Confirmed; collision Verify).**
The recording service writes `beacon-clip-<id>.mp4` (plaintext) and `.encrypted` into `cacheDir`, and
`downloadRecordingForPlayback` deletes **every** `beacon-clip-*` file in the same directory before it
starts. If the same app instance plays a clip while recording one, the in-flight recording is deleted.
After a crash or kill mid-upload nothing removes the plaintext clip. Give recording and playback
separate directories or prefixes, and sweep stale clips at service start.

**V59 — A recorded clip is lost if its upload fails once (Confirmed).**
`uploadRequestedClip` has no retry or queue. A single failed Drive request, a dropped connection, or a
backend restart marks the recording failed, reports `upload_failed`, and the `finally` block deletes both the
plaintext and encrypted files. The upload is one `PUT` of the whole file; the resumable session that Drive
opened is never resumed. For a security camera, the motion clip is the evidence, and a brief outage at the
wrong moment discards it. Fix: keep the encrypted file until upload succeeds or a retention limit passes,
retry with backoff and resume the Drive session, survive process death by listing pending files at start, and
show the owner a clear "clip waiting to upload" state.

**V60 — The code comments say clips are encrypted and decrypted in a stream; AES-GCM on Android usually buffers everything (Verify).**
`encryptClip` and `downloadRecordingForPlayback` use `CipherOutputStream`/`CipherInputStream` with
`AES/GCM/NoPadding`. Android's default provider (Conscrypt/BoringSSL) implements GCM with a one-shot AEAD call
and holds the entire message in memory until `doFinal`, in both directions, because the tag must be checked
before plaintext is released. The comment "the plaintext clip never needs to fit in memory" is therefore probably
wrong for large clips. Android's own 20-second clips are small, but playing a 3-minute web-recorded clip (up to
250 MB allowed) can exhaust the app heap on an older phone. Verify with a large clip on a low-memory device.
Fix: the chunked authenticated format proposed in V30, which gives every platform bounded memory.

**V61 — Motion detection is very coarse (Confirmed by reading; needs field data).**
`MotionDetector` compares 192 single luma pixels (a 16 by 12 grid, one pixel per cell, every half second) against
the previous sample and fires when 16 percent of them move by 28 or more levels. With no averaging, no
background model and no exposure compensation, auto-exposure changes, flicker, IR-cut switching and
headlight sweeps shift many samples at once (false alerts), while a distant person, a pet or a slow mover
covers too few samples (missed events). The previous sample is also not reset when the frame rotation
changes, so a rotation produces one spurious difference. Treat this as a product-quality risk for the
motion alerts and clips that depend on it: average blocks instead of single pixels, track a slowly adapting
background, normalise global brightness, ignore single-frame spikes (a `SustainedSignalFilter` already exists
but is not wired in), reset on rotation, and collect false-alert and miss counts on real devices before
tuning sensitivity levels.

**V66 — The Android monitor polls the server every second while a camera is open (Confirmed).**
`MonitorHome` runs `LaunchedEffect(session, selectedCameraId)` that calls `refresh()` and then waits **1 second**
when a camera is selected (15 seconds otherwise). Each refresh sends `GET /api/cameras` and `GET /api/devices`,
and each authenticated request writes a row in `browser_sessions` (V4). One Android viewer therefore produces
about 7,200 requests and 7,200 database writes an hour while watching, drains battery and mobile data, and
starts a new refresh coroutine every second without waiting for the previous one, so slow responses overlap.
The web viewer makes no such requests. Fix: push camera state over a realtime channel (V43) or poll slowly
(30 to 60 seconds) and only for the visible screen, with a single in-flight request.

**V67 — The Android WebSocket listeners never complete the close handshake (Verify).**
`AndroidViewerSession.Listener` and `CameraSignalingClient` handle `onClosed` and `onFailure` but do not override
`onClosing`. OkHttp calls `onClosed` for a _server-initiated_ close only after the client has called `close()`,
so the Beacon server's close codes (`4003` rejected or authorization lost, `camera_removed`) probably never reach
those branches: the socket lingers until the server drops the TCP connection and the client sees `onFailure`
instead. The `4003` handling would then be dead code, and a revoked camera or removed source is noticed only by
the next heartbeat (up to 30 seconds). If `onClosed` does fire, the viewer branch is worse: the server answers a
viewer who opens an offline, private or disabled camera with an `error` message and then `4003`, which
`AndroidViewerSession` treats as "authorization lost" and the app signs the user out with "Your session
expired". Test on a device with an offline camera. Fix: implement `onClosing` (call `close`), distinguish
`4003` reasons with a distinct close code for "camera unavailable", and add a unit test for each close path.

**V68 — Monitoring cannot see backups that never ran, and runs from a different tree than the release (Confirmed).**
`beacon-monitor.sh` treats a backup unit that has no completion timestamp as healthy
(`[[ -n "$completed_at" ]] || return 0`), so **disabled or never-enabled backup timers (the current N3 state)
produce no alert**, ever. It sends one alert and then stays quiet until recovery, builds its JSON email by string
interpolation (a quote in `RESEND_FROM` or the message breaks it), does not check the web container or the TURN
port, and, like the backup and check units, works from `/opt/beacon/app` while deployments land in
`/opt/beacon/releases/web-<sha>`, so timers can run a different version of the scripts than the release.
Fix: alert when a timer is not enabled or has not run within its window, repeat alerts daily, build JSON with
`jq`, and point every unit at one release symlink.

**F4 — Backend container runs as root with build tooling (Confirmed).**
**F7 — Android release is not shippable (Confirmed; tracked as N6):** version `0.0.0`,
no signing config, no shrinking.
**F8 — Very large source files (Confirmed):** `BeaconApi.kt` 1,861 lines, `App.tsx` 1,807,
`LiveVideo.tsx` 1,361, `HouseholdSharingSettings.tsx` 1,332, `store.ts` 1,128.

### 2.3 Low

- **F5** Rate limits are in-process: reset on restart, cannot be shared by a second instance.
- **F6** Registration reveals whether an email is a Google-only account (409 variants).
- **F9** Web bundle: 581 kB main chunk plus a 478 kB chunk.
- **F10** Guest cookie lives 30 days regardless of the link's expiry.
- **F11** Service worker cache name is fixed (`beacon-shell-v1`).
- **F12** Documentation sprawl and drift; untracked `.codex-remote-attachments/`.
- **F13** TURN uses cleartext `turn:` URLs.
- **V12 Google Fonts on every page:** `styles/global.css` imports Inter from
  `fonts.googleapis.com`, so each visit to a privacy-focused camera app, including
  guest (`/g/…`) and shared-clip pages, makes a third-party request. The default
  referrer policy sends only the origin, so tokens do not leak, but IP and timing do, and a
  strict CSP will block it. Self-host the font.
- **V13 Cast token transport:** the Cast sender sends the guest-link path
  (`/g/<token>?cast=1`) over the Cast channel. The receiver validates the path pattern,
  and the link lasts four hours and is revocable, so this is acceptable; document it and
  keep the link view-only. The receiver app is registered but unpublished and not yet
  tested on real TVs.
- **V14 In-memory mobile handoff map** (`mobileGoogleHandoffs`) is lost on restart and is
  only swept when a new code is issued.
- **V15 Stale local `main`:** three commits behind `origin/main`; branching from it
  starts from outdated code and docs.
- **V16 Dependency advisories:** update `fastify` (>= 5.12.5, HTTP/2 only so unreachable
  today) and `fast-uri`; CI audits only production at `high`, so dev-tool advisories
  (`brace-expansion`, `undici` via `jsdom`/`electron`, `nanoid`, `source-map-js`) are
  never reported. Add a scheduled full audit.
- **V17 Unmerged branches:** `codex/beacon-view-rename` and `codex/oracle-verified-capacity`
  hold documentation commits not on `main`, including the failed relay smoke record.
  Merge or discard them deliberately.
- **V25 Admin session can replace a camera's live socket:** a signed-in owner/admin can connect as
  the "producer" for any managed camera (`signaling-route.ts`), and `connectDevice` closes the real
  device socket. This is intended for browser cameras but lets an admin silently displace a phone
  and feed viewers different video. Restrict the producer role to cameras whose platform is
  `browser`, and audit the replacement.
- **V26 Email squatting at registration:** password registration needs no verified email, so someone can
  create an account for another person's address. A later Google sign-in for that address is forced into
  the "link required" flow and the real person must use password reset to recover it. Google
  auto-linking is correctly not done. Require email verification before the account is usable
  for sharing and invitations, or let a verified Google identity take over an unverified password account.
- **V27 Secrets are not checked for reuse:** the recording, Drive, notification encryption and fingerprint
  keys are validated for length only. Add a startup check that all are distinct and not the TURN secret.
- **V28 Invitation email names no inviter:** `deliverHouseholdInvitation` says only "a Beacon View household",
  which helps phishing and makes unexpected invitations hard to judge. Include the inviter's name or
  email and household name.
- **V33 Server messages are matched by exact text:** Android matches the string
  `Connect Google Drive for recordings first` (the backend comment says so). Any wording change breaks
  the client silently; Android should switch to the machine-readable `code` field.
- **V34 Guest membership expiry equals invitation expiry:** a `guest` member expires when the invitation
  would have expired (default 48 hours after it was sent), not a fixed duration from acceptance, so a late
  acceptance gets less access than the inviter intended. Store an explicit access duration.
- **V35 Whole-household reads filtered in JavaScript:** device routes such as privacy, heartbeat and
  disconnect call `listCameras(householdId)` or `listDevices(householdId)` and then `filter`/`find` one
  device. Query by device id instead.
- **V36 Store boilerplate and legacy naming:** `PostgresStore` (1,128 lines) forwards each method to a
  repository, `store-contract.ts` (938 lines) restates every signature, and the type is still named
  `MilestoneStore`. Every new method needs three edits. Expose the repositories directly or generate
  the facade.
- **V37 Android CI is memory-fragile:** the workflow already splits lint and release builds because the
  large Compose screens ran the runner out of memory, and the project needs a 3 GB Gradle heap (2 GB
  fails). This is a symptom of the oversized screens in F8.
- **V38 README grows like a changelog:** per-release feature paragraphs (including a migration rollout
  note) sit in the middle of the README and there is no quick start near the top. Move release notes to
  the changelog or docs and keep the README as an overview.
- **V39 Notification sweeps send one at a time:** each sweep claims a batch and sends serially with a
  10-second timeout per call, so one slow provider delays alerts to everyone behind it. **Verify** the
  batch size, then consider bounded concurrency.
- **V45 Google sign-in can fail once after an abandoned Drive or link flow:** in the OAuth callback the
  `drive` state cookie takes precedence over the sign-in state cookie, and `/api/auth/google` does not
  clear it. If someone starts "Connect Drive" and closes the Google tab, a Google sign-in in the next ten
  minutes is treated as a Drive callback and ends on `drive=failed`; retrying works because the cookies
  are cleared. Clear the other state cookies when a flow starts.
- **V46 Password-reset tokens are not invalidated by use or by a password change:** several live tokens can
  exist, and consuming one leaves the others valid for their lifetime (check the TTL). Invalidate all of a
  user's reset tokens when one is used or when the password changes.
- **V47 Email verification gates nothing:** no feature checks `emailVerifiedAt`, including household
  invitations and password reset, so the verification email is cosmetic. Either require it for sharing and
  recovery or stop presenting it as a security control.
- **V48 Access-history pagination is loosely validated:** `/api/access-history` accepts any finite `limit`
  (including fractions such as `1.5`, which PostgreSQL rejects with a 500) and uses `OFFSET` plus a full
  `count(*)` on a growing audit table. Validate integers, cap the limit in the route, and use keyset paging.
- **V49 The camera phone does two requests every 30 seconds forever:** the heartbeat loop calls
  `motionSettings` after every heartbeat even though settings rarely change. Use change notification over
  the signaling socket or an ETag.
- **V50 No resume after a reboot or process kill:** the manifest has no boot receiver, so a camera that loses
  power stays offline until someone opens the app. Android 14 restricts starting camera foreground services
  from boot, so a notification asking to resume may be the only option. **Verify** on Android 14+ and make the
  offline alert say what to do.
- **V51 Guest links are easy to lock out and the token stays visible:** `/api/guest/enter` allows 10 entries per
  link per hour, and every page load of `/g/<token>` (including a TV reloading the Cast receiver) re-enters,
  so a link shared with a family can stop working for an hour. The token also stays in the address bar and
  history after the cookie is set; replace the URL with `history.replaceState` after entering.
- **V52 Clips from a removed camera source disappear (Verify):** `deleteCamera` soft-deletes the source and the
  library lists only recordings for cameras returned by `listCameras`, so existing clips (still in Drive)
  vanish from the library and can no longer be played or deleted. Keep removed sources visible to the
  recordings queries.
- **V53 Drive access tokens are never cached, and clip and thumbnail files share a name:** `DriveHealth` refreshes
  a Google token on every playback, upload and deletion, and clips and thumbnails are both named
  `Beacon-recording-<id>.beacon` with identical `appProperties`, which confuses the owner's Drive listing and
  weakens the file verification. Cache tokens until shortly before expiry and give thumbnails a distinct
  name and property.
- **V54 Desktop notes:** the desktop sign-in script is documented as running in an isolated world but
  `executeJavaScript` runs in the page's main world; the shell grants camera and microphone to the app
  origin with no prompt on Windows and Linux, so any script injection on `beacon.builtbysai.com` (a reason F2's
  CSP matters more than usual) reaches the camera and microphone silently.
- **V55 Event socket reconnect has no jitter:** the web hook backs off 1, 2, 4 … 15 seconds without jitter, so
  every open admin tab reconnects together after a server restart.
- **V56 Many request schemas are not strict:** `registerDeviceSchema`, `cameraSourceSchema`,
  `browserDeviceSchema`, `updateDeviceSchema` and others silently accept unknown fields, and
  `capabilities` is an unbounded record. Use `.strict()` and bound key counts and string lengths.
- **V57 A keystore failure looks like "never paired":** `CredentialStore.read()` returns `null` on any
  decryption error, so a lost or invalidated key shows the pairing screen with no explanation and no log
  line. Log the error class and show a clear recovery message.
- **V58 Several single-use secrets live in process memory:** Android and desktop Google handoff codes,
  pending Google links and rate-limit counters are lost on every restart, and the desktop handoff map is only
  swept when a new code is issued. Fine for one instance; store them in PostgreSQL before running two.
- **V62 The disabled smart-detection experiment still ships MediaPipe:** the dependency
  `com.google.mediapipe:tasks-vision` is always compiled in even though `SMART_DETECTION_ENABLED` defaults to
  false. In the build output on disk, `libmediapipe_tasks_jni.so` is about 11 MB on arm64 (about 16 MB on x86_64),
  the same size as the WebRTC library, the unsigned release APK is about 117 MB, and `classes.dex` is about 30 MB
  because shrinking is off. Older, low-storage phones pay for a feature nobody can use. Put the experiment
  behind a build flavor or separate module and build per-ABI AABs with R8.
- **V63 Record-on-motion does nothing without Drive and says nothing:** `recordOnMotion` is documented as
  "silently skipped (not an error)" when the owner has no recording-scoped Drive connection, so a camera that
  looks set up produces no clips. **Verify** that the setup health check and the camera settings warn
  about it.
- **V64 Time-zone validation may reject legacy names:** `isIanaTimeZone` accepts only values in
  `Intl.supportedValuesOf('timeZone')`. Browsers and phones can report older aliases (for example
  `Asia/Calcutta`, `America/Buenos_Aires`) that this list may not contain, which would make saving quiet
  hours or a Home/Away schedule fail with an unexplained validation error. **Verify** against the zones real
  clients report; accept aliases by trying `new Intl.DateTimeFormat(…, { timeZone })`.
- **V65 Web live view rebuilds the connection instead of repairing it:** after 8 seconds in the WebRTC
  `disconnected` state the viewer calls `fail`, tears down and reconnects the whole session, rather than
  attempting an ICE restart. Combined with V21 and V29 it means a short network change always costs a full
  renegotiation.
- **V69 The password-reset form says "sent" even when it was not:** `AuthScreen` swallows every error from
  `/api/auth/password-reset/request` and always shows the sent state, but the server answers `503` when email is not
  configured and `429` when rate limited (a global limit behind the proxy, F1). Users wait for an email that will never
  come. Show a neutral "try again later" for 429 and 503 without revealing account existence.
- **V70 Android snapshots go to the shared photo library:** `LiveViewControls` saves live-view snapshots to
  `Pictures/Beacon` through MediaStore, where other apps with photo access and the user's cloud photo backup see
  them. The UI says where they are saved; consider app-private storage with an explicit share action, or a clear
  warning about backup.
- **V71 Video is fixed at 640 by 480 at 24 frames per second:** the camera service calls `startCapture(640, 480, 24)`
  for every device, and every frame is copied on the CPU into a new `JavaI420Buffer`. There is no quality
  choice for viewers who want HD or for devices that can do more, and the per-frame allocation costs older phones.
- **V72 Clip recording can be silently unavailable:** the capturer binds a third concurrent stream for recording and,
  when the camera hardware cannot, quietly runs without it (`clipRecordingAvailable` is never read). Older
  phones, the target devices, then fail every clip with `capture_failed` and the owner gets no up-front warning.
  Show this in device health and in the record-on-motion setting.
- **V73 Android account deletion has no re-authentication step:** the server requires a sign-in within the last ten
  minutes, the Android app never calls `/api/account/reauth`, so deletion works only soon after signing in and
  otherwise returns an instruction to sign in again. The confirmation dialog also does not say that other members
  lose access or that clips remain in Drive (V42). In-app account deletion is a Play policy expectation.
- **V74 The restore drill proves the schema, not the data:** `restore-verify.sh` checks that migration rows and
  public tables exist after `pg_restore`; it compares no row counts or checksums with the source and has no wrapper
  that invokes it from the backup container's entry point.
- **V75 LAN development mode exposes services with a known secret:** `Start-BeaconLanDev.ps1` binds the backend and
  Vite to `0.0.0.0` and sets the published TURN secret `local-development-turn-shared-secret`; anyone on the same
  network can obtain relay credentials while it runs. Keep it dev-only and say so in the output.
- **V76 Small web details:** the sign-in page's "Back to Beacon" calls `history.back()`, which leaves the site
  when the page was opened directly; the `googleSignIn` query stays in the address bar so a reload repeats the alert;
  the Cast hook revokes its guest link when the camera view unmounts without resetting the "casting" state; and the
  Cast sender framework from `gstatic.com` runs inside the app origin (allow it in the CSP and keep it off pages that
  do not need it).
- **V77 Secrets are copied to the clipboard without the sensitive flag:** pairing codes, invitation tokens and share
  links use `LocalClipboardManager.setText`, which on Android 13 and later shows the text in the clipboard preview and
  offers it to keyboards. Set the sensitive-content extra for these.
- **V78 Android thumbnails can delete each other (Confirmed by reading; Verify on a device):**
  `downloadRecordingThumbnail` removes every `beacon-thumb-*` file in the cache directory before it writes its own, and the
  clip list starts one download per visible row concurrently. A sibling's cleanup can delete another row's decrypted
  image before it is decoded, so thumbnails appear and vanish at random. This is the same shared-prefix cleanup as V44.
- **V79 The Activity timeline merges two independently paged feeds:** `MotionEventList` loads motion events by cursor and
  household events by offset, appends both on "Load more" and sorts the combined list on the client. At a page boundary
  one feed can be several pages ahead of the other, so older events from the slower feed are missing or appear out of order
  until more pages load, and new events arriving between requests shift the offset feed (duplicates are filtered by id,
  skips are not). The reported total comes only from the household feed.
- **V80 Some on-screen claims do not match the product:** the Android welcome card shows "HD · 1080p" while capture is fixed at
  640 by 480 (V71); the pairing screen tells a first-time user to "open this camera and choose Reconnect" in the viewer;
  the Android sharing panel's header comment says per-camera grants are not implemented although the screen edits them;
  the `PRIVATE ALPHA` pill is still shown; and the phone calls every device "Android Camera" when it pairs. Marketing and
  trust copy is a legal and Play-review concern, so these are worth a pass.
- **V81 Small client robustness points:** `NotificationSettings.installationId()` reads and writes `localStorage` without a
  guard (other modules wrap it), so blocked storage can break the settings page; Android pairing saves the credential with an
  asynchronous `apply()` right after the server consumed the code, so a process kill in that moment leaves a registered but
  unpaired device behind; the Android admin list shows "Remove" for any non-owner member including another admin, which the
  server then refuses; the QR bitmap is drawn pixel by pixel on the main thread (about 230,000 `setPixel` calls).
- **V82 Android sign-in fields do not set a keyboard or autofill type (Verify):** the email and password
  `OutlinedTextField`s in `MonitorAuthScreen` have no `KeyboardOptions` (no email or password keyboard type) and no
  autofill semantics. Without the password keyboard type a keyboard may suggest or learn the typed password, and
  password managers cannot offer to fill or save it. **Verify** on a device with a third-party keyboard.
- **V83 One bad value in motion settings silently turns motion detection off (Verify):** the camera parses its settings
  from the server with strict constructors. `QuietHours` calls `ZoneId.of(timeZone)`, which throws for a zone the phone's
  time-zone database does not know (the backend validates against the server's newer list), `MotionSettings` uses
  `require`, and `motionSettings()` throws on an unknown sensitivity. The exception is caught in the heartbeat loop and
  logged as `motion_settings_sync_failed`; the phone keeps its previous map, or none, and falls back to
  `MotionSettings(enabled = false)`. An older app against a newer server, or one odd zone name, therefore stops motion
  alerts for that camera with no visible error.
- **V84 Confirmed design behind V40:** `retainCredentialAfterHeartbeat` in `DeviceCredentialRepository.kt` is the helper
  that implements "a heartbeat that is not accepted clears the credential", and `BeaconApi.heartbeat` returns `false` for
  both 401 and 403, so the erase-on-403 behavior is intentional code, not an accident.
- **V85 More privacy detail in snapshot file names:** `snapshotFileName` puts the camera name and the timestamp in the file
  name saved to the shared gallery (for example "Beacon Nursery 2026-10-09 14-02-11.png"), which cloud photo backup and
  other apps then see (see V70).
- **V86 An offline camera's "Review" action can open live view:** in `MonitorCameraCard` the "Review ›" link uses
  `onSettings ?: onView`, so where no settings handler is supplied (for example the Favorites list) it starts a live view of a
  camera that is offline or in privacy mode, which then fails through the close-code path described in V67.
- **V87 The Android Drive card cannot say "reconnect":** it shows only "Not connected… connect from the web app", so an
  expired connection (the seven-day testing-mode expiry the handoff mentions) looks the same as never having connected.
- **V88 Settings copy overstates privacy detail:** the Android Privacy section says session and access history is shown
  "without a device fingerprint", while the Security section lists each signed-in device by its stored user-agent text.
- **V89 Web clip bookmarks only grow:** bookmarks are kept in `localStorage` (up to 500 ids) and never pruned when a clip is
  deleted by someone else or expires, so a long-lived account can hit the cap with stale entries and be told to remove a
  bookmark it cannot see.
- **V18 Android keep-running behaviour:** the camera service uses `stopWithTask="false"`
  so capture continues after the app task is swiped away. A foreground notification and
  the privacy gate cover this by design; keep a device test for "swipe away, then
  privacy on" so the stop path stays covered.

## 3. Finding index

| ID                                                                   | Severity        | Summary                                                               |
| -------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------- |
| V19                                                                  | High            | Deep link or file enrolls a computer's camera and mic unconfirmed     |
| V1                                                                   | High            | Android Google sign-in code has no PKCE                               |
| V2                                                                   | High            | Unsigned desktop updates from same-server feed                        |
| F1                                                                   | High            | `trustProxy` missing; all IP limits global                            |
| F2                                                                   | High            | No security headers or CSP (Cast needs `frame-ancestors 'self'`)      |
| F3                                                                   | High (Verify)   | TURN allows private-range peers; relay unproven                       |
| V20                                                                  | Medium          | No viewer cap or message-rate limit on live view                      |
| V21                                                                  | Medium (Verify) | TURN credentials expire in 10 minutes; no renewal or ICE restart      |
| V22                                                                  | Medium          | Device credentials never expire, rotate or record use                 |
| V23                                                                  | Medium          | Password-reset timing leak; email calls have no timeout               |
| V24                                                                  | Medium          | Android Play policy, old toolchain, no Gradle dependency scan         |
| V29                                                                  | Medium          | Web live view stops retrying after about 30 seconds                   |
| V30                                                                  | Medium          | Clips encrypted and processed whole; memory and storage spikes        |
| V31                                                                  | Medium          | Superuser DB role, no container limits, missing env template key      |
| V32                                                                  | Medium          | New viewers see every existing camera by default                      |
| V40                                                                  | Medium          | Camera phone erases its pairing on any 401 or 403                     |
| V41                                                                  | Medium (Verify) | Remote viewer can resume capture after a local pause                  |
| V42                                                                  | Medium          | Deletes orphan Drive clips; clips never expire; no ownership transfer |
| V43                                                                  | Medium          | Viewer and guest roles get no live updates or alerts                  |
| V44                                                                  | Medium          | Android clip cache collision and leftover plaintext                   |
| V59                                                                  | Medium          | A clip is lost if its upload fails once; no retry queue               |
| V60                                                                  | Medium (Verify) | Android AES-GCM probably buffers whole clips in memory                |
| V61                                                                  | Medium          | Motion detection is coarse; false alerts and misses likely            |
| V66                                                                  | Medium          | Android monitor polls every second while watching                     |
| V67                                                                  | Medium (Verify) | Android WebSocket close codes never reach handlers                    |
| V68                                                                  | Medium          | Monitor misses disabled backups; runs from a different tree           |
| V3                                                                   | Medium          | Unhandled promise on public share-link route can crash the process    |
| V4                                                                   | Medium          | Session lookup writes on every request                                |
| V5                                                                   | Medium          | No purge of expired sessions, tokens, links                           |
| V6                                                                   | Medium          | Server sees recording key; not end-to-end encrypted                   |
| V7                                                                   | Medium          | Crypto envelopes lack key id and AAD                                  |
| V8                                                                   | Medium          | Push endpoint SSRF                                                    |
| V9                                                                   | Medium          | Pairing limiter keyed by client-chosen id                             |
| V10                                                                  | Medium          | Deploy: no rollback, builds on prod, no pruning                       |
| V11                                                                  | Medium          | Backup excludes encryption keys                                       |
| F4                                                                   | Medium          | Backend container root, build tooling                                 |
| F7                                                                   | Medium          | Android release not shippable                                         |
| F8                                                                   | Medium          | Oversized source files                                                |
| F5, F6, F9–F13, V12–V18, V25–V28, V33–V39, V45–V58, V62–V65, V69–V89 | Low             | See section 2.3                                                       |

## 3.1 Test coverage gaps behind the main findings

The suites pass, but none of them would have caught the high-severity findings, and in two places a test
describes the unsafe behavior as intended. This is guidance for the smallest useful regression tests under
`docs/testing-policy.md`, not a request for more tests in general.

| Finding                                          | What exists                                                                                                                                                                                                                                  | What is missing                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 client IP                                     | `rate-limit.test.ts` (limiter only)                                                                                                                                                                                                          | Nothing exercises `request.ip` behind a proxy or a forged `X-Forwarded-For`; the probe in section 1.1 is the first check                      |
| V19 / V19b deep-link and QR pairing              | `camera-setup.test.ts`, `launch-inputs.test.ts`, `PairingQrTest.kt`, web auto-start tests                                                                                                                                                    | These assert that a valid link parses and starts setup; none asserts a confirmation, so the tests encode the current no-confirmation behavior |
| V40 credential loss                              | `DeviceCredentialRepositoryTest.kt`, `PrivacyGateTest.kt`                                                                                                                                                                                    | No test that a 403, or a single 401, leaves the stored credential alone                                                                       |
| V3 share-link touch                              | `recording-routes.integration.test.ts`                                                                                                                                                                                                       | No case where `touchRecordingShareLinkAccess` rejects                                                                                         |
| V9 pairing limiter                               | `device-registration-rate-limit.integration.test.ts` (per-household cap, a new `installationId` each call)                                                                                                                                   | Nothing asserts the per-IP key cannot be bypassed by changing `installationId`                                                                |
| V20 viewer cap                                   | `signaling.test.ts`, `signaling.integration.test.ts`, `signaling-authorization.test.ts`                                                                                                                                                      | No multi-viewer cap or message-rate test                                                                                                      |
| V21 TURN lifetime, V65 rebuild instead of repair | **Fixed in code, not yet proven on two networks.** A dropped connection asks for an ICE restart; the server sends fresh relay credentials to both ends and the camera offers again; the old 8 second rebuild stays as the fallback. ADR 0112 | backend, web viewer and web producer tests; Android compiles                                                                                  | pending |
| V4 / V5                                          | Auth and store integration tests                                                                                                                                                                                                             | No test of write counts per read or of expired-row purging                                                                                    |

## 4. What looked sound

Hashed session tokens; double-submit CSRF bound to a stored hash; Argon2id with a dummy-hash
login path; constant-time comparisons; strict Zod schemas; log redaction; authenticated,
origin-checked and re-authorized signaling; guest and share links that are hashed, scoped,
expiring and revocable with uniform failure responses; owner-only share-link creation;
background jobs that catch their own errors; Android Keystore-wrapped credentials,
`allowBackup=false`, cleartext disabled, and a privacy gate that persists a pending pause
across restarts; Electron context isolation, sandbox, no Node integration, fuses set,
navigation allowlist and a permission handler; no secrets or build output in git; CI with
dependency audit, SBOM and history secret scan.

## 5. Remediation plan

Nothing has been started. Each step is a separate approved change with tests and, where
significant, an ADR.

| #   | Work                                                                                                                | Findings         | Size   |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| 1   | Camera/mic enrollment confirmation for deep links, files and installer tokens; no silent autostart or open-at-login | V19              | Small  |
| 2   | `trustProxy` for the Caddy hop; re-key limiters; test spoofed header                                                | F1, V9           | Small  |
| 3   | Fix the floating promise; add process-level rejection handlers                                                      | V3               | Small  |
| 4   | Live-view viewer caps, ICE message limits, per-guest concurrency                                                    | V20              | Medium |
| 5   | Android PKCE; prefer verified App Link                                                                              | V1               | Small  |
| 6   | TURN peer-range denial and quotas; real two-device relay test                                                       | F3               | Small  |
| 7   | Security headers and CSP (report-only first); Cast exception; self-host font                                        | F2, V12          | Medium |
| 8   | Push endpoint allowlist and SSRF guard                                                                              | V8               | Small  |
| 9   | Session read plus throttled touch; purge job and expiry indexes                                                     | V4, V5           | Medium |
| 10  | Backend image: prod-only, non-root, read-only, health check                                                         | F4               | Small  |
| 11  | ICE refresh and restart; forced-relay test longer than the credential TTL                                           | V21              | Medium |
| 12  | Key id and AAD for envelopes; key-escrow and restore runbook; confirm E2EE wording                                  | V6, V7, V11      | Medium |
| 13  | Deploy rollback, pruning, explicit disabled state                                                                   | V10              | Medium |
| 14  | Device-credential last-used and rotation; reset-email timing and timeouts                                           | V22, V23         | Medium |
| 15  | Windows code signing and signed update manifest (owner purchase decision)                                           | V2               | Large  |
| 16  | Android release readiness, Play policy, toolchain and Gradle dependency scan                                        | F7, V24          | Large  |
| 17  | Dependency updates; scheduled full audit                                                                            | V16              | Small  |
| 18  | Web live-view reconnect: capped indefinite backoff while visible; outage test                                       | V29              | Small  |
| 19  | Production Compose: app/migrator DB roles, container limits and hardening, env template key                         | V31              | Medium |
| 20  | Chunked clip format for bounded-memory and progressive playback; interim size cap                                   | V30              | Large  |
| 21  | Bundle splitting; file splits; documentation reconciliation; merge or discard stale branches                        | F8–F12, V15, V17 | Large  |
| 22  | Owner decision: start new viewers with no cameras instead of all                                                    | V32              | Small  |
| 23  | Android: stop erasing credentials on a single 401 or 403; add a server revoked-credential code                      | V40              | Small  |
| 24  | Decide local-pause semantics and implement (owner-only remote resume, notification, delay)                          | V41              | Small  |
| 25  | Delete Drive files before cascades; clip retention; ownership transfer; Drive revoke after delete                   | V42              | Medium |
| 26  | Camera-scoped events and an alert opt-in for viewers, or document the limit                                         | V43              | Medium |
| 27  | Separate Android clip directories and sweep stale files                                                             | V44              | Small  |
| 28  | Android pairing confirmation: name the household, never pair from an intent or link without a tap                   | V19b             | Small  |
| 29  | Durable clip upload queue with retry and Drive session resume                                                       | V59              | Medium |
| 30  | Test AES-GCM memory on a low-memory phone; adopt chunked format                                                     | V60, V30         | Large  |
| 31  | Improve motion detection and measure false alerts on real devices                                                   | V61              | Medium |
| 32  | Move the smart-detection experiment out of the shipped app; per-ABI AAB with R8                                     | V62              | Medium |
| 33  | Replace one-second Android polling with a slow single-flight poll or a realtime channel                             | V66              | Small  |
| 34  | Implement onClosing on Android sockets; distinct close codes; tests for each                                        | V67              | Small  |
| 35  | Monitoring: alert on disabled or stale backups, daily repeats, jq JSON, one release path                            | V68              | Small  |
| 36  | Password-reset UI states; Android re-auth screen and deletion wording                                               | V69, V73         | Small  |
| 37  | Device health: clip availability, quality choices, snapshot storage, clipboard flag                                 | V70–V72, V77     | Medium |

Steps 1–8 (V19, F1/V9, V3, V20, V1, F3, F2/V12, V8) and steps 23 (V40) and 28 (V19b) should precede any wider release. Step 1 comes
first because it is a consent bypass for camera and microphone capture.

## 6. Decisions needed from the owner

1. Approve the first eight steps as the next hardening milestone, starting with the desktop enrollment confirmation (V19).
2. Decide whether Windows code signing is funded now or desktop auto-update is limited to
   the owner's machines until it is (V2).
3. Confirm the not-end-to-end-encrypted recording design is acceptable, and that all
   product and legal copy says so (V6).
4. Accept or change the registration hint trade-off (F6).
5. Confirm whether `deploy-web.yml` should stay disabled and make that explicit (V10).
