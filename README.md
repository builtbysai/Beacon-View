# Beacon SecureView

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
Android emulator setup, and validation. This project is not production-ready.
The same guide includes the HTTPS/WSS and physical-device validation procedure.
