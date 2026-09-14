# Firebase and web-push setup

Updated September 11, 2026.

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
  and `firebase-messaging`
- FCM auto-initialization: disabled until notification consent is implemented

Reinstall a downloaded Android configuration with:

```powershell
.\scripts\Install-BeaconFirebaseAndroidConfig.ps1 `
  -SourcePath 'C:\Users\you\Downloads\google-services.json'
```

The script rejects a file that is not registered for Beacon's Android package. Never
substitute a Firebase Admin SDK or service-account JSON file here.

## Remaining private infrastructure

### Android sender credential

Create a dedicated Google Cloud service account such as `beacon-fcm-sender` in project
`beacon-view-158ad`. Grant only the permission required to send FCM messages (the
Firebase Cloud Messaging API Admin role is the current predefined sender role). Create
one JSON key only after the backend sender implementation is ready to consume it.

On the Oracle VM:

1. Create `/etc/beacon/secrets` owned by root and readable only by the service process.
2. Place the key at `/etc/beacon/secrets/firebase-fcm-sender.json` with mode `0600`.
3. Set `GOOGLE_APPLICATION_CREDENTIALS` to that path and
   `FIREBASE_PROJECT_ID=beacon-view-158ad` in `/etc/beacon/production.env`.
4. Mount only that file read-only into the backend container.
5. Rotate the key after deployment proof and immediately if exposure is suspected.

Do not paste the key into chat, GitHub, a GitHub Actions variable, source code, Docker
build context, logs, or screenshots.

### PWA VAPID pair

VAPID does not require an account and does not require a Firebase Web app. Generate one
P-256 key pair when the web subscription endpoint is implemented. Store the private key
only in `/etc/beacon/production.env` (or a root-owned secret file), and expose only the
public key through authenticated application configuration. Use
`https://beacon.builtbysai.com` as the VAPID subject/contact identity.

Generating a Firebase-console Web Push certificate now would create a long-lived key
before the server has a secure consumer. The roadmap therefore defers generation until
the notification transport milestone.

## Free-service boundary

FCM delivery and standards-based Web Push/VAPID can start at no service cost. The Oracle
VM and PostgreSQL remain Beacon's application infrastructure. Firebase is not used for
accounts, database storage, media, analytics, or recordings. Provider quotas and terms
still apply, and free delivery is not a reliability SLA.

## Implementation gate

Before enabling FCM or asking for notification permission, implement and test:

1. Authenticated Android and web subscription create/rotate/delete endpoints.
2. Envelope encryption for provider tokens with a separately managed server key.
3. A transactional outbox with deduplication, bounded retries, and invalid-token cleanup.
4. Offline-camera detection with a grace period so brief reconnects do not spam users.
5. Per-user and per-camera preferences, quiet hours, and immediate mute/revocation.
6. Generic lock-screen copy and authenticated deep-link re-fetching.
7. Account-deletion, session-revocation, and household-access cleanup/audit behavior.
8. Physical Android and installed-PWA delivery tests, including Doze, permission denial,
   token rotation, logout, uninstall, and offline recovery.

See ADR 0043 and the notification milestone in `roadmap.md`.
