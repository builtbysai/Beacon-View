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
`WEB_ORIGIN`, and `SESSION_COOKIE_NAME`. `DATABASE_URL` is required; the others
have safe local defaults shown in `.env.example`. Do not place production secrets
in the example file or commit a real `.env`.

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
emulator host; other cleartext destinations remain blocked.

```sh
apps\android-camera\gradlew.bat -p apps/android-camera :app:assembleDebug
apps\android-camera\gradlew.bat -p apps/android-camera :app:testDebugUnitTest
```

The app has the minimum `INTERNET` permission for registration and heartbeat. It
has no camera, microphone, foreground-service, or media behavior. Physical-device
network setup requires a separately reviewed secure endpoint; do not expose the
development services broadly.

Local PostgreSQL, Coturn, and their deliberately weak example credentials are
loopback-only. Never reuse those credentials outside an isolated developer
machine.
