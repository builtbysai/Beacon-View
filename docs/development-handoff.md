# Beacon SecureView development handoff

Updated September 11, 2026. This is the shortest reliable orientation for a new
development session. GitHub is canonical; the maintained local checkout is
`C:\Dev\Beacon-SecureView`.

## Most recent work (September 11, 2026)

The active local branch is `codex/android-experience-overhaul` and contains a large,
intentional, uncommitted continuation spanning the Android experience rebuild, web UI,
backend maintainability boundaries, owned-domain cutover, and notification foundation.
Do not discard, reset, or replace this working tree. Review `git status` and the focused
diff before editing overlapping files.

Firebase project `beacon-view-158ad` now has Android package
`com.beaconsecureview.camera` registered and FCM HTTP v1 enabled. The downloaded
`google-services.json` is installed locally, validated, and ignored by Git. Android uses
the official Google services plugin and Firebase BoM; FCM automatic initialization is
disabled until an authenticated notification-consent workflow exists. The Firebase build
passed Android unit tests and was update-installed on Pixel 7a `34171JEHN07672` at
20:38, preserving app data. No server sender credential or VAPID private key has been
created. Continue from ADR 0043 and [firebase-notifications-setup.md](firebase-notifications-setup.md).

The production domain is `https://beacon.builtbysai.com`. Cloudflare DNS, Caddy TLS,
Google OAuth redirect configuration, and Resend DNS verification are complete. The
latest maintainability/Firebase working-tree changes have not been committed, pushed,
or deployed.

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
- A successful CI run for a push to `main` triggers the protected
  `Deploy web to Oracle` workflow.
- Deployment is web-only. It uploads the validated web artifact to the Oracle
  VM and checks the local HTTPS `/health` and `/ready` endpoints.
- Canonical private-alpha URL: <https://beacon.builtbysai.com>
- Domain cutover release: `domain-20260911-153201`; the former temporary hostname is
  intentionally unsupported. Existing native installations need a canonical-domain
  build.
- Deployment details and rollback boundaries: [github-web-deployment.md](github-web-deployment.md)

The repository does not contain production credentials. Keep application secrets
on the VM in `/etc/beacon/production.env`; GitHub's `production` environment
contains only the deployment SSH values (`ORACLE_HOST`, `ORACLE_USER`,
`ORACLE_SSH_PRIVATE_KEY`, and `ORACLE_KNOWN_HOSTS`). Never commit `.env` files,
Android signing material, certificates, screenshots, build output, or
`.beacon-dev` artifacts.

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

The web viewer currently has no committed web manifest or service-worker
registration. It is a responsive HTTPS viewer, not an installable PWA yet; treat
PWA install, offline caching, update behavior, and service-worker security as a
separate explicitly scoped change.
