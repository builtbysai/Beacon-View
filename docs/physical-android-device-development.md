# Physical Android device development on Windows

This workflow exposes only HTTPS/WSS and TURN to the selected LAN interface.
PostgreSQL remains bound to `127.0.0.1`. The credentials and Caddy CA are for an
isolated development network only.

## Prerequisites

- Windows laptop and Android phone on the same trusted Wi-Fi network
- Docker Desktop with its Linux engine running
- Node 22.13 or newer within Node 22 and pnpm 11.9.0
- Android SDK Platform 35, JDK 17, and Android platform tools
- Android developer options and USB debugging enabled
- `apps/backend/.env` copied from `.env.example`
- Firebase Android configuration installed with
  `scripts/Install-BeaconFirebaseAndroidConfig.ps1` (the destination is ignored by Git)
- dependencies installed and migrations applied

Confirm the phone before starting:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
```

Accept the USB authorization prompt. Exactly one intended device should report
`device`, not `unauthorized` or `offline`.

## Start LAN development

Automatic address selection excludes loopback, APIPA, Docker, WSL, and
VPN-named adapters. An explicit address is safer on multi-homed laptops:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd --filter @beacon/backend db:migrate
.\scripts\Start-BeaconLanDev.ps1 -LanHost 192.0.2.10
```

Do not copy the example address blindly. The script validates the address and
fails if TCP 3000, 5173, 8443, or 3478, or TURN UDP 3478/49160–49200, is
occupied. Vite uses strict port 5173 and never falls through to 5174. The script
starts PostgreSQL, Coturn, Caddy, backend, and viewer and writes process state
and logs under ignored `.beacon-dev/`.

The relay range defaults to 49160–49200. Override it consistently with
`-TurnMinPort` and `-TurnMaxPort`; the script validates and checks the selected
range before Compose starts.

It sets exact origins and reachable ICE hosts:

- Viewer and Android: `https://<LAN_IP>:8443`
- Signaling: `wss://<LAN_IP>:8443/api/signaling`
- STUN/TURN: `<LAN_IP>:3478`
- TURN UDP relay range: `49160–49200`

`HOST=0.0.0.0` and `VITE_DEV_HOST=0.0.0.0` apply only to the child development
processes. Caddy and TURN bind only to the selected LAN address. PostgreSQL
stays on loopback.

## Export and install the development CA

Export the public root certificate:

```powershell
.\scripts\Export-BeaconDevCertificate.ps1
```

The predictable output is
`artifacts\dev-ca\beacon-caddy-root.crt`; the directory is ignored by Git. The
script never exports Caddy's CA private key.

On Windows, import the certificate into **Trusted Root Certification
Authorities** for the current user using `certmgr.msc`, or:

```powershell
certutil -user -addstore Root .\artifacts\dev-ca\beacon-caddy-root.crt
```

On Android, copy and install it as a CA certificate:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb push .\artifacts\dev-ca\beacon-caddy-root.crt /sdcard/Download/
& $adb shell am start -a android.settings.SECURITY_SETTINGS
```

Use the phone's certificate-install UI to install the file as a CA certificate.
Android may require a screen lock. Chrome and the Beacon **debug** build can
then trust the user-installed CA. Some managed devices prohibit user CA
installation. Release builds trust only system CAs and never receive the debug
override.

Re-running the start script with a different host force-recreates Caddy. Caddy
retains its local CA but selects or generates a leaf certificate for the new
configured host. If certificate state is corrupt, stop LAN development and
remove only the local `beacon-secureview-local_caddy-data` and
`beacon-secureview-local_caddy-config` Docker volumes, then restart and
reinstall the newly exported public root. This destroys only development Caddy
state.

## Validate and install the app

```powershell
.\scripts\Test-BeaconLanDev.ps1 -LanHost 192.0.2.10
.\scripts\Test-BeaconTurnRelay.ps1 -LanHost 192.0.2.10
.\scripts\Build-Install-BeaconAndroidDebug.ps1 -LanHost 192.0.2.10
```

The validation uses Node's TLS implementation with the exported CA, not Windows
curl/Schannel. It checks container state, PostgreSQL health, backend, strict
Vite port 5173, the HTTPS leaf certificate SAN, active Caddy host, trusted WSS
upgrade, adb visibility, and phone TCP reachability when `toybox nc` is
available.

The Android build receives
`BEACON_API_URL=https://<LAN_IP>:8443`, installs the debug APK, and launches it.
The emulator default remains `http://10.0.2.2:3000`. Release builds require
HTTPS and do not broadly trust user certificates or cleartext.

