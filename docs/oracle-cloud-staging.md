# Oracle Cloud staging deployment

This is a small private test environment, not a production approval. It uses one
Oracle Always Free ARM VM for the API, PostgreSQL, TURN, HTTPS, and web viewer.
The VM is a single point of failure and its PostgreSQL volume does not meet the
backup, restore, managed-secrets, monitoring, account-lifecycle, or incident-response
gates in [pre-deployment-readiness.md](pre-deployment-readiness.md).

## Prerequisites

- An Ubuntu 24.04 ARM VM with Docker Engine and Docker Compose.
- A DNS hostname that resolves to the VM's public IPv4 address.
- OCI and host firewalls allowing TCP 80/443, TCP/UDP 3478, and TCP/UDP
  49160-49200. Do not expose TCP 22 publicly. Administrative SSH uses the
  private Tailscale hostname `beacon-secureview-oracle` and the existing SSH key;
  see [ADR 0045](decisions/0045-private-oracle-administration.md).
- A public address kept stable while TURN is running. Update `TURN_EXTERNAL_IP` if
  the assigned public IP changes.

Never expose PostgreSQL, backend port 3000, or Vite port 5173. Do not reuse local
Compose credentials, Caddy development certificates, or TURN secrets.

## Private administration

Install Tailscale on an administrator device and join the same owner-controlled
tailnet as the VM. Connect with:

```bash
ssh -i <private-key-path> ubuntu@beacon-secureview-oracle
```

Keep OpenSSH password authentication disabled. Tailscale and `tailscaled` must
start automatically on the administrator device and VM. Before removing or
changing either installation, establish a temporary, narrowly scoped recovery
path through OCI. Do not restore a public TCP 22 rule as a permanent workaround.

## Deployment procedure

1. Copy the repository to `/opt/beacon/app` on the VM without `.env` files or build
   artifacts. The repository must contain `infrastructure/cloud`.
2. Create `/etc/beacon/production.env` from
   `infrastructure/cloud/production.env.example`, fill it with independently generated
   secrets, and set permissions to owner-read only.
3. Confirm the hostname resolves to `TURN_EXTERNAL_IP` before starting Caddy. Caddy
   obtains a public certificate over ports 80 and 443.
4. Run the migration as a deliberate release step and independently verify the
   resulting PostgreSQL catalog before starting long-running services:

   ```bash
   cd /opt/beacon/app/infrastructure/cloud
   sudo docker compose --env-file /etc/beacon/production.env run --rm migrate
   sudo docker compose --env-file /etc/beacon/production.env run --rm migrate-verify
   sudo docker compose --env-file /etc/beacon/production.env up -d postgres backend coturn web
   ```

5. `migrate-verify` checks every table, added column, named constraint, index,
   extension, function, and trigger introduced by the checked-in additive migrations.
   It must complete successfully; a migration ledger entry alone is not evidence that
   its DDL exists. Update the verifier when a migration introduces a non-additive
   invariant.
6. Verify HTTPS, WSS, a direct WebRTC view, then a forced relay view. Check logs for
   redaction before creating a household or pairing a physical device.

## Encrypted off-VM backup and restore verification

The cloud Compose configuration includes an explicit `backup` job. It creates a
custom-format PostgreSQL dump, encrypts it locally with Restic, and uploads it to a
private Oracle Object Storage bucket through the S3-compatible endpoint. The dump is
removed from the job container after each run. This job does not run until its
separate owner-readable configuration and systemd timers are installed.

1. Create a private Object Storage bucket in the same Oracle tenancy. Create a
   dedicated Oracle backup user and group, then grant that group permission to read
   the named bucket and manage objects only in that bucket. Generate the Customer
   Secret Key for this dedicated user, then record its access key and secret outside
   the repository. A Customer Secret Key itself is not bucket-scoped; the IAM policy
   supplies that restriction.
2. On the VM, create `/etc/beacon/backup.env` (mode `600`, root-owned) with the
   following values. `OCI_OBJECT_STORAGE_REPOSITORY` has the form
   `s3:https://<namespace>.compat.objectstorage.<region>.oraclecloud.com/<bucket>`.

   ```ini
   OCI_OBJECT_STORAGE_ACCESS_KEY_ID=...
   OCI_OBJECT_STORAGE_SECRET_ACCESS_KEY=...
   OCI_OBJECT_STORAGE_REGION=...
   OCI_OBJECT_STORAGE_REPOSITORY=s3:https://<namespace>.compat.objectstorage.<region>.oraclecloud.com/<bucket>
   BACKUP_RESTIC_PASSWORD=independent-long-random-value
   ```

