# Project review and pending work — October 9, 2026

## Registration follow-up — October 9, 2026

Owner completed Cast (US$5) and Play (US$25) developer-account payments.
Beacon's custom receiver is now registered, unpublished, with ID `E850DDA7`.
Production `CAST_APP_ID` is configured and the backend was recreated using its
existing deployed Compose file. Running configuration and HTTP checks passed
(health/readiness/receiver 200, unauthenticated Cast configuration 401).
No application code release, migration, commit or push was performed.

Cast still needs a registered physical test device and signed-in/TV acceptance.
The Play Console visibly reports **Google is verifying your identity** and
**Verify your contact phone number — Action required**. Phone verification depends
on identity approval; **Create app** is currently disabled. No app listing,
release, identity-document submission or Play signing enrollment was attempted.
Account payment therefore does not close Android release readiness.

## Review baseline

The supplied `C:\Dev\Beacon-SecureView` checkout initially had `main` at
`1fc80fa`. Claude's clean checkout at `C:\Dev\Beacon-Desktop` was on
`claude/handoff-2026-10-09`, commit `80e53c5`. This review compares those local
refs; it does not establish the current remote HEAD. Documentation work uses
`codex/cast-registration-guide`, based on Claude's handoff, without modifying
Claude's checkout, committing, pushing, or starting a product milestone.

Reviewed the product brief, roadmap, core completion plan, October 9 handoff,
ADRs 0089–0097, recent commit/file changes, Cast sender/receiver and backend
configuration, guest viewer, and deployment wiring. Production deployment and
desktop-update statements below are **handoff evidence**, not a fresh production
or hardware acceptance run.

## Current product and Claude's changes

Beacon uses a Fastify/TypeScript backend and PostgreSQL for accounts, household
grants, device pairing, presence, events and WebRTC signaling. Android camera
capture remains visible and privacy-controlled. The React web/PWA viewer and
Electron desktop shell share the canonical web experience. Live media uses
WebRTC with TURN fallback; explicit short recordings are encrypted for export
to user-owned Google Drive. Later approved ADRs supersede the original brief's
desktop and short-recording exclusions; they do not authorize hidden capture,
facial recognition, or unrestricted platform expansion.

Since the initial local main, PRs #84–#92 add:

- Web zoom/pan, local snapshots, hold-to-talk, keyboard help, app shortcuts and
  camera/clip alert links (ADR 0090).
- A camera wall, persistent PiP mini-player, per-camera-authorized Announce,
  and viewer-requested Data saver (ADR 0091).
- Android motion ignore zones with a 16×16 stored grid mapped onto the existing
  16×12 luma samples, rotation-aware and per lens (ADR 0092; migration 0034).
- Low-battery/overheating alert episodes using current telemetry and the existing
  notification worker (ADR 0093; migration 0035).
- Manual/scheduled Home/Away, motion-alert muting, and optional Android-camera
  pause. Automatic resume is opt-in and only resumes cameras Home paused
  (ADR 0094; migration 0036).
- Android viewing tools/launcher shortcuts and desktop tray favorites/wall
  entry points (ADR 0095).
- Split Android Monitor pages and a 3 GB Gradle heap, plus CI action runtime
  updates (ADR 0096 and C18).
- Web Cast-to-TV via a custom receiver and a four-hour view-only guest link
  (ADR 0097). No native Android or Electron sender exists.

The handoff reports backend/web deployed from `33c4848`, migrations 0034–0036
verified, desktop 0.4.0 published and installed on the owner's Windows computer.
The latest local handoff includes a desktop-resume test synchronization fix.

## Pending work

Completed code does not close a physical, operational, or reviewer gate.
Preserve the roadmap's existing priority and one-milestone-at-a-time rule.

