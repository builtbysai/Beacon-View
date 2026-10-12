# Firebase and web-push setup

Updated September 12, 2026.

## Current verified state

- Firebase project: `beacon-view-158ad`
- Project number / FCM sender ID: `375745191921`
- Android application ID: `com.beaconsecureview.camera`
- Billing plan: Spark (`$0/month`)
- FCM HTTP v1 API: enabled
- Legacy FCM API: disabled
- Local Android configuration: installed at
  `apps/android-camera/app/google-services.json` and ignored by Git
- Android Gradle integration: Google services plugin `4.5.0`, Firebase BoM `34.18.0`,
  `firebase-messaging`, and `firebase-installations`; Android registers the current
  Firebase Installation ID (FID), not the deprecated FCM registration token API
- FCM auto-initialization: disabled by default and enabled only after authenticated consent
- Authenticated subscriptions, encrypted provider storage, preferences, durable outbox,
  bounded retry, generic payloads, and offline grace: deployed to the Oracle private
  alpha (ADR 0044)
- Dedicated sender identity: `beacon-fcm-sender@beacon-view-158ad.iam.gserviceaccount.com`
  with only the Firebase Cloud Messaging API Admin project role
- Sender JSON key: created with owner confirmation, retained outside the repository,
  and installed root-only on Oracle with a read-only backend bind mount
- VAPID and application keys: generated directly into a separate user-private local
  secrets file outside the repository and installed in the root-only production environment
- Migration/configuration activation: completed September 12, 2026
- Physical Android and Web Push delivery evidence: not complete

Reinstall a downloaded Android configuration with:

```powershell
.\scripts\Install-BeaconFirebaseAndroidConfig.ps1 `
  -SourcePath 'C:\Users\you\Downloads\google-services.json'
```

The script rejects a file that is not registered for Beacon's Android package. Never
substitute a Firebase Admin SDK or service-account JSON file here.

## Remaining private infrastructure

### Android sender credential

The dedicated `beacon-fcm-sender` service account now exists in project
`beacon-view-158ad`, has only the Firebase Cloud Messaging API Admin project role, and
has one owner-confirmed JSON key. The backend sender implementation and credential are
now installed and active on the Oracle VM.

On the Oracle VM:

1. Create `/etc/beacon/secrets` owned by root and readable only by the service process.
2. Place the key at `/etc/beacon/secrets/firebase-fcm-sender.json`, owned by uid 1000 (the backend's `node` user; on the
   VM that is the unused `opc` account) with mode `0400`. A root-owned `0600` file cannot be read by the container and
   every send fails with EACCES (found 2026-10-12).
3. Set `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-fcm-sender.json` and
   `FIREBASE_PROJECT_ID=beacon-view-158ad` in `/etc/beacon/production.env`.
4. Mount only the host file from step 2 read-only at that container path by including
   `infrastructure/cloud/compose.notifications.yaml` alongside the base Compose file.
   The explicit override prevents a credential-free deployment from failing on a
   missing bind mount.
5. Rotate the key after deployment proof and immediately if exposure is suspected.

Do not paste the key into chat, GitHub, a GitHub Actions variable, source code, Docker
build context, logs, or screenshots.

### PWA VAPID pair

VAPID does not require an account and does not require a Firebase Web app. Generate one
P-256 key pair for the implemented web subscription endpoint. Store the private key
only in `/etc/beacon/production.env` (or a root-owned secret file), and expose only the
public key through authenticated application configuration. Use
`https://beacon.builtbysai.com` as the VAPID subject/contact identity.

The VAPID pair and both independent application keys were generated without printing
them to the terminal and are stored outside the repository. To rotate them deliberately,
write a fresh set directly to a new external file:

```powershell
pnpm --filter @beacon/backend notifications:generate-secrets -- `
  'C:\Users\you\.config\beacon-secureview\secrets\notification-secrets.env'
```

The generator refuses relative paths, repository destinations, and existing files. Its
optional second argument overrides the default `https://beacon.builtbysai.com` VAPID
subject and must use `https:` or `mailto:`.

After both the server key and notification application keys exist, run notification-
enabled backend commands with both files, for example:

```bash
sudo docker compose \
  -f compose.yaml \
  -f compose.notifications.yaml \
  --env-file /etc/beacon/production.env \
  up -d backend
```

## Free-service boundary

FCM delivery and standards-based Web Push/VAPID can start at no service cost. The Oracle
VM and PostgreSQL remain Beacon's application infrastructure. Firebase is not used for
accounts, database storage, media, analytics, or recordings. Provider quotas and terms
still apply, and free delivery is not a reliability SLA.

## Activation gate

The deployed implementation now covers:

1. Authenticated Android and web subscription create/rotate/delete endpoints.
2. Envelope encryption for provider identifiers/endpoints with a separately managed server key.
3. A transactional outbox with deduplication, bounded retries, and invalid-registration cleanup.
4. Offline-camera detection with a grace period so brief reconnects do not spam users.
5. Per-user and per-camera preferences, quiet hours, and immediate mute/revocation.
6. Generic lock-screen copy and authenticated deep-link re-fetching.
7. Account-deletion, session-revocation, and household-access cleanup/audit behavior.
   Physical Android and installed-PWA delivery tests—including Doze, permission denial, FID
   rotation, logout, uninstall, and offline recovery—remain required after the owner creates
   the sender credential and VAPID pair. Generate two independent 32-byte base64url values
   for `NOTIFICATION_ENCRYPTION_KEY` and `NOTIFICATION_FINGERPRINT_KEY`; never reuse a VAPID,
   TURN, session, or backup key.

See ADRs 0043–0044 and the notification milestone in `roadmap.md`.
