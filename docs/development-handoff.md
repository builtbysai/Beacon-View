# Beacon SecureView development handoff

Updated September 14, 2026. This is the shortest reliable orientation for a new
development session. GitHub is canonical; the maintained local checkout is
`C:\Dev\Beacon-SecureView`.

## September 12 interface-reliability follow-up

The owner approved a bounded follow-up after the Chrome Web Push baseline: modernize
the existing web sidebar without installing shadcn, keep the collapsed account menu's
Trust & privacy and Sign out actions reachable, restructure notification settings, and
make Android camera disconnect available whether capture is live or paused.

The web sidebar now has a sticky header/footer, independently scrollable navigation,
icon-collapse rail, `Ctrl`/`Cmd`+`B` toggle, active-state treatment, portal-rendered
tooltips, and a portal-rendered account menu that cannot be clipped by the collapsed
shell. Notification settings now separate browser delivery status from responsive
per-camera alert cards, use switch controls, expose unsaved state, and avoid redundant
saves. No component framework was added.

Android now exposes Disconnect beside Pause and in the overflow menu, confirms the
destructive action, clears the local device credential before stopping the foreground
capture service, and performs server removal as best-effort cleanup. This prevents a
network failure from leaving the phone capturing or able to restart with the old
credential. The Pixel currently reports that its previous camera device was already
removed, so final physical confirmation requires pairing it again; do not pair or
disconnect it implicitly.

The following reliability batches are also complete in the working tree. ADR 0046 adds
an eight-second WebRTC disconnect grace and counts only device-confirmed viewers, with
immediate household presence refreshes. Release `connection-reliability-20260912-2107`
is live and a real Chrome-to-Pixel TURN view remained stable until intentional exit.
ADR 0047 adds an Android battery-restriction warning/settings link and a notification
**Pause camera** action without adding a background resume path. The installed Pixel
build remained a foreground camera/microphone service and served a TURN viewer while its
Activity was backgrounded.

Validation: all 101 web tests pass, the Vite production build succeeds, ESLint and
`git diff --check` are clean, and the isolated responsive audit passes 134 captures
without page errors, unexpected API calls, horizontal overflow, or clipped controls.
Android `testDebugUnitTest` plus `assembleDebug` succeeded, and the debug APK was
update-installed on Pixel `34171JEHN07672` without clearing app data. The historical
web-only release `ui-20260912-2049` is live; `/health`, `/ready`, deployed asset hashes, and the
real Chrome rendering were verified. A rollback image was retained as
`beacon-web-rollback:ui-20260912-2049`.

## Most recent work (September 12, 2026)

The Codex continuation branch is `codex/notification-transport-v1`, created from the
detached worktree at `eb1947e` while `codex/android-experience-overhaul` remains checked
out in `C:\Dev\Beacon-SecureView`. It collects the intentional continuation spanning
the Android experience rebuild, web UI, backend maintainability boundaries,
owned-domain cutover, notification transport, and household sharing. Review branch
history and `git status` before editing overlapping files.

Firebase project `beacon-view-158ad` now has Android package
`com.beaconsecureview.camera` registered and FCM HTTP v1 enabled. The downloaded
`google-services.json` is installed locally, validated, and ignored by Git. Android uses
the official Google services plugin and Firebase BoM; FCM automatic initialization remains
off until the authenticated user explicitly enables notifications. The Firebase build
passed Android unit tests and was update-installed on Pixel 7a `34171JEHN07672` at
20:38, preserving app data. A dedicated `beacon-fcm-sender` service account now has only
the Firebase Cloud Messaging API Admin project role. Its owner-confirmed JSON key and a
separate VAPID/application-key file are in a user-private local secrets directory outside
this repository. Root-only production copies are installed on Oracle; the sender
credential is bind-mounted read-only into the backend container.

Notification Transport v1 is implemented and deployed to the Oracle private alpha
(ADR 0044): current Firebase
Installation ID registration, standards-based Web Push, session-bound subscription
lifecycle, envelope-encrypted provider identifiers, default-off per-camera preferences
and quiet hours, transactional motion outbox, bounded retry/dedup, generic payloads, and
offline/recovery transitions after the existing 90-second presence window plus a
120-second grace. Migration 0014, the notification-enabled backend, and the matching web
and service-worker build were deployed on September 12 after a fresh encrypted backup.
Health/readiness, authenticated route protection, all five tables, read-only credential
mounting, empty initial subscription/outbox state, deployed asset hashes, and clean
startup logs passed. Chrome on Windows was opted into Web Push for `Android Camera`, with
motion and offline/recovery preferences enabled. A controlled Pixel app stop/restart
produced one motion, one offline, and one recovery event; all three provider deliveries
succeeded with zero failed or pending rows, and the Pixel returned to Online. Native FCM,
unsubscribe, quiet-hours, invalidation, and lock-screen acceptance remain open. Clean
and repeated local migrations plus all 118
backend tests pass against a dedicated PostgreSQL 18 database in Ubuntu WSL, including
all 37 integration cases; Docker Desktop remained unavailable because of a protected
stale runtime socket. Android unit tests pass using the validated ignored Firebase client
configuration copied through the repository installer. The current production-targeted
debug build passed unit tests and was update-installed on Pixel 7a `34171JEHN07672` at
15:01 on September 12, preserving app data; it launches in camera mode, reports online,
and has no crash-level startup log entries. Continue from ADRs 0043–0044 and
[firebase-notifications-setup.md](firebase-notifications-setup.md).

