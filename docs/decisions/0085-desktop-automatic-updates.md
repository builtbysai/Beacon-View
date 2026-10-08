# ADR 0085: Desktop automatic updates that keep sessions and cameras

- Status: Accepted (owner-requested October 7, 2026)
- Date: 2026-10-07

## Context

The owner asked for an update system that never disconnects or deletes
existing sessions or devices. Desktop 0.2 had no updater, so every shell
change meant a manual reinstall.

Two facts shape the design:

- **Most changes need no desktop update.** The desktop window loads the live
  web app (ADR 0082), so web and backend changes reach desktop users on the
  next page load. Only the Electron shell needs updating: tray, alerts, deep
  links, setup files, and the Electron version itself.
- **Nothing an update touches holds sessions.** All of these live in the
  per-user data folder (`%APPDATA%\Beacon`, `~/Library/Application Support/Beacon`,
  `~/.config/Beacon`):
  - the session cookie (30 days; encrypted by the cookie-encryption fuse
    with the OS key store, which does not change between versions)
  - Camera Mode's installation ID and device credential (`localStorage`)
  - desktop preferences and the camera resume path

  Installers replace only the program folder. electron-builder's NSIS
  uninstaller deletes app data only when `deleteAppDataOnUninstall` is set,
  which Beacon never sets.

## Decision

Use `electron-updater` (the electron-builder companion) with the **generic
provider**, served from the existing self-hosted downloads folder:
`https://beacon.builtbysai.com/downloads/`.

- **Feed.** Each build writes `latest.yml` (Windows), `latest-linux.yml`,
  and `latest-mac.yml`, each with the installer's SHA-512, plus `.blockmap`
  files for differential downloads. Publishing them next to the installers
  is the release. Caddy serves `*.yml` with `no-cache`.
- **Where it self-installs.** Windows (NSIS, per-user, no admin) and Linux
  AppImage download and install updates silently.
  - Unsigned macOS apps cannot (Squirrel.Mac requires a signature), and
    `.deb` installs need root.
  - On those, the tray offers "Download Beacon x.y.z…", which opens the
    download page.
- **When it installs.** Downloads happen in the background. A downloaded
  update installs on its own only at a quiet moment: the window is hidden
  and the camera is not live.
  - A standby camera restarts, is offline for a few seconds, and resumes
    through the existing camera resume path.
  - A live camera is never cut off.
  - Otherwise the update waits for a quiet moment, for Quit Beacon (which
    installs silently), or for "Restart to update" in the tray.
  - A quiet restart sets a one-time `relaunchHidden` preference, so Beacon
    comes back in the tray instead of opening its window.
- **Checks.** Checks run one minute after launch, then every four hours.
  Errors are silent: a later check retries. Downgrades and prereleases are
  refused.
- **Identity is frozen.** `appId` (`com.builtbysai.beacon`), `productName`
  (`Beacon`), and the fuses keep their values. Changing `appId` or
  `productName` moves the data folder, and that signs everyone out and
  unpairs desktop cameras. The config says so next to the values.
- **Mid-update link handling.** An update runs the old uninstaller first. Its
  `customUnInstall` now skips removing the `beaconsecureview://` handler when
  `${isUpdated}`.

## Alternatives considered

- **Squirrel.Windows / `update-electron-app`.** It needs GitHub Releases or
  update.electronjs.org, which only serve public GitHub repositories, and it
  installs per-version folders. It does not fit self-hosted NSIS.
- **Manual reinstall only.** Sessions already survive it (it is the same
  NSIS upgrade path), but people would run stale shells indefinitely.
- **Updating a live camera immediately.** It is simpler, but cuts off
  someone who is watching.

## Security consequences

- Integrity rests on HTTPS to the Beacon origin plus the SHA-512 in the
  feed. **While builds are unsigned, anyone who can write to
  `/opt/beacon/downloads` on the server can ship code to every desktop.**
  That is the same trust level as the web app the desktop already loads.
  The update, though, runs as a native program, outside the browser
  sandbox.
  - Mitigation: the downloads folder is owned by the deploy user and is
    mounted read-only into the web container.
  - Once a Windows code-signing certificate exists, set `publisherName` and
    electron-updater verifies each update's signature against it.
  - macOS updates start working only from the first signed and notarized
    release.
- Updates never change capture behavior. Camera visibility (tray, power
  lock, notifications) is unchanged, and a camera that resumes after an
  update is announced the same way as one that resumes after sign-in.

## Consequences

- Desktop 0.2.x has no updater. Moving to 0.3.0 is a one-time manual
  install, done over the existing install, which keeps data.
- Releasing a desktop version means publishing every OS's installers,
  blockmaps, and `latest*.yml` together, with `manifest.json` uploaded last.
