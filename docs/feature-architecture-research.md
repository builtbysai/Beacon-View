# Feature architecture research: recovery, notifications, sharing, and recording

Updated September 10, 2026. This is design research, not implementation approval.

## Recommended sequence

1. Finish modularization and characterization tests.
2. Add verified email, password recovery, and sensitive-action reauthentication.
3. Add security alerts and push-subscription lifecycle.
4. Add motion/offline notification preferences and delivery.
5. Add household invitations, roles, camera grants, expiry, and revocation.
6. Evaluate local and user-owned recording as a separate privacy milestone.

Recovery and security alerts precede sharing because an invitation increases the number
of identities and sessions that can reach a household. Recording remains last because it
changes the current promise that Beacon does not retain media.

## Free and low-cost foundation

| Need                | Recommended alpha option                                                                         | Cost boundary and reason                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transactional email | Existing Resend integration on an owned domain                                                   | The current free plan includes 3,000 transactional emails per month and 100 per day. Delivery, bounce, complaint, and sender-domain operations still need an owner.                         |
| PWA push            | Standards-based Web Push using VAPID and the open-source `web-push` server library               | No messaging vendor fee. Browser push services still transport messages; endpoints and keys are security-sensitive data.                                                                    |
| Native Android push | Firebase Cloud Messaging                                                                         | FCM is currently a no-cost Firebase product. Use direct device tokens, not broad topics, for household events.                                                                              |
| Passkeys            | WebAuthn with `@simplewebauthn/server` and `@simplewebauthn/browser`; Android Credential Manager | Open-source libraries and platform APIs avoid a hosted authentication vendor. Beacon keeps only public-key credentials and metadata.                                                        |
| Password/MFA        | Existing Argon2id passwords plus standards-based TOTP only if owner policy requires it           | No hosted-auth fee. Prefer passkeys over SMS; SMS is neither free nor the preferred recovery factor.                                                                                        |
| Invitations         | Hashed, expiring invitation tokens stored in PostgreSQL and delivered by transactional email     | No new service. Manual copy-link delivery can remain a private-alpha fallback.                                                                                                              |
| Recording           | Encrypted local clips first; optional direct upload to the user's Google Drive later             | Local storage has no provider cost. Drive API calls have no additional cost within current quotas, but recordings consume the user's Drive storage and Google Drive is still cloud storage. |

Self-hosting outbound SMTP appears free but creates deliverability, abuse, reputation,
SPF/DKIM/DMARC, bounce, and blocklist operations. It is not the cost-conscious choice for
security messages. A vendor abstraction should keep Resend replaceable without building a
mail server.

## Account recovery and security

### Data contracts

- Add `email_verified_at` to users.
- Store password-reset and email-verification tokens only as hashes with purpose, user,
  creation, expiry, consumed time, and attempt count.
- Invalidate older tokens when a new token is issued or the password/email changes.
- Keep responses enumeration-resistant: requesting recovery returns the same response for
  existing and unknown addresses.
- Add per-IP and per-account-hash limits, bounded outbox retries, and audit events that do
  not reveal tokens.
- Revoke other browser and mobile monitor sessions after password reset; camera-device
  credentials should remain paired unless the user explicitly removes them.

### Reauthentication

Sensitive operations should require a server-issued recent-auth proof, not a client-side
timestamp. Password users re-enter their password; Google users complete Google sign-in;
passkey users complete a WebAuthn assertion. The backend updates `reauthenticated_at` only
after verifying that proof. Account deletion, email change, passkey removal, MFA changes,
ownership transfer, and high-impact member changes consume this policy.

### Passkeys and MFA

Use a maintained server library rather than implementing WebAuthn verification. Store the
credential ID, public key, counter, transports, friendly label, creation/use timestamps,
and owning user. Challenges are random, short-lived, purpose-bound, and single-use.
Biometric material never reaches Beacon; the platform performs user verification.

Passkeys should become the preferred additional sign-in method after verified recovery is
available. If TOTP is later enabled, encrypt its secret at rest, require reauthentication
to enroll/remove it, show a QR only once, and issue hashed single-use recovery codes. Do
not use email or SMS as the only strong factor.

### Security alerts

Create one domain event/outbox for new sign-in, password changed, email changed, passkey or
MFA changed, member invited/accepted/removed, device revoked, and account deletion. Email
and push delivery consume the same event id for deduplication. Security alerts cannot be
silenced entirely; motion and offline alerts can.

## Push notifications and offline-camera alerts

### Architecture

- `notification_subscriptions`: user, channel (`web_push` or `fcm`), encrypted endpoint or
  token, public push keys where applicable, device label, created/last-success timestamps,
  and revoked timestamp.
- `notification_preferences`: user/camera, motion enabled, offline enabled, quiet schedule,
  time zone, and lock-screen detail level.
- `notification_outbox`: immutable event id, recipient, category, safe payload, next
  attempt, attempt count, delivered/terminal timestamps.