The production domain is `https://beacon.builtbysai.com`. Cloudflare DNS, Caddy TLS,
Google OAuth redirect configuration, and Resend DNS verification are complete. The
notification backend and current web build were manually deployed from the continuation
before its later sharing work. Public SSH
is closed; use `ssh beacon-oracle` over Tailscale for administration. The tailnet now
defines `tag:ci`, restricts it to the Oracle tailnet address on TCP 22, and contains deny
tests for the Oracle web port and the maintainer's Windows SSH port. A GitHub OIDC trust
credential restricted to this repository's `production` environment, the `auth_keys`
scope, and `tag:ci` is configured, and its client ID and audience are in the GitHub
`production` environment. The private deployment workflow still awaits merge to `main`
and therefore has not run in GitHub Actions yet.

## Earlier work (September 10, 2026)

A third product/UX pass landed and deployed: PR #14, "Third product/UX pass:
camera-first simplification" (merged to `main` as `cb3b1bb`). Devices is no
longer a user-facing nav destination — one host device is presented as one
Camera, with the backend's device/camera-source split unchanged underneath.
The Live Viewer was rebuilt as a true full-bleed immersive stage (it had been
rendering as a small card in empty page background — check this doesn't
regress if `.live-shell` or `LiveVideo.tsx`'s top-level wrapper changes). An
Android Chrome tap-highlight bug on the bottom nav was fixed
(`-webkit-tap-highlight-color`). Access History now groups repeated live-view
attempts by a real server-recorded `audit_events.viewer_session_id`
(migration `0013_audit_events_viewer_session.sql`, applied to both the local
and Oracle databases) instead of guessing from timestamps.

Full write-up of what changed, what was deliberately left out, and why, is in
the session transcript and PR #14's description — not duplicated here to keep
this doc short. Known follow-ups not done in that pass:

- `CameraFlipButton` (source-switch control) is wired into Camera Settings
  but not yet into the Live Viewer or `BrowserCameraMode`'s source picker.
- The overflow menus (camera tile, Live Viewer) are keyboard-reachable but
  don't implement full ARIA menu roving-tabindex semantics.
- Visual QA this pass was real but targeted (mobile portrait/landscape,
  desktop for one fix), not the full viewport × state matrix from the
  original brief.
- Note for the next session: the `resize_window` browser tool did not
  actually resize the window in this environment (silently no-op'd); the
  working alternative was a same-origin `<iframe>` sized to the target
  viewport, injected via `javascript_tool`, with clicks/zooms targeted using
  real DOM `getBoundingClientRect()` coordinates rather than guessed pixel
  math against the outer screenshot's own (scaled) coordinate space.
- Note on migrations: this repo's `drizzle/meta/` does not keep intermediate
  snapshot JSON files, only `_journal.json` and the SQL files themselves. A
  bare `drizzle-kit generate` therefore has nothing to diff against and will
  emit a full "recreate every table" migration — hand-write the minimal
  `ALTER TABLE`/`CREATE INDEX` instead (see `0013` for the pattern), and
  never apply a freshly generated migration to a database with existing data
  without reading it first.

## Current source and deployment

- Repository: `builtbysai/Beacon-SecureView`
- Active local branch should be a new `codex/*` feature branch, never `main`.
- Pull requests target `main`; required CI must pass before merge.
- Once the current workflow change is reviewed and merged, a successful CI run for a
  push to `main` triggers the protected `Deploy Beacon to Oracle` workflow.
- Deployment uploads the validated source, applies migrations, restarts the backend
  and web services, and checks the local HTTPS `/health` and `/ready` endpoints.
- Canonical private-alpha URL: <https://beacon.builtbysai.com>
- Domain cutover release: `domain-20260911-153201`; the former temporary hostname is
  intentionally unsupported. Existing native installations need a canonical-domain
  build.
- Deployment details and rollback boundaries: [github-web-deployment.md](github-web-deployment.md)

The repository does not contain production credentials. Keep application secrets
on the VM in `/etc/beacon/production.env`; GitHub's `production` environment contains
the deployment SSH values plus `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`. The legacy
`ORACLE_HOST` secret remains stored but is not read by the private-hostname workflow.
Never commit `.env` files, Android signing material, certificates, screenshots, build
output, or `.beacon-dev` artifacts.

## Local setup

Required tools:

- Node.js 22.13+ within Node 22
- pnpm 11.9.0
- Docker Desktop with Compose
- JDK 17 and Android SDK 35 for Android work

From `C:\Dev\Beacon-SecureView`:

```powershell
pnpm install --frozen-lockfile
.\Start-Beacon.ps1
```

The launcher creates ignored local configuration, starts PostgreSQL and Coturn,
applies migrations, starts the HTTPS/WSS development services, and opens the
viewer. Stop and validate with:

```powershell
.\Stop-Beacon.ps1
.\Test-Beacon.ps1
```

For focused work, use the command matrix in [local-development.md](local-development.md),
[quick-start.md](quick-start.md), and [testing-plan.md](testing-plan.md).
Android hardware testing uses the Pixel serial `34171JEHN07672`; preserve its
app data and do not clean-install without explicit approval.

## Safe continuation prompt

```text
Work in builtbysai/Beacon-SecureView from the existing working tree on
codex/android-experience-overhaul. Preserve all current uncommitted changes.
Goal: <one concrete outcome>
Scope: <files/features allowed to change>
Preserve authentication, authorization, capture visibility, privacy mode,
pairing, and media behavior unless explicitly included above.
Do not redesign unrelated pages or work on main. Create codex/<short-name>,
run relevant checks, review the diff, push the branch, and summarize risks and
manual checks needed before merge.
```

Codex and Claude can work against the same GitHub repository, but each coherent
change should have one branch and one pull request. Resolve conflicts by syncing
with `main`; do not use the old OneDrive checkout.

## Product guardrails and next work

Read [AGENTS.md](../AGENTS.md), this handoff, and [roadmap.md](roadmap.md)
before planning. Any device with a camera and internet access should
eventually be able to become a Beacon camera; Android is the current
implementation path with the most native reliability (foreground capture,
background operation), not the product's identity. Do not add or restore
Android-only framing in product copy, architecture, or docs. The product is a
responsive web viewer, Fastify/PostgreSQL backend, WebRTC signaling,
STUN/TURN, visible capture controls, privacy mode, pairing, authentication,
and media behavior. Recording, facial recognition, biometric storage,
customer-media AI training, subscriptions, ads, and cross-platform native
clients remain outside current scope.

Three UI/UX passes have now landed (responsive/design audit, deeper visual
QA, camera-first simplification — see "Most recent work" above for the
latest). Further page-by-page redesign should still be scoped explicitly
per session rather than done opportunistically; it is no longer a
categorically deferred area, but it is also not open-ended standing
permission. The most useful other open evidence work is physical Android
privacy/recovery and
media acceptance, backup-restore proof, domain/email identity, security/release
review, legal/trust review, accessibility, and capacity measurements. See N1–N9
in [roadmap.md](roadmap.md); completing a roadmap entry still requires its stated
owner approval and evidence.

## Useful file map

- `apps/web-viewer` — React/Vite viewer and PWA behavior
- `apps/backend` — Fastify API, auth, pairing, signaling, persistence
- `apps/android-camera` — Kotlin/Compose CameraX/WebRTC camera and monitor app
- `packages/shared-types` — shared contracts
- `infrastructure` — local PostgreSQL/Coturn and Oracle deployment material
- `docs/architecture.md` and `docs/threat-model.md` — runtime and security boundaries

Migrations 0015/0016 and ADR 0048 add the household-sharing authorization
foundation. Selected-household sessions,
grant-filtered inventory/signaling, source-enforced Listen, hub-enforced Talk,
admin-only household-wide reads/events, safe account deletion, immediate socket
teardown, and the web household selector are implemented locally. The full SQL
sequence applies on a clean PostgreSQL 18 database; the Windows
Drizzle/integration runner cannot currently reach that WSL-only PostgreSQL port.
The local authenticated API now implements invitation acceptance,
member/invitation inventory, per-camera grant replacement, and revocation with
audit and immediate socket teardown. Its 16-case PostgreSQL integration suite
passes through a temporary local bridge (stopped after testing). The web settings
UI implements manual-code invitation creation/acceptance, member and pending-
invitation revocation, and independent View/Listen/Talk grants. Next: complete
physical multi-account acceptance and security review, add transactional email
only after sender readiness, then deploy migrations/backend/web together.

The web viewer now includes a manifest and service worker for installable,
background-capable notification behavior. Treat broader offline media caching as
separate scope; live camera viewing still requires the network and authenticated
backend services.
