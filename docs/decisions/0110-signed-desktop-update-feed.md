# ADR 0110: Signed desktop update feed

- Status: Accepted (owner decision of 2026-10-10, audit finding V2)
- Date: 2026-10-10

## Context

The desktop app updates itself from `/downloads/latest*.yml` on the Beacon server
(ADR 0085). electron-updater checks each installer against the SHA-512 in that file, but
the file is served from the same server as the installer. Whoever could write to the
server could replace both and have every installed app run their program. Windows
Authenticode signing would close this properly, but needs a purchased certificate.

## Decision

- The owner holds an Ed25519 private key (created with
  `apps/desktop/scripts/generate-update-key.mjs`, stored outside the repository and backed
  up). Publishing signs each `latest*.yml` into a `.sig` file
  (`scripts/sign-update-feed.mjs`).
- The app carries the public key (`src/update-signature.ts`). When electron-updater
  reports an update, the app fetches the feed and its signature itself, verifies the
  signature, and checks that the version and every installer checksum electron-updater
  read appear in the signed text. Only then does it download (Windows, AppImage) or
  offer the update. Auto-download is off until then. Any failure means no update.
- A server that is compromised but does not hold the key can no longer push an update to
  apps that have this change. Apps from before it keep the old trust until they update
  once; that one update is still trusted on the old terms.
- Windows still shows an unknown-publisher prompt for the installer. Buying an
  Authenticode certificate remains a later step and is independent of this one.

## Consequences

- Losing the private key means no update can be published until a new key ships in a
  new app version installed by hand. Keep a backup.
- Anyone with the private key can publish updates; treat it like a production secret.
