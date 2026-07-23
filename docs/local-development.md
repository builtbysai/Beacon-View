# Local development

## Prerequisites

- Node.js 22.13+ (Node 22 only) and pnpm 11.9.0
- Docker with the Compose plugin
- For Android: JDK 17 and Android SDK 35 (or a compatible Android Studio)

## TypeScript applications

```sh
pnpm install --frozen-lockfile
cp apps/backend/.env.example apps/backend/.env
pnpm dev
```

The backend listens on `127.0.0.1:3000` and the viewer on `127.0.0.1:5173`.
Check backend health with `curl http://127.0.0.1:3000/health`.

## Local infrastructure

```sh
docker compose -f infrastructure/docker/compose.yaml up -d
docker compose -f infrastructure/docker/compose.yaml ps
docker compose -f infrastructure/docker/compose.yaml down
```

PostgreSQL and Coturn bind to loopback. Credentials in Compose and the example env
are deliberately weak, local-only defaults. Never reuse them outside an isolated
developer machine. A physical Android device cannot reach loopback services; use
the development computer's LAN address only after applying host firewall rules and
changing credentials. TURN behind NAT may also require an explicit external IP and
forwarded relay range; see Coturn documentation before exposing it.

## Android

Open `apps/android-camera` in Android Studio, install SDK 35, select JDK 17, and
build the `app` debug variant. From the repository root on Windows:

```sh
apps\android-camera\gradlew.bat -p apps/android-camera :app:assembleDebug
```

On macOS or Linux:

```sh
./apps/android-camera/gradlew -p apps/android-camera :app:assembleDebug
```

The skeleton declares no camera, microphone, networking, or background-service
permissions or behavior.