**Building a debug APK for the physical Pixel outside `Start-Beacon.ps1`/this
script -- for example a plain `gradlew assembleDebug` -- silently falls back to
the emulator-only `http://10.0.2.2:3000` default if `BEACON_API_URL` is not set
in the shell or passed as `-PbeaconApiUrl=...`.** That address means nothing to
a physical device, so sign-in, pairing-code validation, and every other backend
call fail (a September 26, 2026 session lost time to exactly this: Google
sign-in opened `10.0.2.2:3000`, valid production pairing links failed the
scanner's host check, and manual code entry reported "cannot reach your
account" -- none of it a code bug). Always export `BEACON_API_URL` (production:
`https://beacon.builtbysai.com`) before an ad hoc Gradle invocation targeting
the physical Pixel.

Open `https://<LAN_IP>:8443` in laptop and phone Chrome. Pair the camera, keep
the Android streaming screen visible, sign in as the owner, and open live
video.

After the CA is installed, the phone URL can be opened through ADB:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am start `
  -a android.intent.action.VIEW -d "https://192.0.2.10:8443"
```

## Direct and relay verification

1. With `ICE_TRANSPORT_POLICY=all`, establish video and inspect browser WebRTC
   internals. Prefer a host or server-reflexive selected candidate when the LAN
   permits direct ICE.
2. Stop development, set `ICE_TRANSPORT_POLICY=relay` in the environment, and
   restart. Confirm the selected candidate is `relay` and video advances.
3. Disable phone Wi-Fi for 15-30 seconds, restore it, and confirm
   `offline`/`reconnecting`/`online` recovery. An existing or reopened viewer
   must resume without Stop Camera, Start Camera, or re-pairing.
4. Leave the Android screen and close the browser; confirm camera, peer, and
   signaling resources close.
5. Revoke the device credential and confirm reconnection is rejected.
6. Inspect `.beacon-dev/*.log`, Android logcat, and Coturn logs. Credentials,
   cookies, TURN passwords, full SDP, and raw ICE candidates must not appear.

## Windows Firewall

For the selected **Private** network only, allow inbound:

- TCP 8443 for Caddy HTTPS/WSS
- TCP and UDP 3478 for TURN
- UDP 49160–49200 for TURN relay

TCP 3000 is needed only if intentionally bypassing Caddy; LAN mode does not
require it. Port 5173 is accessed by Caddy through Docker Desktop and should not
normally be opened to the wider LAN. Never expose PostgreSQL 5432.

## Troubleshooting

- **Vite port occupied:** stop the process on 5173. Vite exits rather than
  moving to 5174; inspect `.beacon-dev/viewer.err.log`.
- **Certificate says localhost:** confirm `BEACON_HTTPS_HOST` in
  `docker compose ... config`, force-recreate `secure-proxy`, export the current
  CA, and run `Test-BeaconLanDev.ps1`.
- **`ERR_SSL_PROTOCOL_ERROR`:** verify the URL uses `https` and port 8443,
  Caddy is running, and the selected host matches its certificate.
- **`CERT_AUTHORITY_INVALID`:** reinstall the currently exported Caddy root as
  an Android CA; managed devices may disallow it.
- **Phone cannot reach laptop:** confirm the same Wi-Fi, Private firewall
  profile, correct LAN address, and no access-point client isolation.
- **VPN interference:** disconnect the VPN or pass the Wi-Fi adapter's address
  explicitly.
- **Docker Desktop:** verify Linux containers and `docker info`; Caddy reaches
  Vite through `host.docker.internal`.
- **Backend CORS/CSRF rejection:** ensure `WEB_ORIGIN`,
  `PUBLIC_BACKEND_ORIGIN`, and the browser URL are the exact same HTTPS origin.
- **WebSocket failure:** verify WSS in browser tools and run the validation
  script. It expects an unauthorized test upgrade to close with 4003.
- **TURN failure:** confirm firewall rules, selected LAN bindings, advertised
  `BEACON_TURN_ADDRESS`, shared secret alignment, and UDP relay range.
- **App still uses localhost or `10.0.2.2`:** rebuild and reinstall with
  `Build-Install-BeaconAndroidDebug.ps1`; uninstall stale debug builds if
  necessary.
- **Schannel `SEC_E_INTERNAL_ERROR`:** do not treat it alone as Caddy failure.
  Use the Node-based validation script.

Stop all project processes and containers:

```powershell
.\scripts\Stop-BeaconLanDev.ps1
```

These settings must never be copied to production: the local TURN shared
secret, Caddy internal CA, user-installed CA trust, broad process bind hosts,
or developer firewall rules.