- A bounded worker claims rows transactionally, retries with exponential backoff, and
  removes dead subscriptions on permanent provider responses.

Offline alerts should be state transitions, not a message every heartbeat cycle. Mark a
camera offline only after the existing presence window plus a configurable grace period;
send one notification, then one recovery notification when it returns. Motion events use
the existing cooldown and a per-camera notification preference. Default lock-screen text
should be generic (for example, “Beacon detected activity”) unless the user opts into
camera names.

The current service worker must keep API responses and camera state out of caches. Push
handling belongs in a small separate module imported by the service worker, with no session
tokens in notification payloads.

## Household sharing

### Authorization model

Use explicit membership and grants rather than copying owner checks across routes:

- `household_members`: household, user, role, status, joined time, optional expiry.
- Roles: `owner`, `admin`, `viewer`, `guest`.
- `camera_grants`: member plus camera source or device; absence means no camera access for
  viewer/guest. Owner and administrator policy is evaluated centrally.
- `household_invitations`: household, normalized invited email, role, hashed token,
  inviter, expiry, accepted/revoked timestamps.

Recommended capabilities:

| Capability                          |                     Owner |                          Admin |       Viewer |             Guest |
| ----------------------------------- | ------------------------: | -----------------------------: | -----------: | ----------------: |
| View granted cameras                |                       Yes |                            Yes |          Yes | Yes, until expiry |
| Listen/Talk on granted cameras      |                       Yes |                   Configurable | Configurable |      Configurable |
| Change camera settings/privacy      |                       Yes |                            Yes |           No |                No |
| Pair/remove devices                 |                       Yes |                            Yes |           No |                No |
| Invite/revoke members               |                       Yes | Yes, except owner/admin policy |           No |                No |
| Delete household/transfer ownership | Yes with reauthentication |                             No |           No |                No |

Every REST read, mutation, WebSocket upgrade, TURN credential issue, event subscription,
and media-control message must call the same authorization policy. Revocation and guest
expiry close active sockets and talk locks immediately. Audit invitation creation,
acceptance, role/grant changes, expiry, revocation, and denied access without logging the
invitation token.

Ownership transfer needs a dedicated, reauthenticated two-party flow and should not be in
the first sharing release.

## Local and user-owned recording

### Important clarification

Google Drive is cloud storage. Direct-to-Drive means Beacon's servers never store the
recording bytes; it does not mean the recording is not in a cloud. Google controls the
storage service, the file consumes the user's quota, and Beacon must accurately disclose
that processor and access model.

### Option A: local-only encrypted event clips

This best preserves the present architecture. The camera device keeps a size- and
time-bounded encrypted ring buffer in app-private storage. Only an explicit user setting
enables it. Privacy mode stops capture and clears pending frames immediately. The app
handles full disk, device theft, app uninstall, and key loss explicitly.

Limitations: remote playback requires the camera to be online, clips disappear with the
device, and CameraX/WebRTC/analysis concurrency must be measured on older hardware.

### Option B: direct upload to the user's Google Drive

Use a separate Google OAuth grant with the narrow `drive.file` scope; do not reuse Google
sign-in as implicit Drive consent. The Android camera encrypts and uploads short completed
clips directly with resumable upload. Beacon stores only an opaque Drive file id, camera
event association, duration, size, checksum, and retention state. OAuth refresh tokens
must remain on the camera device in encrypted storage if uploads originate there.

This avoids Beacon media storage and media egress, but cross-device playback and household
sharing are difficult: the viewer needs an authorized Drive grant, Drive file sharing, or
a Beacon-held decryption/access mechanism. Any server-side Drive token or decryption key
would weaken the “Beacon never has access” model. Continuous recording is not recommended;
short motion clips are more compatible with phone heat, bandwidth, quotas, and resumable
uploads.

### Other free user-owned alternatives

- Removable/local storage: simplest and most private, but no remote playback guarantee.
- User NAS via SFTP/WebDAV: no Beacon storage cost, but high setup/support burden and a
  large credential/network attack surface.
- Syncthing or a user-managed Nextcloud folder: open source and user controlled, but not a
  consumer-simple built-in workflow.

Recommendation: prototype local encrypted motion clips behind a feature flag only after
the current no-recording milestone closes. Evaluate direct Drive export as an optional
destination, not as the capture system's primary storage layer.

## Sources

- [Firebase pricing: Cloud Messaging is no-cost](https://firebase.google.com/pricing)
- [Firebase Cloud Messaging for web](https://firebase.google.com/docs/cloud-messaging/web/get-started)
- [Open-source Node Web Push implementation](https://github.com/web-push-libs/web-push)
- [Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing)
- [Google passkey overview](https://developers.google.com/identity/passkeys)
- [Google server-side passkey guidance](https://developers.google.com/identity/passkeys/developer-guides/server-authentication)
- [SimpleWebAuthn documentation](https://simplewebauthn.dev/docs/)
- [Google Drive OAuth scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Drive resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google Drive API quotas and pricing](https://developers.google.com/workspace/drive/api/guides/limits)
