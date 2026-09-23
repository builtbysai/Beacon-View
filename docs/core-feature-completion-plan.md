# Core feature completion plan

Updated September 16, 2026. This plan is the execution order for completing the
backend and device contracts before the UI/UX and release-documentation pass.

## Definition of done for the core

Each feature is complete only when its API contract, authorization policy,
failure/retry behavior, persistence, automated tests, and production evidence
are all present. A screen that renders without a working end-to-end contract is
not considered complete.

## Execution order

### 1. Notifications and security events

- [x] Correct FCM registration-token enrollment and provider payloads (the
      client was sending the Firebase Installation ID, not the actual
      messaging token -- push could never have worked).
- [ ] Verify Web Push and FCM delivery, unsubscribe, invalid-token cleanup,
      retries, quiet hours, offline/recovery transitions, and lock-screen
      redaction -- Chrome Web Push baseline passed; native FCM and the
      remaining physical acceptance matrix are still open (N1/N2).
- [x] Add a shared security-event outbox for sign-in, email changes,
      membership changes, and device revocation (ADR 0053). Password changes
      and account deletion get an email alert instead of an outbox entry --
      both revoke every session, which would revoke the very push
      subscription meant to carry the alert; see the ADR's Consequences.
      Security events have no per-device preference row to be silenced with.
- [x] Add operational metrics for each delivery sweep: counts of delivered,
      permanently-failed and retryably-failed deliveries, broken down by
      channel and by the already-public `safePayload.category` -- never
      `providerMaterial` or payload content (`notification-job.ts`,
      `runNotificationSweep`, unit-tested including an explicit assertion
      that the logged summary never contains the provider token). Still
      open: physical/operational delivery evidence itself, which this
      instrumentation is a prerequisite for, not a substitute for.

### 2. Household and sharing completion

- Finish invitation acceptance, expiry, revocation, resend, and transactional
  email evidence.
- Test owner/admin/viewer/guest authorization across REST, WebSocket, TURN,
  Listen/Talk, camera settings, and device pairing.
- Close active sessions and sockets immediately after membership, grant, or guest
  expiry changes.
- [x] Add notification events for acceptance and removal (ADR 0053's
      `household_membership_changed` security event); invitation
      create/resend/revoke stay email-only since a pending invitation has no
      confirmed session to alert. Fixed a targeting bug where member removal
      alerted the acting admin instead of the removed member -- see
      [roadmap.md](roadmap.md)'s September 15 sharing-foundation update.

### 3. Account recovery and hardening

- [x] Add verified-email state and single-use hashed verification tokens.
- [x] Add enumeration-resistant password-reset requests, bounded retries, token
      expiry/consumption, session revocation after reset, and a
      change-alert email (ADR 0052).
- [x] Add a `/api/account/reauth` endpoint so the existing 10-minute
      sensitive-action reauth window (account deletion today) can refresh
      without a full re-login; still needs wiring into email-change and
      other future high-impact-membership/credential routes as they're built.
- [x] Run the authentication/CSRF/session/rate-limit review before recording
      access — done retroactively (recording shipped first). Audited every
      state-changing route: cookie-authenticated ones consistently require
      `authenticateStateChange`/`authenticateHouseholdAdminStateChange`
      (session-bound CSRF token, constant-time compared, not naive
      double-submit); device routes use bearer credentials, immune to CSRF
      by design; no secrets found leaking into audit metadata or logs. One
      real finding fixed: `RateLimiter`'s internal map never evicted stale
      keys, so an attacker cycling through distinct emails/IPs against
      password-reset/login could grow it unboundedly for the process
      lifetime — added a periodic sweep (`rate-limit.test.ts`).
- [x] Wire verification, reset, and account-deletion reauthentication into
      the web UI. Password reset and verification shipped in the frontend
      integration baseline; account deletion now prompts for the existing
      password reauthentication contract when its ten-minute window expires
      (ADR 0062).
- [ ] Non-silenceable push/in-app security alerts belong with step 1's
      notification outbox, not this step — email alerts ship here instead.

### 4. Recording foundation and Google Drive export

- [x] Add explicit recording consent and a short-clip lifecycle (requested,
      recording, uploaded, failed, deleted) with retention and deletion
      semantics. (Backend contract shipped September 15; the state machine's
      `recording` state is never actually set — the server jumps
      `requested` → `uploading` directly — noted as a real but harmless
      naming/observability gap, not fixed this pass.)
- [x] Start with explicit user-triggered or motion-triggered short clips; no
      hidden or continuous recording. User-triggered capture ships on both
      web (viewer and browser-camera modes) and Android; motion-triggered
      capture is server-authoritative (a new per-camera `recordOnMotion`
      setting gates whether the motion-event response hands the device a
      `recordingId` to act on) and ships on both platforms. September 16,
      commit `314ff37` — see
      [development-handoff.md](development-handoff.md)'s September 16 entry
      for the full breakdown and what's still unverified.
- [ ] Store only metadata and opaque provider IDs in Beacon (done — media
      never transits Beacon's server). Media must be encrypted before
      leaving the camera and must not be persisted by Beacon: the
      "must not be persisted by Beacon" half holds; **the "encrypted before
      leaving the camera" half does not yet** — neither the browser nor the
      Android capture path encrypts a clip before the resumable upload PUT to
      Drive. This is a real deviation from ADR 0051's stated scope, not an
      oversight to silently close — flag before calling recording
      release-ready.
- [x] Use a separate Google OAuth grant with the least-privileged
      `drive.file` scope for user-visible recording files, kept separate
      from the existing `drive.appdata` connection.
- [x] Implement resumable upload, listing, deletion, and Drive-verification-
      mismatch handling (`finalizeRecordingUpload` calls
      `verifyDriveRecordingFile` before trusting the client's completion
      claim). Playback authorization, retry UX, quota/full-disk handling, and
      provider-disconnect recovery are not separately exercised yet.

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
