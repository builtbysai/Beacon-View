# Quick start for Windows

Beacon includes top-level PowerShell launchers so ordinary development does not
require remembering the individual Docker, database, backend, viewer, and
Android commands.

The launch and validation scripts keep generated Android build output under
`%LOCALAPPDATA%\BeaconSecureView\android-build`. This avoids OneDrive file locks
while Android Studio is open; application source remains in the repository.

## Required tools

Install these once:

- Git
- Node.js 22.13 or newer within Node 22
- pnpm 11.9.0 through Corepack
- Docker Desktop with Linux containers
- Android Studio, Android SDK 35, and USB debugging only when using Android

Enable the pinned pnpm version if needed:

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

The launcher starts Docker Desktop automatically when it is installed in a
standard location. If automatic startup is unavailable, open Docker Desktop and
retry after its engine reports that it is running.

## Start Beacon

From the repository directory:

```powershell
.\Start-Beacon.ps1
```

The launcher:

1. verifies Node, pnpm, and Docker;
2. creates `apps/backend/.env` only when it is missing;
3. installs exact lockfile dependencies;
4. starts PostgreSQL and Coturn;
5. waits for PostgreSQL health;
6. applies migrations;
7. detects the laptop LAN address;
8. starts the secure proxy, backend, and viewer;
9. reuses already running Beacon processes; and
10. opens the dashboard.

It prints the Dashboard, Monitor, Browser Camera Mode, and diagnostic URLs. Logs
and tracked process state are in `.beacon-dev/`.

Useful variants:

```powershell
# Restart existing Beacon processes instead of reusing them.
.\Start-Beacon.ps1 -Restart

# Start without opening a browser.
.\Start-Beacon.ps1 -NoBrowser

# Skip dependency installation after the first successful setup.
.\Start-Beacon.ps1 -SkipDependencyInstall

# Build, update-install, and open Beacon on one connected Android device.
.\Start-Beacon.ps1 -InstallAndroid

# Beacon automatically prefers a single physical phone over running emulators.
# You can also select a device explicitly when several are connected.
.\Start-Beacon.ps1 -InstallAndroid -AdbSerial YOUR_DEVICE_SERIAL

# Remove prior Android app data and pairing credentials before installation.
.\Start-Beacon.ps1 -InstallAndroid -CleanAndroidInstall

# Override automatic LAN selection.
.\Start-Beacon.ps1 -LanHost 192.168.1.25
```

The Android phone must trust the exported Caddy development CA for HTTPS. See
[`physical-android-device-development.md`](physical-android-device-development.md)
for the one-time certificate installation procedure.

## Stop Beacon

```powershell
.\Stop-Beacon.ps1
```

The stop script terminates only processes tracked as belonging to this
repository and shuts down the local Compose services. PostgreSQL data remains
in its named Docker volume.

## Validate Beacon

```powershell
.\Test-Beacon.ps1
```

This runs formatting, lint, TypeScript checks, web/backend tests, production
builds, a dedicated `beacon_secureview_test` database migration and integration
suite, Android unit tests, and an Android debug build. The test database is
separate from the development database and retains the `_test` safety marker.

Useful shorter checks:

```powershell
.\Test-Beacon.ps1 -SkipAndroid
.\Test-Beacon.ps1 -SkipDatabaseIntegration
pnpm.cmd check
```

Runtime LAN, HTTPS/WSS, and TURN validation after Beacon is running:

```powershell
.\scripts\Test-BeaconLanDev.ps1
.\scripts\Test-BeaconFunctionalMilestone.ps1
```

When a phone and emulator are both running, the LAN test automatically selects
the single physical phone. To override it, pass
`-AdbSerial YOUR_DEVICE_SERIAL`. Unlock an unauthorized phone and accept its USB
debugging prompt before retrying.

## Open a page again

```powershell
.\scripts\Open-BeaconLanDev.ps1 -Page Dashboard
.\scripts\Open-BeaconLanDev.ps1 -Page Monitor
.\scripts\Open-BeaconLanDev.ps1 -Page CameraMode
```

If local execution policy blocks a script, use the same command through a
one-time process-scoped bypass:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-Beacon.ps1
```
