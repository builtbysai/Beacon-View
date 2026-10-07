# Beacon desktop app

Electron app for Windows, macOS, and Linux (ADRs 0082–0084). The window shows the Beacon
web viewer from the canonical origin, so it looks and behaves exactly like the
PWA. Beacon keeps running in the system tray when the window is closed.

## What the shell adds to the PWA

- **Tray and background running.** Closing the window hides Beacon to the tray.
  **Quit Beacon** in the tray menu exits.
- **Start at sign-in.** Available in the tray menu and in Settings → This
  computer. Off by default; turned on by one-click camera setup. Installed
  builds only. When on, Beacon launches hidden.
- **Camera on, standby, or off.** The tray shows each state and keeps the
  computer awake while a camera runs. If the camera turns on while the window
  is hidden, you get a notification, and quitting asks for confirmation.
  - On: a red dot.
  - Standby: the camera stays off until a viewer opens it.
- **Camera Mode resumes after a restart.** A computer set up as a camera
  reopens Camera Mode at startup, in the tray if it started hidden.
- **Desktop alerts.** Turn them on in Settings → Notifications. They follow
  the same preferences and quiet hours as phone and browser alerts.
- **One-click camera setup.** Set it up from the website (Add camera → Set up
  another computer):
  - a pre-configured Windows installer (the setup is carried in its file
    name)
  - a `.beaconcamera` file
  - a `beaconsecureview://camera/setup` link
- **Google sign-in in your own browser.** Google blocks its sign-in page inside
  apps. Beacon opens it in your browser and returns through a
  `beaconsecureview://` link, protected with PKCE. The browser tab then says
  it can be closed.
- **Locked to Beacon.** Only Beacon pages open in the window. Every other link
  opens in your browser.
- **Offline page.** A local page appears when Beacon can't be reached on first
  launch, and it reconnects automatically.

## Not supported yet

- **iOS.** Deferred (see ADR 0082). Install the PWA from Safari instead.
- **Motion detection on computer cameras.** Only the Android app detects
  motion.
- **Linking Google or connecting Google Drive.** These finish in your browser.

## Develop

```bash
pnpm install                                   # downloads the Electron runtime
pnpm --filter @beacon/web-viewer dev           # http://127.0.0.1:5173
BEACON_DESKTOP_ORIGIN=http://127.0.0.1:5173 pnpm --filter @beacon/desktop dev
```

Without `BEACON_DESKTOP_ORIGIN`, development builds load production. Packaged
builds always load production and ignore the variable.

Optional development variables (unpackaged builds only):

- `BEACON_DESKTOP_USER_DATA`: a separate profile directory.
- `BEACON_DESKTOP_REGISTER_PROTOCOL=1`: point `beaconsecureview://` at this
  checkout so you can test Google sign-in end to end. Undo it afterwards: on
  Windows, delete `HKCU\Software\Classes\beaconsecureview`.

## Test

```bash
pnpm --filter @beacon/desktop test        # policy, PKCE, deep links, autostart, CSP
pnpm --filter @beacon/desktop typecheck
# Real Electron smoke test against a local, fixture-only web viewer:
pnpm --filter @beacon/web-viewer dev --host 127.0.0.1 --port 5181 --strictPort
pnpm --filter @beacon/desktop build
BEACON_QA_URL=http://127.0.0.1:5181 node scripts/Test-BeaconDesktop.mjs
```

## Package

```bash
pnpm --filter @beacon/desktop package:win     # NSIS installer (on Windows)
pnpm --filter @beacon/desktop package:mac     # DMG (on macOS)
pnpm --filter @beacon/desktop package:linux   # AppImage + .deb (on Linux)
```

Installers land in `apps/desktop/release/` (gitignored). Each OS builds its own
installers. Builds are **unsigned** until the owner provisions:

- a Windows code-signing certificate (`CSC_LINK` / `CSC_KEY_PASSWORD`)
- an Apple Developer ID (`CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`) for signing and notarization

Never commit those credentials. While Beacon is self-hosted, unsigned builds
are acceptable: Windows SmartScreen shows "More info → Run anyway", and on a
Mac you Control-click → Open.

## Publish downloads

The website offers installers from `/opt/beacon/downloads` on the server,
which the web container mounts read-only at `/downloads/`.

1. Build: run the **Desktop release builds** workflow (Windows, macOS,
   Linux), or package locally.
2. Put the installers in one folder, then run
   `node scripts/build-desktop-manifest.mjs <folder> <version>`.
3. Copy the installers and `manifest.json` to `/opt/beacon/downloads`.

The landing page and the one-click setup offer only what the manifest lists.

Icons are rendered from `apps/web-viewer/public/favicon.svg`. After the brand
mark changes, run `pnpm --filter @beacon/desktop icons`. Set
`BEACON_ICON_CHANNEL=msedge` to use an installed Edge instead of Playwright's
Chromium.
