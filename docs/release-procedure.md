# Release procedure

How a merged `main` commit reaches the Oracle VM, and how the Android and desktop downloads are published. Production
deploys are manual (ADR 0106); the `Deploy Beacon to Oracle` workflow only runs when the repository variable
`BEACON_AUTO_DEPLOY` is `true` and needs the repository variable `ORACLE_HOST_KEY_ALIAS` and the `production`
environment secrets (see [github-web-deployment.md](github-web-deployment.md)).

## Access

Connect Tailscale, then use the SSH alias `beacon-oracle` (host `beacon-secureview-oracle`, user `ubuntu`, a
dedicated key, `IdentitiesOnly yes`, `StrictHostKeyChecking yes`, and a `HostKeyAlias` for the pinned host key).
Public SSH is closed. Check access without printing anything sensitive:

```bash
ssh beacon-oracle "hostname; date -Is"
ssh beacon-oracle "sudo docker ps --format '{{.Names}}|{{.Status}}'"
```

Layout on the VM:

- Compose project `beacon-secureview-cloud`; services `postgres`, `backend`, `web`, `coturn`.
- Releases in `/opt/beacon/releases/web-<full-sha>`; `/opt/beacon/current` points at the live one and
  `/opt/beacon/DEPLOYED_RELEASE` holds its SHA. The monitor and backup systemd units run from `/opt/beacon/current`.
- Environment files `/etc/beacon/production.env` and `/etc/beacon/backup.env` (root-owned, never printed).
- Downloads in `/opt/beacon/downloads` (served at `/downloads/`).
- Never expose PostgreSQL, backend port 3000, the environment files or TURN secrets. `coturn` is started by hand,
  shared with another product, and is never recreated during a deploy.

## Deploying the web and backend

1. Merge to `main` (CI must be green) and note the full SHA.
2. Build and ship the exact source: `git archive --format=tar.gz <sha>`, copy it to the VM, extract it into
   `/opt/beacon/releases/web-<sha>`.
3. Tag the running images for rollback: `beacon-backend-rollback:pre-<sha>` and `beacon-web-rollback:pre-<sha>`.
4. From the release directory, with both environment files:

   ```bash
   C="sudo docker compose --project-name beacon-secureview-cloud \
     --env-file /etc/beacon/production.env --env-file /etc/beacon/backup.env \
     --file infrastructure/cloud/compose.yaml"
   $C build backend migrate migrate-verify web
   $C up -d postgres
   $C run --rm --interactive=false migrate
   $C run --rm --interactive=false migrate-verify
   $C up -d --no-deps backend web
   ```

   `migrate-verify` is mandatory: migrations have printed success while missing schema work.

5. Check `https://beacon.builtbysai.com/ready` and `/version.json` (it names the new entry script and is served with
   `no-store`), then record the release:

   ```bash
   echo <sha> | sudo tee /opt/beacon/DEPLOYED_RELEASE
   sudo ln -sfn /opt/beacon/releases/web-<sha> /opt/beacon/current
   ```

Rollback: retag the `-rollback` images to the service image names, `up -d --no-deps backend web`, and point
`/opt/beacon/current` and `DEPLOYED_RELEASE` back. Schema changes are additive, so the previous code runs on the new
schema. Restores are in [oracle-cloud-staging.md](oracle-cloud-staging.md); outages are in
[runbook-outage-and-recovery.md](runbook-outage-and-recovery.md).

## Publishing the Android app

Build a release APK signed with the key whose fingerprint is in `apps/web-viewer/public/.well-known/assetlinks.json`
(see [android-release.md](android-release.md)), with a version code one higher than the last:

```bash
apps/android-camera/gradlew.bat -p apps/android-camera :app:assembleRelease \
  -PbeaconVersionCode=<n> -PbeaconVersionName=0.1.0-alpha<n>
```

Verify with `apksigner verify --print-certs`, copy it to `/opt/beacon/downloads/Beacon-android-<version>.apk`, and
update the Android entry in `/opt/beacon/downloads/manifest.json` (file, bytes and SHA-256). The server has no Node,
so edit the manifest off-server and upload it. The app checks the manifest and offers the update (ADR 0118). Keep
the previous APK for rollback and delete older ones.

## Publishing the desktop app

Build and sign the update feed as described in [ADR 0110](decisions/0110-signed-desktop-update-feed.md) and
`apps/desktop/README.md`, copy the installers and signed feeds to `/opt/beacon/downloads`, and rebuild the manifest
with `node scripts/build-desktop-manifest.mjs <folder> <version>`.
