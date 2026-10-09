# Beacon SecureView

Beacon SecureView is a device-agnostic camera platform. Android devices and
attended HTTPS browsers can produce video; responsive browsers can view it; and
one device may expose several independently named camera sources.

Beacon SecureView is an Android-first system intended to turn an unused Android
phone into a remotely accessible smart security camera. The current foundation
includes secure pairing, foreground-service camera readiness, authorized
multi-viewer WebRTC, multiple sources per device, responsive device management,
local multi-camera monitoring workspaces, explicit Listen controls, a single-owner
web-to-Android talk path, Android privacy mode, and on-device motion metadata.
Later approved milestones add opt-in encrypted short clips exported to user-owned
Google Drive, notification transport, household sharing, and an Electron desktop
client. Trained object detection remains experimental foundation work.
The [roadmap](docs/roadmap.md) records the remaining release acceptance gates.

Web/desktop Camera wall supports named camera groups and saved tile order/columns
on the current browser, scoped to account and household (ADR 0098). Open Camera
wall, choose **New group / layout**, select/reorder cameras, then save. Layouts do
not sync across installations. Browser storage failures are explained in the UI.

<p align="center">
  <img src="assets/architecture.svg" width="900" alt="Beacon SecureView system architecture: Android camera client, Fastify backend, React web viewer">
</p>

Activity supports 24-hour, 7-day, 30-day, all-time, and local-calendar Since date
filters with a reset action. Camera/date filters query saved history; text search,
event kinds, counts, and sorting cover loaded pages. Load more extends those
results. Preferences stay local to the account and household.

Connection details provides manual refresh, device connection guidance, and a
local troubleshooting report you can preview and copy. The report omits names,
identifiers, credentials, and raw connection data. It describes a backend status
snapshot; video, audio, and notification delivery require separate checks.
Choose **Check setup** for read-only camera, Drive, and alert-preference checks,
with explicit manual permission and delivery steps. It never starts capture.

Clips offers **Bookmark clip** and **Bookmarked only**. Bookmarks save identifiers
in this browser for the account and household; they do not bypass access or keep
clips past retention. Load more extends the clips searched by these filters.
Development follows the [testing policy](docs/testing-policy.md): protect realistic
regressions with the smallest useful suite.

Web/desktop notification settings offer personal per-camera motion-alert snooze
for 15/30/60 minutes and early resume. Server deadlines work while the viewer is
closed. Camera capture and history continue; quiet hours and Home/Away rules still
apply, and problem/security alerts keep their usual behavior. Migration 0037 is
required before rolling out this API change.

Full web/desktop live views offer an optional 15/30/60-minute sleep timer.
Expiry stops this viewing session (including Talk, PiP and Cast), with an explicit
Resume viewing button. It does not pause camera capture and cannot execute while
the browser or computer is suspended; it checks expiry on wake (ADR 0099).

## Repository layout

- `apps/android-camera` — Kotlin/Compose CameraX and WebRTC camera client
- `apps/backend` — Fastify API, authorized WebSocket signaling, and PostgreSQL
- `apps/web-viewer` — React account, camera, and browser WebRTC interface
- `packages/shared-types` — platform-neutral TypeScript contracts
- `packages/config` — shared TypeScript configuration
- `infrastructure` — loopback-only local PostgreSQL and Coturn
- `docs` — architecture, security, testing, and development guidance

## Quick start on Windows

Prerequisites are Node.js 22.13+ within Node 22, pnpm 11.9.0, and Docker
Compose. JDK 17 and Android SDK 35 are needed for Android.

```powershell
.\Start-Beacon.ps1
```

Stop and validate with:

```powershell
.\Stop-Beacon.ps1
.\Test-Beacon.ps1
```

The launcher installs pinned dependencies, creates missing local configuration,
starts Docker services, applies migrations, starts HTTPS/WSS LAN development,
and opens Beacon. See the [Windows quick start](docs/quick-start.md) for Android
installation and useful options, or
[local development](docs/local-development.md) for lower-level commands. This
project is not production-ready.

For the recommended local/GitHub workflow, see the
[development handoff](docs/development-handoff.md). GitHub is the source of
truth; work on a `codex/*` feature branch, open a pull request, and merge to
`main` only after CI passes. A successful merge to `main` deploys the web
viewer to the Oracle private alpha automatically.

## Product surfaces

- Dashboard: `/`
- Cameras (list view, or a grid view for watching several at once): `/cameras`
- Devices: `/devices`
- Browser Camera Mode: `/camera-mode`
- Development diagnostics: `/diagnostics`

The web viewer is also an installable PWA (manifest, generated icons, and an
app-shell-only service worker at `apps/web-viewer/public/sw.js`); it never
caches `/api/*` or the events WebSocket.

Browser Camera Mode requires explicit permission and trusted HTTPS. It is for
attended use because browsers may throttle background tabs. See
[Browser Camera Mode](docs/browser-camera-mode.md),
[multi-camera architecture](docs/multi-camera-architecture.md), and
[multi-viewer testing](docs/multi-viewer-testing.md).

The current foundation establishes independent multi-camera tiles and local
workspace layouts in addition to resilient producer reconnect, device/camera
separation, browser producers, independent multi-viewer sessions, privacy mode,
and one-way camera audio. Recording, motion/events, notifications, distributed
presence/signaling, production deployment, SFU fan-out, iOS/desktop agents, and
IP-camera adapters remain future roadmap work.

---

_Built by [Hans Sai](https://builtbysai.com)._
