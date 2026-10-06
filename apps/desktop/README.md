# Beacon desktop app

Electron app for Windows, macOS, and Linux (ADR 0082). The window shows the Beacon
web viewer from the canonical origin, so it looks and behaves exactly like the
PWA. Beacon keeps running in the system tray when the window is closed.

## What the shell adds to the PWA

- **Tray and background running.** Closing the window hides Beacon to the tray.
  **Quit Beacon** in the tray menu exits.
- **Start at sign-in.** **Start Beacon when I sign in** in the tray menu is off by
  default and works only in installed builds. When on, Beacon launches hidden.
- **A visible "camera is live" indicator.** While Browser Camera Mode broadcasts,
  the tray icon shows a red dot and the menu says so. You get a notification if
  the window is hidden, and quitting asks for confirmation.
- **Google sign-in in your own browser.** Google blocks its sign-in page inside
  apps. Beacon opens it in your browser and returns through a
  `beaconsecureview://` link, protected with PKCE.
- **Locked to Beacon.** Only Beacon pages open in the window. Every other link
  opens in your browser.
- **Offline page.** A local page appears when Beacon can't be reached on first
  launch, and it reconnects automatically.

## Not supported yet

- **Alerts.** Electron has no Web Push service, so turn alerts on in Chrome, Edge,
  or the Android app.
- **iOS.** Deferred (see ADR 0082).
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

Never commit those credentials.

Icons are rendered from `apps/web-viewer/public/favicon.svg`. After the brand
mark changes, run `pnpm --filter @beacon/desktop icons`. Set
`BEACON_ICON_CHANNEL=msedge` to use an installed Edge instead of Playwright's
Chromium.
