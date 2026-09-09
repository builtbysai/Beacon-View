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
Recording, object recognition, and notifications are not implemented.

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
- Monitor: `/monitor`
- Cameras: `/cameras`
- Devices: `/devices`
- Browser Camera Mode: `/camera-mode`
- Development diagnostics: `/diagnostics`

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
