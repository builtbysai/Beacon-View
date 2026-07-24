# Local development

## Prerequisites

- Node.js 22.13+ (Node 22 only) and pnpm 11.9.0
- Docker with the Compose plugin
- JDK 17 and Android SDK Platform 35 for Android

## Startup

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

Backend variables are `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`,
`WEB_ORIGIN`, `SESSION_COOKIE_NAME`, role-specific viewer/device STUN and TURN
URLs, and TURN username/credential values. `DATABASE_URL` is required; local
defaults are shown in `.env.example`. Do not commit a real `.env`.

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

```sh
apps\android-camera\gradlew.bat -p apps/android-camera :app:assembleDebug
apps\android-camera\gradlew.bat -p apps/android-camera :app:testDebugUnitTest
```

The app requests `CAMERA` only for visible live streaming and binds capture to
the activity lifecycle. It also declares the normal `INTERNET` and
`ACCESS_NETWORK_STATE` permissions required for signaling, ICE, and
network-change handling. It has no microphone, audio, foreground-service,
recording, or background capture.

## Manual live-video check

1. Start PostgreSQL and Coturn, apply migrations, and run backend and viewer.
2. Pair the Android emulator, grant camera permission, and leave it visible.
3. Sign in as the owner, select the online camera, and choose **View live**.
4. Confirm Android preview/capture indicator, connected browser status, and video.
5. Close the viewer and confirm Android returns to waiting and capture stops.
6. Repeat with direct ICE and relay-only ICE when validating TURN.

Physical devices require HTTPS/WSS and LAN-reachable or public backend and TURN
hostnames. Do not expose the local Compose credentials.

Local PostgreSQL, Coturn, and their deliberately weak example credentials are
loopback-only. Never reuse those credentials outside an isolated developer
machine.
