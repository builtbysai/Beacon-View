# Runbook: outage, lost phone, lost keys

Short, in the order you will need it. Server access is `ssh beacon-oracle` over Tailscale; public SSH is closed.
Deploying and rolling back are in `docs/oracle-cloud-staging.md` and `docs/deployment.md`.

## 1. Beacon is down or cameras will not connect

1. Open `https://beacon.builtbysai.com/ready`. A 200 means the backend and database answer; look at the camera side next.
2. `ssh beacon-oracle`, then `sudo docker ps`. Expect `beacon-secureview-cloud-web-1`, `-backend-1`, `-postgres-1` and `-coturn-1` all Up.
3. A container is down or restarting: `sudo docker logs --tail 100 <name>`. A backend that crash-loops right after a deploy is nearly always an environment value that fails validation; roll back (step 4).
4. Roll back: the previous images are tagged `beacon-backend-rollback:pre-<sha>` and `beacon-web-rollback:pre-<sha>`. Tag them back to `beacon-secureview-cloud-backend` and `-web`, then `up -d --no-deps backend web` with the same `docker compose` command used to deploy. Point `/opt/beacon/current` back at the previous release directory and update `/opt/beacon/DEPLOYED_RELEASE`. Never recreate `coturn`: it is hand-run and shared with Beacon Remote.
5. Live video fails but pages load: the relay (coturn) or the UDP/TCP 3478 path. Check `sudo docker logs --tail 50 beacon-secureview-cloud-coturn-1` and that the `TURN_SHARED_SECRET` in the backend and relay match.
6. The monitor (`beacon-monitor.timer`) emails the alert address when `/ready` fails, once and then daily while the problem lasts. If it is silent, check `systemctl status beacon-monitor.service`: it runs from `/opt/beacon/current`, so that link must exist.

## 2. The database is damaged or lost

1. Stop the backend so nothing writes: `sudo docker compose ... stop backend`.
2. Backups are encrypted snapshots to off-VM object storage, daily (`beacon-backup.timer`); `beacon-backup-check.timer` verifies them. The restore and its drill are step 5 of `docs/oracle-cloud-staging.md`. Restore into a separate empty database first, check it, then restore for real.
3. You need the backup password (restic) and the object-storage key from the owner's credential store. Without the password, snapshots cannot be read. Keep it in two places.
4. Encrypted columns (Drive tokens, push endpoints) only decrypt with the same `GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY`, `NOTIFICATION_ENCRYPTION_KEY` and `NOTIFICATION_FINGERPRINT_KEY` as before. Restoring the database without those keys leaves those rows unreadable (people reconnect Drive and re-enable notifications).
5. Start the backend and run `/ready`. Cameras reconnect on their own; recent events since the last snapshot are lost.

## 3. A camera phone is lost or stolen

1. Sign in on the web, open Cameras, and choose "Remove camera" on the device. This calls `POST /api/devices/:deviceId/revoke`: its credentials stop working, its live sessions are closed, and it can only come back by pairing again with a fresh code.
2. If the phone had access to Drive, remove Beacon from the Google account's connected apps (Google security settings) as well. Clips already in Drive stay encrypted with keys that Beacon held only for the clip's life, but revoking removes the phone's reach to the folder.
3. Change the Beacon account password if the phone was also signed in as the owner.
4. Pair a replacement from Add a device.

## 4. The owner's own phone or password is lost

1. Use "Forgot password" on the sign-in page; the reset link is emailed. If the email account is also lost there is no self-service path, so keep the account email current and a second owner in place (next step).
2. Turn on a second owner (Settings, People & access, Invite person) so one lost account never locks a household out.

## 5. Keys and where they live

Values are never in the repository. The owner's credential store holds:

- the server environment files `/etc/beacon/production.env` and `/etc/beacon/backup.env` (copy kept off the server),
- the backup password and storage key,
- the desktop update-signing key (losing it means desktop apps cannot trust the next update; a new key needs a new app build that carries the new public key),
- the Android signing keystore (losing it means a new package identity, so every installed phone must reinstall and pair again),
- the Google OAuth client secret, Resend API key and FCM service-account file (each can be re-issued at its provider).

After any suspected leak of a server secret, rotate that secret, redeploy, and check `/ready`. TURN secrets are rotated in the backend and the relay together.

## 6. After an incident

Write what happened, how long it lasted and what changed under `docs/` or as an ADR when a decision came out of it. Do not paste secrets or personal data into it.
