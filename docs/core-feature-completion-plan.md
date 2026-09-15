# Core feature completion plan

Updated September 14, 2026. This plan is the execution order for completing the
backend and device contracts before the UI/UX and release-documentation pass.

## Definition of done for the core

Each feature is complete only when its API contract, authorization policy,
failure/retry behavior, persistence, automated tests, and production evidence
are all present. A screen that renders without a working end-to-end contract is
not considered complete.

## Execution order

### 1. Notifications and security events

- Correct FCM registration-token enrollment and provider payloads.
- Verify Web Push and FCM delivery, unsubscribe, invalid-token cleanup, retries,
  quiet hours, offline/recovery transitions, and lock-screen redaction.
- Add a shared security-event outbox for sign-in, password/email changes,
  membership changes, device revocation, and account deletion. Security events
  cannot be silenced like motion alerts.
- Add delivery evidence and operational metrics without logging tokens or media.

### 2. Household and sharing completion

- Finish invitation acceptance, expiry, revocation, resend, and transactional
  email evidence.
- Test owner/admin/viewer/guest authorization across REST, WebSocket, TURN,
  Listen/Talk, camera settings, and device pairing.
- Close active sessions and sockets immediately after membership, grant, or guest
  expiry changes.
- Add notification events for invitations, acceptance, removal, and revocation.

### 3. Account recovery and hardening

- [x] Add verified-email state and single-use hashed verification tokens.
- [x] Add enumeration-resistant password-reset requests, bounded retries, token
      expiry/consumption, session revocation after reset, and a
      change-alert email (ADR 0052).
- [x] Add a `/api/account/reauth` endpoint so the existing 10-minute
      sensitive-action reauth window (account deletion today) can refresh
      without a full re-login; still needs wiring into email-change and
      other future high-impact-membership/credential routes as they're built.
- [ ] Run the authentication/CSRF/session/rate-limit review before recording
      access — recording (step 4) shipped ahead of this review; still owed.
- [ ] Wire verification/reset/reauth into the web UI (belongs with step 6).
- [ ] Non-silenceable push/in-app security alerts belong with step 1's
      notification outbox, not this step — email alerts ship here instead.

### 4. Recording foundation and Google Drive export

- Add explicit recording consent and a short-clip lifecycle (requested,
  recording, uploaded, failed, deleted) with retention and deletion semantics.
- Start with explicit user-triggered or motion-triggered short clips; no hidden or
  continuous recording.
- Store only metadata and opaque provider IDs in Beacon. Media must be encrypted
  before leaving the camera and must not be persisted by Beacon.
- Use a separate Google OAuth grant with the least-privileged `drive.file` scope
  for user-visible recording files. The existing `drive.appdata` connection is
  for Beacon metadata/settings and cannot be used as a recordings library.
- Implement resumable upload, listing, playback authorization, deletion, retry,
  quota/full-disk handling, and provider-disconnect recovery.

### 5. Integration and operational proof

- Run migration/restore checks, backup recovery, rate-limit and authorization
  suites, direct/TURN WebRTC checks, and Android reconnect/background checks.
- Deploy backend and migrations together with rollback notes.
- Record physical-device evidence for Pixel camera, audio, notifications, sharing,
  and clip upload/playback.

### 6. UI/UX pass (after core)

- Rework settings, sidebar, recording controls/library, notification states,
  household management, and recovery guidance against the finished contracts.
- Add accessibility, responsive, loading, empty, error, and reconnect states.

### 7. Release gate (last)

- Privacy/trust/legal copy, Google OAuth verification, email-domain operations,
  support/retention disclosures, SBOM/CI/signing/staged rollout, and final
  security review.

## Explicit scope boundaries

Beacon will not claim end-to-end encryption unless the implemented key model and
threat model support that claim. Cloud recording is opt-in, visible to the camera
user, short-clip based, and disabled while privacy mode is active. Google Drive
is a user-owned cloud processor and recordings consume the user's quota.