| Priority/scope                 | What remains                                                                                               | Evidence or decision needed                                                                                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current Cast activation        | Register developer account/custom receiver and test device; configure `CAST_APP_ID`; recreate backend      | Real TV video, compatibility, guest-link revocation/expiry and privacy tests. See [registration guide](google-cast-registration.md).                                                                                                                                                 |
| Current convenience acceptance | Desktop 0.4.0 tray favorites/wall entry; Android two-finger pinch                                          | Installed Electron and physical multi-touch device results.                                                                                                                                                                                                                          |
| N1 / P0                        | Android privacy/recovery acceptance                                                                        | Active-Listen microphone release, remote frames after lens switches, late viewer and network recovery; preserve paired device data.                                                                                                                                                  |
| N2 / P0                        | Google sign-in and media acceptance                                                                        | Chooser/cancel/return, audible Listen/Talk, speaker/Bluetooth/echo, competing Talk owners, teardown, direct/forced TURN on separate networks.                                                                                                                                        |
| Recording / U7                 | Real Drive-backed browser and Android recording lifecycle                                                  | Upload, local decryption/playback, retry/reconnect and deletion; Android-to-browser playback, Android thumbnail capture and native clip sharing/export evidence. Some UI is implemented; historical partial rows need reconciliation.                                                |
| Push / sharing                 | Native FCM and lifecycle/operational acceptance                                                            | Opt-in/unsubscribe, token invalidation, quiet hours, security/lock-screen copy, email inbox/bounce/complaint evidence and remaining multi-account review. Some physical sharing results already exist.                                                                               |
| N3 / P0                        | Operational backups                                                                                        | Restore drill passed historically; timers remain disabled. Owner must choose RPO/RTO/operator and authorize scheduling, then prove retention/expiry. Never restore over live data.                                                                                                   |
| N4 / P0                        | Email/operator identity                                                                                    | Domain/TLS cutover already recorded. Remaining sender alignment/delivery/bounce/complaint and public operator decisions; do not treat DNS setup as wholly unbuilt.                                                                                                                   |
| N5 / P0                        | MFA/passkeys                                                                                               | Approved in principle, not implemented. Decide credential-loss recovery and whether passkey-only accounts are allowed before implementation.                                                                                                                                         |
| N6 / P0                        | Security/release gate                                                                                      | Independent review, Android signing/AAB/versioning, staged release/rollback and Play readiness. Desktop code signing remains deferred; do not buy certificates implicitly.                                                                                                           |
| N7 / P0                        | Trust/legal/support operations                                                                             | Owner/reviewer-approved legal copy, retention and Play disclosures, support SLA, incident operator, identity checks and response deadlines.                                                                                                                                          |
| N8 / P1, U7                    | Accessibility/parity acceptance                                                                            | Remaining browser keyboard/focus/screen-reader checks, native TalkBack, scaling/rotation/tablet/foldable evidence, registration and real clip acceptance. Browser-opened Trust/Contact pages are an owner-accepted U7 exception (September 28), not a pending native implementation. |
| N9 / P1                        | Performance and operations                                                                                 | Older-device CPU/memory/heat/battery, direct/TURN bandwidth, sustained viewing/recovery, safe viewer limits and monitoring ownership.                                                                                                                                                |
| OAuth release operation        | Publish Google OAuth consent to production                                                                 | Owner completes provider requirements; assess verification requirements against actual scopes. Handoff reports Testing-mode Drive grants expiring after seven days.                                                                                                                  |
| Deferred                       | Trained smart detection, IP-camera integration, iOS, account export/support expansion, additional profiles | Separate approved scope and relevant model/hardware/security/privacy evidence. The detector experiment is foundation only; no trained inference is wired into production.                                                                                                            |

`MonitorHomeState` now groups the existing state; a view-model refactor remains
a future engineering step needing its own tests, not a release gate by itself.
The handoff also records deletion of another Claude session's worktree without a
delivered warning. This is an unresolved workspace-coordination issue; no
recovery or deletion was attempted during this review.

## Roadmap inconsistencies found (reconciled in the follow-up)

- C1, C2, C6, C7, C9, C14, C15 and C16 still say **Planned**, but their
  implementation exists in the reviewed branch. The handoff's statement that
  all convenience rows say Done is inaccurate. Track implemented versus
  physically accepted rather than rebuilding these features.
- C8 says Done but still lists **None yet / n/a** for platform/milestone, and
  the owner-decision section still says its receiver design is deferred.
  ADR 0097 supersedes that decision: web sender built, activation/hardware
  acceptance pending.
- Location-based Home/Away is not requested according to the October 9 handoff;
  it should not be treated as an active pending implementation.
- Older paragraphs still describe browser naming as the current milestone,
  recording as disabled, profiles as wholly unimplemented, and parity as tied
  to an old branch. Later desktop/profile/recording/U7 changes supersede those
  statements. The header's September 12 date also predates October entries.
- Ignore zones and health alerts now have implementations. Remaining
  calibration/thermal/device evidence, room labels, and true privacy masks
  should be tracked separately from those completed foundations.
- ADR 0097 says video comes from Beacon's server. The implemented receiver
  embeds the existing WebRTC guest viewer; it does not add a server video relay.
  Media remains direct or TURN-relayed. That wording needs technical correction.

The subsequent approved documentation cleanup reconciles the convenience tables,
Cast deferral, and current-scope header while preserving dated historical evidence. It records conflicts so its next status update can reconcile them without
mistaking shipped code for release acceptance or authorizing deferred work.
