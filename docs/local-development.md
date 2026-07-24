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

Backend variables include `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`,
`DATABASE_URL`, `WEB_ORIGIN`, `PUBLIC_BACKEND_ORIGIN`,
`SIGNALING_PUBLIC_URL`, `ALLOW_INSECURE_LOCAL_DEV`, `SESSION_COOKIE_NAME`,
role-specific viewer/device STUN and TURN UDP/TCP URLs,
`TURN_SHARED_SECRET`, `TURN_CREDENTIAL_TTL_SECONDS`, and
`ICE_TRANSPORT_POLICY`. `DATABASE_URL` and a 32-byte-or-longer TURN secret are
required. Local example values are not deployment credentials. Do not commit a
real `.env`.

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

## HTTPS/WSS and a physical phone

The optional `secure` Compose profile terminates locally trusted HTTPS and WSS
with Caddy. Start the web development server on a container-reachable interface
and bind Caddy to the selected LAN interface:

```powershell
$env:VITE_DEV_HOST = "0.0.0.0"
$env:BEACON_HTTPS_HOST = "beacon.test"
$env:BEACON_HTTPS_BIND = "192.0.2.10"
pnpm dev
docker compose -f infrastructure/docker/compose.yaml --profile secure up -d
```

Replace the documentation address with the development computer's stable LAN
address. Add a matching DNS or hosts entry. Export Caddy's local root
certificate from the `caddy-data` volume and install it explicitly as a trusted
development CA in the test browser and phone. Android debug builds trust
user-installed CAs; release builds trust only system CAs. Never disable
certificate verification and never commit the CA private key.

Set backend origins and signaling URL to the exact HTTPS/WSS endpoints, leave
`ALLOW_INSECURE_LOCAL_DEV=false`, and build Android with:

```powershell
$env:BEACON_API_URL = "https://beacon.test:8443"
apps\android-camera\gradlew.bat -p apps/android-camera :app:assembleDebug
```

Allow inbound TCP 8443 and the configured Coturn TCP/UDP 3478 plus UDP
49160–49200 only from the intended test networks. A TURN server behind NAT also
needs its advertised external address configured. The default Compose bindings
remain loopback-only and therefore cannot serve a physical phone.

## Physical-device validation checklist

Record browser, handset/Android, network, and time with the result:

1. Pair the phone through the non-loopback HTTPS backend and confirm WSS in
   browser developer tools.
2. Keep the Android streaming UI visible; confirm preview and advancing browser
   video for five minutes.
3. With `ICE_TRANSPORT_POLICY=all`, record a direct host or server-reflexive
   candidate when the network permits.
4. Restart with `ICE_TRANSPORT_POLICY=relay`; confirm a relay candidate and
   advancing video through Coturn.
5. Disable phone Wi-Fi briefly, restore it, and verify bounded
   `offline`/`reconnecting` recovery.
6. Close the browser and verify viewer teardown; leave the Android streaming
   screen and verify camera release.
7. Revoke the device credential and verify new signaling and TURN issuance stop.
8. Inspect backend, browser, Android, and Coturn logs for secrets, SDP, raw ICE
   candidates, crashes, and restart loops.

No handset was connected during the automated repository run for this
milestone, so this checklist must be executed before release.

Local PostgreSQL, Coturn, and their deliberately weak example credentials are
loopback-only. Never reuse those credentials outside an isolated developer
machine.
