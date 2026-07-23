# Beacon SecureView

Beacon SecureView is an Android-first system intended to turn an unused Android
phone into a remotely accessible smart security camera. This repository currently
contains only the Milestone 0 project foundation; authentication, pairing, media
capture, streaming, and recording are not implemented.

## Repository layout

- `apps/android-camera` — Kotlin and Jetpack Compose Android skeleton
- `apps/backend` — Fastify API foundation
- `apps/web-viewer` — React and Vite web foundation
- `packages/shared-types` — platform-neutral TypeScript contracts
- `packages/config` — shared TypeScript configuration
- `infrastructure` — local PostgreSQL and Coturn configuration
- `docs` — architecture, security, testing, and development guidance

## Prerequisites

- Node.js 22.13 or newer within the Node 22 release line
- pnpm 11.9.0
- Docker with Docker Compose for local infrastructure
- JDK 17 and Android SDK 35 to build the Android skeleton; the Gradle wrapper is
  included

## Quick start

```sh
pnpm install --frozen-lockfile
cp apps/backend/.env.example apps/backend/.env
pnpm check
pnpm dev
```

Start local infrastructure separately:

```sh
docker compose -f infrastructure/docker/compose.yaml up -d
```

See [local development](docs/local-development.md) for complete setup and
troubleshooting instructions. The project is not production-ready.