3. Build the backup image, initialize the empty encrypted repository once, and make
   one manual backup before scheduling it:

   ```bash
   cd /opt/beacon/app/infrastructure/cloud
   sudo docker compose --env-file /etc/beacon/production.env --env-file /etc/beacon/backup.env build backup
   sudo docker compose --env-file /etc/beacon/production.env --env-file /etc/beacon/backup.env run --rm backup init
   sudo docker compose --env-file /etc/beacon/production.env --env-file /etc/beacon/backup.env run --rm backup run
   ```

4. Copy the four `beacon-backup*` unit files from this directory to
   `/etc/systemd/system/`, reload systemd, and enable the two timers. The backup runs
   daily at a randomized time after 03:15 UTC; integrity validation runs weekly.

   ```bash
   sudo cp beacon-backup*.service beacon-backup*.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now beacon-backup.timer beacon-backup-check.timer
   sudo systemctl list-timers 'beacon-backup*'
   ```

5. Verify a restore before relying on the schedule. Create a separate empty database,
   never the live database, then run the helper with its explicit confirmation marker.
   The helper refuses a non-empty target and reports migration and public-table counts.
   Review aggregate application row counts separately. Keep the command
   and any restore output out of shared shell history.

   ```bash
   sudo docker compose --env-file /etc/beacon/production.env --env-file /etc/beacon/backup.env exec postgres \
     sh -c 'createdb -U "$POSTGRES_USER" beacon_restore_verify'
   sudo docker compose --env-file /etc/beacon/production.env --env-file /etc/beacon/backup.env run --rm \
     -e RESTORE_TARGET_DATABASE=beacon_restore_verify \
     -e BEACON_ALLOW_DESTRUCTIVE_RESTORE=RESTORE_A_SEPARATE_DATABASE \
     --entrypoint /usr/local/bin/beacon-restore-verify backup latest
   ```

   On September 25, 2026, this drill restored a temporary encrypted snapshot into
   `beacon_restore_verify_20260925` in three seconds. The restored database matched
   the source at 28 migration rows, 23 public tables, and aggregate counts for users,
   households, cameras, motion events, and recordings. Repository integrity passed.
   The verification database and temporary snapshot were then removed and pruned.
   The daily and weekly timers were disabled at the time of the drill, so scheduled
   retention and expiry remain unproven.

The supplied retention policy keeps seven daily, four weekly, and three monthly
snapshots. Do not configure an Object Storage lifecycle policy that deletes backup
objects earlier than that; Restic needs retained pack files to reconstruct snapshots.

## Log retention

Cloud Compose services use Docker's local log driver with three 10 MB files per
container. This bounds each current service's container logs to approximately 30 MB
before rotation. Host and systemd journal retention is separately capped at 30 days and
200 MB with at least 1 GB free disk space. Install the journal policy and restart
journald before relying on the limit:

```bash
sudo install -D -m 0644 infrastructure/cloud/beacon-journald.conf \
  /etc/systemd/journald.conf.d/beacon.conf
sudo systemctl restart systemd-journald
sudo journalctl --vacuum-time=30d --vacuum-size=200M
```

The retention controls exclude media, credentials, raw signaling messages, and pairing
codes from application logs; they do not replace incident preservation or legal holds.

## Private-alpha monitoring

The VM includes a five-minute public-readiness and required-container monitor. The
readiness endpoint verifies that the backend can query PostgreSQL, while `/health`
remains a liveness check. It also
alerts when the daily backup fails or is more than 30 hours old, or when a previously
successful weekly repository check fails or is more than nine days old. It sends one
email on the first continuous failure and one on recovery; it does not send routine
healthy messages. Before enabling it, add these non-application delivery settings to
the existing owner-readable `/etc/beacon/production.env` file:

```ini
ALERT_EMAIL_TO=owner-verified-email@example.com
RESEND_FROM=onboarding@resend.dev
```

Then install and enable the monitor units:

```bash
# The units run the script and compose file from /opt/beacon/current, a symlink to the deployed
# release; every deploy ends with: sudo ln -sfn /opt/beacon/releases/web-<sha> /opt/beacon/current
sudo install -m 0644 beacon-monitor.service beacon-monitor.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now beacon-monitor.timer
sudo systemctl start beacon-monitor.service
```

Validate the script before installation and then run one silent healthy-path check.
The static test is intentionally credential-free; it checks Bash syntax and the
required backup-freshness safeguards, not email delivery.

```bash
bash infrastructure/cloud/test-beacon-monitor.sh
sudo systemctl start beacon-monitor.service
sudo systemctl show beacon-monitor.service -p Result -p ExecMainStatus
```

This is a private-alpha availability alarm, not production observability. It checks
HTTPS, the backend, PostgreSQL, Coturn availability, and backup-job freshness. TURN usage, database capacity, error rate,
centralized redacted logs, dashboards, and incident response remain later release
gates.

## Rollback and recovery

Stop application containers with `docker compose down`; do not remove volumes unless
the data-loss scope is explicitly understood. Restore a verified encrypted snapshot
only after making a fresh safety backup and following the separate-database restore
drill above. Apply database migrations before rolling out a backend that depends on
them; application startup does not modify the schema.

## Release log

- 2026-10-12: web and backend deployed from main `9893657` (migrations through 0040 applied; `/opt/beacon/current` points at the release). Android `0.1.0-alpha11` (versionCode 11) published to `/opt/beacon/downloads` and listed in `manifest.json`; the previous manifest is kept on the server as `/opt/beacon/manifest.json.bak-alpha10`. The server has no Node, so the manifest's Android entry was edited off-server and uploaded.
- 2026-10-12 (later): web deployed from main `370a1e8` (PR 127). Android `0.1.0-alpha12` (versionCode 12) published and listed; alpha11 kept for rollback, older APKs removed. The manifest before the change is saved as `/opt/beacon/manifest.json.bak-alpha11`.
- 2026-10-12 (correction): Android `0.1.0-alpha11`–`alpha13` were built without `BEACON_RELEASE_API_URL`, so they pointed at a placeholder address and could not connect. `0.1.0-alpha14` (versionCode 14, built with the production URL, same signing key) replaces them; alpha12 and alpha13 were removed from the server and the manifest (previous one saved as `/opt/beacon/manifest.json.bak-alpha13`). Signed release builds now refuse to build without the URL.
- 2026-10-12 (later): web deployed from main `975414f` (PR 130; backend unchanged). Android `0.1.0-alpha15` (versionCode 15) published: the app now hosts the web app (ADR 0121), built with the production URLs. alpha14 kept for rollback. Previous manifest: `/opt/beacon/manifest.json.bak-alpha14`; web rollback image `beacon-web-rollback:pre-975414f`. Checked on an emulator against production; a real-phone check is still to do.
- 2026-10-12 (evening): web deployed from main `cde0e13` (PR 132, backend unchanged; rollback image `beacon-web-rollback:pre-cde0e13`). Android `0.1.0-alpha16` (versionCode 16) published: picture in picture for the live view and one dropped dependency. alpha15 kept for rollback, alpha14 removed; previous manifest `/opt/beacon/manifest.json.bak-alpha15`. Emulator-checked; not yet on a real phone.
- 2026-10-12 (night): Android `0.1.0-alpha17` (versionCode 17) published; fixes Google sign-in inside the app (the app read an unresolved promise as a failure although the server had accepted the code, found on the Pixel). Web unchanged. alpha16 kept for rollback, alpha15 removed; previous manifest `/opt/beacon/manifest.json.bak-alpha16`.
- 2026-10-12 (night, later): Android `0.1.0-alpha18` (installation id on first use; phone alerts still failed) was published earlier and `0.1.0-alpha19` (versionCode 19) now. alpha19 makes phone alerts work: classic Firebase token, Android notification permission asked when alerts are turned on. Production fix the same night: the backend had been recreated without `compose.notifications.yaml` (no Firebase key mount) and the key file was root-only; both corrected (see release-procedure.md). A real alert was delivered to the Pixel. alpha18 and alpha19 on the server; alpha17 removed; previous manifest `/opt/beacon/manifest.json.bak-alpha18`.
