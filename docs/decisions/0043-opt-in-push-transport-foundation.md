# ADR 0043: Establish opt-in push transport foundations

Status: Superseded in part by ADR 0044 on September 12, 2026.

## Context

Beacon needs offline-camera, motion, account-security, and household-access alerts on
Android and installed web applications. Notification delivery introduces identifiers
that can address a specific app installation, lock-screen privacy concerns, background
execution, and another privileged server credential. It must not silently enroll a user
or turn Firebase into a second source of truth.

The owner created Firebase project `beacon-view-158ad` and registered Android package
`com.beaconsecureview.camera`. The Firebase console confirms that Cloud Messaging HTTP
v1 is enabled and the legacy messaging API is disabled. The project remains on the
no-cost Spark plan.

## Decision

- Use Firebase Cloud Messaging HTTP v1 for Android delivery.
- Keep PostgreSQL as Beacon's only application database. Do not add Firestore, Firebase
  Authentication, Firebase Storage, Analytics, or Crashlytics merely because FCM is in
  use.
- Use the Firebase Android BoM and the main `firebase-messaging` module; do not use the
  retired KTX artifact.
- Install `google-services.json` locally through a validating script and ignore it in
  Git. Firebase documents this client file as non-secret, but keeping environment-bound
  configuration out of source avoids accidental cross-environment coupling.
- Disable FCM automatic initialization. A later notification milestone may enable it
  only after an authenticated user sees Beacon's explanation, opts in, and grants the
  Android notification permission.
- Never log provider registration identifiers. Store server-side Firebase Installation
  IDs (FIDs) and browser push subscriptions encrypted at
  rest, associate them with an authenticated account session and installation, rotate
  them, and delete them immediately on sign-out, revocation, account deletion, or
  provider invalidation.
- Use a dedicated least-privilege Google service account for the Oracle backend and FCM
  HTTP v1. Its JSON key stays outside Git and outside container images, mounted
  read-only from `/etc/beacon/secrets/` and rotated. Do not use the broad default
  Firebase Admin service account if a narrower sender account can be created.
- Use the standard browser Push API with an application-owned VAPID key pair for the
  PWA. The public key may be served to clients; the private key remains an Oracle
  secret. A separate Firebase Web app or Firebase JavaScript SDK is not required for
  this design.
- Notifications are hints, not authority. Opening an alert must re-fetch authorized
  state from Beacon; payloads must not contain camera images, household names, email
  addresses, access tokens, or other sensitive detail.

## Consequences

ADR 0044 implements the deferred delivery behavior with the current Firebase
Installation ID API. Automatic initialization remains disabled until an authenticated
user explicitly enables notifications on that installation.

The remaining console actions create persistent credentials and therefore require an
explicit operator confirmation at the moment they are performed. They are tracked in
the setup guide and roadmap rather than represented as complete.
