# Beacon SecureView

Beacon SecureView is a device-agnostic camera platform. Android devices and
attended HTTPS browsers can produce video; responsive browsers can view it; and
one device may expose several independently named camera sources.

Beacon SecureView is an Android-first system intended to turn an unused Android
phone into a remotely accessible smart security camera. Milestone 3 makes the
single-viewer, video-only WebRTC path resilient to transient connectivity loss
and adds production-style HTTPS/WSS and ephemeral TURN credentials. Audio,
recording, analysis, and background streaming are not implemented.

## Repository layout

- `apps/android-camera` — Kotlin/Compose CameraX and WebRTC camera client
- `apps/backend` — Fastify API, authorized WebSocket signaling, and PostgreSQL
- `apps/web-viewer` — React account, camera, and browser WebRTC interface
- `packages/shared-types` — platform-neutral TypeScript contracts
- `packages/config` — shared TypeScript configuration
- `infrastructure` — loopback-only local PostgreSQL and Coturn
- `docs` — architecture, security, testing, and development guidance

## Quick start

Prerequisites are Node.js 22.13+ within Node 22, pnpm 11.9.0, and Docker
Compose. JDK 17 and Android SDK 35 are needed for Android.

```sh
pnpm install --frozen-lockfile
cp apps/backend/.env.example apps/backend/.env
docker compose -f infrastructure/docker/compose.yaml up -d
pnpm --filter @beacon/backend db:migrate
pnpm dev
```

The backend development entry point loads `apps/backend/.env` without
overriding environment variables already defined by the shell. See
[local development](docs/local-development.md) for migrations, reset commands,
Android emulator setup, and validation. For a physical phone on the Windows
development LAN, follow the dedicated
[physical Android device guide](docs/physical-android-device-development.md).
This project is not production-ready.

## Product surfaces

- Dashboard: `/`
- Cameras: `/cameras`
- Devices: `/devices`
- Browser Camera Mode: `/camera-mode`
- Development diagnostics: `/diagnostics`

Browser Camera Mode requires explicit permission and trusted HTTPS. It is for
attended use because browsers may throttle background tabs. See
[Browser Camera Mode](docs/browser-camera-mode.md),
[multi-camera architecture](docs/multi-camera-architecture.md), and
[multi-viewer testing](docs/multi-viewer-testing.md).

This milestone establishes resilient producer reconnect, device/camera
separation, browser producers, and independent multi-viewer sessions. Recording,
motion/events, notifications, distributed presence/signaling, production
deployment, SFU fan-out, iOS/desktop agents, and IP-camera adapters remain
future roadmap work.
