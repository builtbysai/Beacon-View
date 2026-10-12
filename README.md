# Beacon View

Beacon View turns a spare Android phone, tablet or computer into a private security camera you can watch from any
browser, phone or computer. Live video goes device to viewer over WebRTC; the server only introduces the two sides,
relays when a direct path is impossible, and keeps the account, household and settings. Clips exist only if you turn
them on, and they are encrypted and stored in your own Google Drive.

The camera device always shows when it is capturing, and privacy mode stops capture immediately. See the
[threat model](docs/threat-model.md) and [SECURITY.md](SECURITY.md).

<p align="center">
  <img src="assets/architecture.svg" width="900" alt="Beacon View system architecture: Android camera client, Fastify backend, React web viewer">
</p>

## What is here

- `apps/android-camera`: the Kotlin/Compose camera and viewer app (CameraX and WebRTC)
- `apps/web-viewer`: the React web app and installable PWA (dashboard, live view, activity, clips, settings, Camera Mode)
- `apps/desktop`: the Electron app for Windows, macOS and Linux (background camera, alerts, signed updates)
- `apps/backend`: the Fastify API, WebSocket signaling and PostgreSQL schema
- `packages/shared-types`, `packages/config`: shared TypeScript contracts and configuration
- `infrastructure`: local PostgreSQL and Coturn, and the Oracle Cloud deployment (Compose, Caddy, backups, monitor)
- `docs`: design, security, testing and operations; decisions are in [docs/decisions](docs/decisions) and per-feature notes in [docs/feature-notes.md](docs/feature-notes.md)

## Develop

Node 22, pnpm 11.9.0 and Docker are needed (a JDK and the Android SDK for the Android app).

```sh
pnpm install --frozen-lockfile
cp apps/backend/.env.example apps/backend/.env
docker compose -f infrastructure/docker/compose.yaml up -d
pnpm --filter @beacon/backend db:migrate
pnpm dev
pnpm check
```

[Local development](docs/local-development.md) covers the test database, Android, a physical phone over HTTPS and
the desktop app. Follow the [testing policy](docs/testing-policy.md). The [roadmap](docs/roadmap.md) is the current
scope; [AGENTS.md](AGENTS.md) holds the working rules for contributors and coding agents.

## Operate

[Release procedure](docs/release-procedure.md), [outage and recovery runbook](docs/runbook-outage-and-recovery.md),
[Oracle Cloud deployment](docs/oracle-cloud-staging.md) and [Android release](docs/android-release.md).

## Status

A private alpha. It is not yet a finished consumer product: the Windows and Mac apps are not code-signed, the Android
app is distributed as a signed file from the website rather than through Google Play, and iOS is supported only as a
web app.

## License

Beacon View is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version
as a network service, the AGPL requires you to offer your users the source of your changes.

_Built by [Hans Sai](https://builtbysai.com)._
