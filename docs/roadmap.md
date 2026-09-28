# Beacon delivery roadmap

Updated September 12, 2026. This is the single actionable roadmap and current scope
authority. Detailed release gates remain in
[pre-deployment-readiness.md](pre-deployment-readiness.md).

The owner approved a maintainability milestone on September 10–11: refactor existing
Android, web, and backend code into reviewable feature/security boundaries without
changing product behavior, and research recovery, notifications, sharing, and user-owned
recording before those features receive implementation scope. ADR 0041 records the code
boundary decision; [feature-architecture-research.md](feature-architecture-research.md)
records the proposed sequencing and cost-conscious options. Existing release blockers
remain higher priority than shipping the researched features.

On September 11 the owner approved the Firebase notification foundation. Android is now
registered with Firebase project `beacon-view-158ad`, FCM HTTP v1 is enabled, and the
client build is integrated with opt-in auto-initialization disabled. ADR 0043 and
[firebase-notifications-setup.md](firebase-notifications-setup.md) define the remaining
credential and delivery milestone. This foundation does not authorize user-visible
alerts, Firestore, Firebase Auth, analytics, or cloud media storage.

On September 12 the owner approved Notification Transport v1. ADR 0044 records the
local authenticated Android/Web Push subscription lifecycle, envelope-encrypted provider
identifiers, per-camera preferences and quiet hours, transactional outbox, bounded worker,
generic payloads, and 90-second presence plus 120-second offline grace. A dedicated,
least-privilege FCM sender identity and owner-confirmed JSON key now exist. The VAPID pair
and independent notification application keys were also generated directly into a
user-private location. Root-only production copies, migration 0014, the
notification-enabled backend, and the matching web/service-worker build were deployed
to Oracle on September 12. Health/readiness, authenticated route protection, all five
new tables, the read-only credential mount, empty initial subscription/outbox state,
and deployed asset hashes were verified. Chrome on Windows Web Push opt-in plus real
motion, offline, and recovery delivery passed September 12. Native Android FCM and the
remaining physical lifecycle matrix remain gated.

On September 26 the Activity feed was split from a dedicated Clips library
(PR #72), with clips attached to the motion event that caused them instead of
appearing as their own timeline rows; clips gained keyset pagination,
per-camera-grant read access, time-limited external share links (ADR 0077),
and client-captured encrypted thumbnails for browser clips (ADR 0078,
Android capture still open). PR #73 replaced the manual-record control's
inert tooltip indicator with a persistent, accessible `RecordingBadge` and
made in-progress recordings abort intentionally (visible failure) if their
source stream drops or ends unexpectedly (ADR 0079). Both merged and are
live at `https://beacon.builtbysai.com`. The owner also approved N5's
MFA/passkey policy in principle, requested a research pass on purpose-built
camera use-case profiles (see
[camera-use-case-profiles.md](camera-use-case-profiles.md)), and requested an
Android/web feature-and-design parity pass (U7). None of the latter three are
implemented; see the relevant table rows and
[development-handoff.md](development-handoff.md)'s September 26 entry for
what to do next and in what order.

Between September 27 and 28, U7 advanced substantially on
`codex/android-clips-library`: household/sharing management gained
per-camera grant editing and a two-stage revoke-then-delete flow (physically
verified with a real second account); the sign-in/register/forgot-password
screens were audited against the PWA and two real bugs were fixed (a broken
enumeration-resistance guarantee on password reset, and a silently-dropped
Google sign-in failure/link-required case); the live-video connection
failure flagged in the parity audit was root-caused to a local dev
environment gap (an unstarted `coturn` container and a viewer STUN/TURN URL
still pointed at `127.0.0.1` instead of the Android-emulator host alias),
fixed with no code change, and confirmed with a stable multi-second live
connection; Talk (two-way audio) and the WebRTC quality-metrics panel were
implemented on the Android viewer (the camera/device side already had Talk
built) and verified end-to-end with a real microphone grant and live-updating
stats; and motion-settings save/apply now has a real, database-verified
acceptance round trip. Manual recording's request path was also verified
end-to-end (a real `503` from the backend, correctly surfaced) — this local
development environment simply has no Google Drive OAuth client configured
(production already does, per the September 25 production recording
follow-up below), so a genuine local Drive-backed capture needs that
environment's own credentials rather than any further engineering work. See
[development-handoff.md](development-handoff.md)'s September 27–28 entries
and [android-web-parity-audit.md](android-web-parity-audit.md) for full
detail on each item.

## Current scope and evidence

The backend completion sequence is tracked in
[core-feature-completion-plan.md](core-feature-completion-plan.md). The owner has
approved moving notifications, household/sharing completion, and user-owned
recording into the active engineering scope; the earlier no-recording hard
boundary is superseded for this milestone. Trust/legal/release documentation
remains intentionally last.

The Oracle private alpha completed its hard cutover to
`https://beacon.builtbysai.com` on September 11. DNS, TLS, deployment health, and the
OAuth authorization redirect are verified; interactive sign-in and physical Android
acceptance remain human evidence gates. Its internet availability is not broad-release
acceptance. `main` is the current source of truth as of the September 14-15 merge and
September 15 recording/FCM port described in
[development-handoff.md](development-handoff.md) — the `codex/notification-transport-v1`
worktree referenced by earlier revisions of this paragraph has been fully absorbed and
should not be treated as an active or authoritative source going forward.

September 24 browser pairing follow-up: ADR 0067 adds a direct browser camera
setup link, QR scanning with a manual-code fallback, and clearer guest connection
errors. A shared device-integration type contract begins the IoT design; no IoT
adapter is enabled. The first adapter still requires a separate protocol, privacy,
credential, household-authorization, and hardware acceptance review.

September 25 Android parity follow-up: ADR 0072 lets a signed-in Android Monitor
set up the same phone as a camera by creating and immediately consuming the
existing short-lived pairing code. Backend authorization, rate limits, auditing,
installation binding, and credential issuance remain unchanged. Physical N1
privacy and recovery evidence remains open until the installed build completes
the device matrix.

The recording completion batches add owner-only web/PWA playback (ADR 0068),
Android's streaming AES-GCM upload envelope (ADR 0069), and bounded recording
failure recovery (ADR 0070). Web/PWA also retains a failed encrypted clip in
memory for actionable provider-specific retry (ADR 0071). Beacon relays encrypted bytes from Drive, and the
browser checks and decrypts them locally. Clients now report terminal failures,
an hourly job releases stale work, and owners can remove failed entries.
Provider-specific retry guidance and real-account Android-to-browser playback
remain open acceptance work.

September 25 production recording follow-up: Chrome successfully captured and
encrypted two clips and Beacon opened both Drive resumable sessions, but the
cross-origin browser uploads failed before completion. Owner-created sessions
now bind to Beacon's configured web origin so the provider can authorize the
browser PUT; Android's native upload contract is unchanged. Physical upload,
playback, retry, and deletion verification remain open after deployment.

September 26 smart-detection foundation: the owner approved beginning the deferred
smart-detection experiment. ADR 0073 adds a decoupled `ActivityDetector` interface, a
heuristic placeholder implementation that is explicitly not a trained classifier, and a
reusable sustained-signal confirmation filter -- none of it called from production capture
code. `docs/cross-platform-and-iot-research.md` separately researches ONVIF/RTSP IP-camera
bridging and iOS/desktop client options; no implementation follows from the research alone.
Model selection, a default-off feature flag, and device evidence remain open, and IP
cameras/other clients still require their own design milestone per ADR 0067 and the table
below.

Notification Transport v1 is implemented through its Chrome Web Push baseline; native
FCM and the remaining physical acceptance matrix remain external evidence gates. On
September 12 the owner explicitly approved a bounded interface-reliability follow-up:
repair Android's always-available disconnect path, fix the collapsed-sidebar account
menu, modernize the sidebar without adding a component framework, and restructure web
notification settings. Viewer-count repair, background camera operation,
browser-camera naming, household/guest sharing, and user-owned Google Drive recording
remain separate batches after this follow-up.

Later September 12 the owner approved continued sequential roadmap implementation and
reported repeated live-view "Connection interrupted" errors plus inaccurate viewer
counts. ADR 0046 is implemented and deployed: recoverable WebRTC disconnects receive an
eight-second grace on the existing peer, only device-confirmed connections count as
viewers, and count changes publish immediately. A real Chrome-to-Pixel TURN session
remained stable for 40 seconds and returned the count to zero on exit.

ADR 0047 is also implemented on the Pixel: the Android foreground service survived an
Activity background transition, accepted a real TURN viewer, exposes **Pause camera**
from its ongoing notification, and reports battery-optimization restriction with a link
to Android settings. Browser-camera naming is the current bounded milestone. Sharing and
Drive remain subsequent security-sensitive milestones rather than being interleaved.

Source-verified foundations: Google browser OAuth and Android browser handoff;
password sign-in/registration; browser-session revocation and account deletion;
single-camera native Monitor; web local workspaces; visible capture/privacy;
motion metadata, sensitivity/cooldown and daily time-zone quiet hours; 1/7/30/90-day
metadata retention; device battery/charging; support contact form. These features
still need the physical and operational evidence below. Verified-email state,
enumeration-resistant password reset, and lightweight session reauthentication are
now implemented (ADR 0052) with automated integration coverage; MFA/passkeys and
zones are absent. Push transport is present
in the private alpha and remains default-off until explicit opt-in; Chrome Web Push is
proven, while native FCM and the remaining lifecycle acceptance are not yet complete.

Owners below are responsibilities, not new assignments to third parties:
**Engineering** = current development task; **Owner** = product/service owner;
**Device tester** = owner operating the Pixel and audio/network equipment;
**Reviewer** = independent security/legal/accessibility reviewer to be nominated.
An item closes only when its linked evidence records date, environment, result,
and remaining limitations; a passing build alone is insufficient.

## Ordered continuation queue — September 27, 2026

Work this queue from top to bottom, one milestone at a time. A blocked evidence
item stays open; it may be bypassed temporarily only when its required device,
owner decision, or reviewer is unavailable. Bypassing never counts as completion.

| Order | Roadmap scope                        | State                                    | Dependency and next action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | N1 Android privacy/recovery evidence | Ready on connected Pixel                 | Pixel `34171JEHN07672` is connected again; finish active-Listen release, remote frames after each lens switch, late-viewer, and network-loss/recovery checks without clearing app data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2     | N2 Google and media acceptance       | Ready after N1                           | Run chooser/cancel/return, audible Listen/Talk, teardown, Bluetooth/echo, competing-talker, direct, and forced-TURN matrix on separate networks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3     | Recording acceptance                 | Partially implemented                    | Re-prove browser Drive upload/playback/retry/deletion and Android capture-to-browser playback. Android thumbnails remain open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4     | Push and sharing acceptance          | Partially implemented                    | Prove native FCM, unsubscribe/invalidation, quiet hours, lock-screen copy, inbox/bounce handling, and physical multi-account sharing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5     | U7 Android/web parity                | In progress, most functional gaps closed | Clips listing/playback/deletion, owner/admin motion settings (save/apply acceptance now database-verified), backend-authorized 15-second manual recording (request path acceptance-verified against local dev, which lacks Drive OAuth credentials that production already has), household management with per-camera grants (physically verified), Talk and WebRTC quality metrics on the live viewer, a root-caused and fixed live-video connection failure, and the installed-PWA-matched visual/auth/navigation system are implemented and mostly acceptance-verified locally. Remaining: a real local Drive-backed capture (or defer to production, which is already configured), deployed registration acceptance, sharing/thumbnails for a real clip, native Trust/Contact pages (currently open in-browser, a normal pattern), and accessibility parity. |
| 6     | N3 recovery operations               | Decision/evidence blocked                | Owner sets RPO/RTO and recovery operator; then deliberately decide whether to enable timers and collect expiry/retention evidence. Never restore over live data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7     | N4 and N7 identity/trust operations  | Owner/reviewer blocked                   | Confirm public operator/sender identity, bounce/complaint handling, support SLA, incident owner, retention disclosures, and approve legal copy before publication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 8     | N5 MFA/passkeys                      | Design decision blocked                  | Decide whether passkey-only accounts are allowed and define lost-authenticator recovery; then design WebAuthn plus Android Credential Manager with password fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 9     | N6 release pipeline                  | Not started                              | Independent security review, protected signing, versioning/AAB, Play readiness, staged rollout, and rollback. Resolve GitHub Actions billing before treating CI as evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 10    | N8 accessibility/product QA          | Open                                     | Cross-browser assistive-technology checks plus TalkBack, font scaling, rotation, split-screen, tablet/foldable, and remaining responsive states.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11    | N9 capacity/operations               | Open                                     | Measure older-device decode, CPU/memory, thermal/battery, direct/TURN bandwidth, long sessions, reconnect storms, and backend limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 12    | Camera profiles                      | Awaiting owner selection                 | Research is complete. If approved, start with bounded Doorbell/Car/Baby presets; new detectors and continuous driving recording require later, separate decisions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Deferred work remains deferred: IP-camera adapters, additional installed-client
platforms, subscriptions, ads, continuous/hidden recording, facial recognition,
biometric storage, and customer-media AI training are not authorized by this queue.

## Now — release blockers

September 14 follow-up: device-bound reconnect codes now let an owner/admin
restore an existing Android camera from the signed-in viewer without deleting
its settings (ADR 0050). The camera-side battery setup card refreshes on resume,
and the Pixel confirms Beacon is in the user battery-exemption whitelist.
Android disconnect now uses an authenticated JSON action that revokes the
credential while retaining the device for repair. Camera/device availability is
derived from the authenticated producer socket instead of stale heartbeat
presence. The backend fix and matching Pixel build are live; physical disconnect,
reconnect, and repeated camera-flip acceptance remain open.

September 25 partial N1 evidence: the connected Pixel completed signed-in camera
setup, offline local privacy, offline process restart, validated-network recovery,
explicit resume, six front/rear switches, and foreground-service background survival.
CameraX released during privacy and did not restart before Resume. The active-Listen
microphone release, remote frame verification after every switch, denied-permission,
late-viewer, and N2 audio/TURN cases remain open; details are in
[testing-plan.md](testing-plan.md).

The same Pixel also passed the OS-level denied-permission recovery checks: removing
microphone access recreated Camera mode without audio, notification denial did not
interrupt an already-active camera, and a cold restart without notification access
failed closed with no capture. Restoring both permissions recovered capture without
clearing device state. Interactive denied-state tap-through remains open. The unlocked
Pixel privacy control now passes Pause/release/Resume acceptance. Camera mode replaces its ambiguous startup copy
with state-specific camera, persistent status, or optional microphone guidance.

| ID / priority | Action and owner                                                                     | Acceptance evidence / decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 / P0       | Physical privacy and recovery — Engineering + Device tester                          | Pixel `34171JEHN07672`: local Privacy while offline releases video/audio immediately; restart stays paused; reconnect reconciles safely. Switch front/rear repeatedly; lose/restore Wi-Fi; no stuck camera or rapid retry loop. Record build/device/network and observed capture indicators in [testing-plan.md](testing-plan.md). Still open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| N2 / P0       | Google and media acceptance — Device tester + Engineering                            | Android Monitor Google account chooser, cancel/failure/return; Listen starts muted; Talk only after consent; stop/navigation/disconnect/privacy release microphone. Audible speaker/Bluetooth and echo checks, competing talk owners, direct and forced TURN across separate networks. Physical results still open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| N3 / P0       | Prove backup recovery — Engineering + Owner                                          | September 25 restore drill passed: a temporary encrypted Object Storage snapshot restored into a separate empty database in 3 seconds; all 28 migration rows, 23 public tables, and aggregate user/household/camera/event/recording counts matched the source. Repository integrity passed, the verification database was dropped, and the temporary snapshot was forgotten and pruned so the owner-requested empty-backup state remains. Still open: backup timers are disabled, retention/expiry needs scheduled evidence, and the owner must set RPO/RTO and recovery operator. Never restore over the live DB.                                                                                                                                                                                                                                                                                                                                                                    |
| N4 / P0       | Domain and email identity — Owner + Engineering                                      | Owner chooses/owns domain and public operator identity. Plan TLS/OAuth/Android-link migration and rollback before changing DNS. Verify Resend sender, SPF/DKIM/DMARC alignment, delivery and bounce/complaint handling. No purchase, sender/DNS mutation, or email dispatch is implied by UI work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| N5 / P0       | Account lifecycle and reauthentication — Engineering + Owner + Reviewer              | Implemented: verified-email state with single-use hashed tokens; enumeration-resistant, rate-limited one-hour password reset that revokes every existing session and emails a change alert; and a password-confirmation dialog that refreshes the existing ten-minute sensitive-action window without a full sign-out. Google-only accounts get a distinct "sign in with Google" reset email rather than a usable token. Automated integration coverage passes. Owner approved MFA/passkeys September 26: add where applicable and on devices that support it (WebAuthn/passkey for web, Android Credential Manager passkeys where supported, password fallback elsewhere) — see [core-feature-completion-plan.md](core-feature-completion-plan.md) Step 7. Not started; needs a recovery-story decision (can a passkey be the only credential on an account?) before implementation. Still open: non-silenceable push/in-app security alerts (belongs with the notification outbox). |
| N6 / P0       | Security/release pipeline — Engineering + Owner + Reviewer                           | Authorization, CSRF, OAuth, pairing, WebSocket/TURN, rate-limit, and secret-redaction review is covered by source and integration tests. CI now retains a CycloneDX SBOM generated from the frozen dependency graph. GitHub branch protection is unavailable for this private repository on its current plan, confirmed September 24. Still open: independent security review, protected Android release signing/AAB/versioning, staged rollout/rollback, and Play readiness. Never put signing material in git.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| N7 / P0       | Trust and support operations — Owner + Reviewer, Engineering publishes approved copy | Review [legal drafts](legal/), operator/contact/region/retention and Play disclosures. Confirm access/export/correction/deletion identity checks, deadlines, support SLA, incident owner and escalation process. Existing Trust/contact UI is not approval of the legal drafts. Publication awaits owner sign-off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| N8 / P1       | Web and accessibility completion — Engineering + Owner acceptance                    | Complete U1–U4 below and [responsive audit](responsive-audit.md). Cross-browser keyboard/focus, screen reader, contrast and reduced motion; real-device TalkBack, font scaling, rotation, split-screen, tablet/foldable. Browser emulation cannot close native acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| N9 / P1       | Capacity and operational limits — Engineering + Device tester + Owner                | Measure older-device decoder, CPU/memory, thermal, battery, direct/TURN bandwidth and long-session recovery. Record safe viewer limits and reconnect/load-failure behavior, monitoring/alert ownership. Measurements precede any native workspace playback design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Next — approved alpha features and bounded follow-through

This section contains approved behavior to finish or validate, not blanket permission
for every product idea. N1–N9 take precedence. Select the next implementation batch
explicitly where a design, privacy, infrastructure, or release decision is required.

| ID  | Scope / owner                                                        | Acceptance evidence and boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Quiet hours, sensitivity and retention — Engineering + Device tester | Already implemented (ADRs 0021, 0023, 0025). Validate time-zone/overnight behavior and stale-client server suppression; false-positive tuning on device. Quiet hours suppress motion metadata, not capture; notification schedules are a separate feature.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A2  | Existing account controls — Engineering + Owner                      | Browser-session inventory/revocation and confirmed account deletion exist (ADRs 0026, 0032). Verify logout/removal/error UI and retention disclosures; account access/export/correction remains an operational release gate, not an invented download button.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A3  | Existing health and setup — Engineering + Device tester              | State-specific web guidance is implemented for ready, offline, privacy, disabled, revoked and source-missing devices (ADR 0036), using existing state only. The 129-capture audit covers offline/privacy details. Physical Android permission, battery-optimization and reconnect guidance still needs N1/N2 device evidence. New telemetry and room metadata need a reviewed contract.                                                                                                                                                                                                                                                                                                     |
| A4  | Android Monitor capacity study — Engineering + Device tester         | Measure N9 first. Produce a bounded workspace design only after evidence. Current native playback stays single-camera. Simultaneous native playback requires a separate approved milestone even if measurements pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A5  | Push transport foundation — Engineering + Owner                      | Implemented and deployed through ADR 0044: authenticated FID/Web Push lifecycle, encryption, preferences/quiet hours, transactional outbox/dedup/retry, generic copy, revocation, and offline/recovery grace. Clean/repeated migrations and all 118 backend tests pass on PostgreSQL 18. Root-only Oracle secrets, migration 0014, backend, web UI, and service worker are live and verified. Chrome on Windows Web Push opt-in and real motion/offline/recovery delivery passed September 12 (3 delivered, 0 failed, 0 pending). Remaining: collect native Android FCM or installed-PWA, unsubscribe, quiet-hours, invalidation, and lock-screen evidence. Security alerts remain with N5. |

## UI/UX completion — current approved batch

| ID  | Deliverable / owner                                                          | Acceptance evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Compact auth card — Engineering                                              | Approx. 440px Paper/Evening card, existing Beacon icon system, Google mark/arrow primary, explicit divider, password fields and visibility control, honest account creation/OAuth failures, compact capture disclosure. No remote fonts or fake reset capability. Password/error forms may scroll on short screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| U2  | Desktop sidebar collapse — Engineering                                       | Accessible icon names and hover/focus labels, keyboard toggle, persisted browser preference, storage-failure fallback, usable sign-out/trust links; expanded/collapsed layouts; mobile labels/navigation unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| U3  | Systematic viewport/state audit — Engineering                                | 320px, 390px, tablet, 1280×800, ultrawide; auth/register/OAuth failures, Home, Cameras, Activity, Settings, device states, Add camera/pairing, Monitor/Live, Trust/contact. Include empty/error/loading/long content, dark theme and enlarged type. Fix causes of overflow; retain usable list/form/history/legal scroll. Record browser versions and screenshots, not only DOM assertions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| U4  | Finish design-package screen details — Engineering + Owner visual acceptance | Mobile Activity/Settings/device states and wide Monitor remain within current backend/media contracts. Preserve independent streams and explicit Listen/Talk. Validate web tests, lint, types/build and review incremental diff; deploy web only and verify public assets, TLS and `/ready`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| U5  | Sidebar and account-menu reliability — Engineering                           | Sticky header/footer, independently scrollable navigation, icon-collapse rail and keyboard toggle implemented without adding shadcn. The account menu renders outside the sidebar clipping boundary and keeps Trust & privacy and Sign out reachable when collapsed. Unit, responsive keyboard/portal, short-viewport, and production rendering checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| U6  | Notification settings and Android disconnect — Engineering + Device tester   | Web notification delivery state and per-camera preferences use explicit cards, switches, dirty-state feedback, and responsive layout; the web build is live and verified. Android disconnect is always visible, requires confirmation, stops capture and sends a JSON disconnect action; the backend revokes the credential and retains settings for device-bound repair. Unit/build validation passes; the production request-path failure is fixed and a physical disconnect/re-pair tap-through remains required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| U7  | Android/web feature-and-design parity pass — Engineering + Owner review      | In progress on `codex/android-clips-library`, most functional gaps now closed. Owner selected the PWA's mobile sidebar model. Inter/shared tokens, PWA-style auth/navigation (audited against the PWA, two real bugs fixed), Events Activity/Clips, Clips listing/playback/deletion, owner/admin motion settings (save/apply acceptance database-verified), backend-authorized 15-second manual recording (request path acceptance-verified end-to-end against local dev, which lacks the Drive OAuth credentials production already has), household/sharing management with per-camera grants (physically verified with a real second account), and Talk plus a WebRTC quality-metrics panel on the live viewer (the live-video connection failure previously flagged here was root-caused to a local dev environment gap and fixed) are implemented and physically verified where fixtures allow. Deployed registration acceptance, a real local Drive-backed capture and clip playback (or deferring that proof to production), native Trust/Contact pages, and accessibility parity remain separate secured slices. |

## Later / deferred — requires a separate approved milestone

The following table is retained for historical sequencing. Notifications,
household sharing, and user-owned recording are now active engineering work under
the owner-approved [core feature completion plan](core-feature-completion-plan.md).

| Candidate / proposed owner                                                                                                  | Required design and acceptance before implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notification security alerts / Engineering + Owner                                                                          | Security-event outbox implemented (ADR 0053): sign-in, email verification, device revocation, and household membership changes push/in-app alert with no preference able to silence them; password changes and account deletion alert by email instead, since both revoke the very session a push would need. Still open: native/physical acceptance, invalid-token cleanup, and operational delivery evidence.                                                                                                                                                                                                                                                                                           |
| Activity zones/calibration / Engineering + Device tester                                                                    | Apply on device to the existing luma detector, no frame upload; persistent source/orientation mapping and measured false positives/CPU/heat. Privacy masks require a distinct capture/rendering design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Household sharing / Engineering + Owner + Reviewer                                                                          | Active core work: finish inbox/bounce evidence, resend/expiry/revocation behavior, physical multi-account acceptance, recording grants, and independent security review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Rich device health, room labels / Engineering + Owner                                                                       | Minimal telemetry/retention contract, actionable warnings, manual room labels; no inferred location/maps or unnecessary collection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Account data export, expanded support center / Engineering + Owner                                                          | Define authorized scope, identity verification, data minimization and secure delivery; complete recovery/support process. Existing contact form does not prove a support SLA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Recordings/clips, cloud recording / Owner + Reviewer                                                                        | Active core work: implement explicit short-clip consent/lifecycle and encrypted direct export to user-owned Google Drive with least-privileged `drive.file`; no continuous or hidden recording.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Smart detection / Owner + Device tester + Reviewer                                                                          | Separate on-device experiment, feature flag, thermal/battery/false-positive measurements. Never facial recognition or biometric identity storage. ADR 0073 (2026-09-26) adds a decoupled `ActivityDetector` interface and a heuristic, explicitly-not-a-classifier placeholder, unwired from production capture. ADR 0074 (2026-09-26) selects MediaPipe Tasks Vision and EfficientDet-Lite0 as the candidate runtime/model but adds neither the dependency nor the model file, since real inference needs an emulator or physical device this environment does not have. A default-off feature flag and device thermal/battery/false-positive evidence remain open before this leaves foundation status. |
| Paid plans/subscriptions, ads / Owner + Reviewer                                                                            | No implementation now; separate approved milestone and renewed product/legal/privacy review. ADR 0031 currently prohibits advertising and customer-media AI training.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Cross-platform installed clients (Windows, Linux, macOS and iOS); IP cameras; cloud-synced workspaces / Owner + Engineering | Google Drive connection foundation is implemented as ADR 0049 with least-scope app-data access; camera media, recordings, and user-visible cloud files remain disabled pending separate consent, retention, deletion, and threat-model decisions. Other native clients and IP cameras still require their own design milestone. `docs/cross-platform-and-iot-research.md` (2026-09-26) researches ONVIF/RTSP bridging, iOS's background-capture platform constraint, and desktop options; it recommends a sequence but decides nothing and starts no milestone.                                                                                                                                           |

**Hard boundaries:** no continuous or hidden recording, facial recognition, biometric storage,
customer-media AI training, subscriptions, ads, cross-platform client expansion, or simultaneous
native multi-camera playback in current scope. Facial recognition remains excluded;
do not interpret the historical object-detection brief as permission to add it.

## Sharing foundation status — September 14, 2026

Migration 0015 and ADR 0048 add owner backfill, explicit roles, guest
expiry/revocation state, hashed invitations, per-source Listen/Talk grants, and
a database household-mismatch guard. The policy tests pass and the complete SQL
sequence applies on PostgreSQL 18. Session household selection and the REST,
WebSocket, TURN, and media-control authorization paths now consume the central
policy. The Windows runner completed the integration suite through a temporary
local bridge to the WSL-only database; that bridge was stopped afterward.

Migration 0016 now binds each browser session to a selected household and
requires an active, non-expired membership when the session is authenticated;
the resolved role is available to the route layer. Existing owner sessions are
backfilled safely. Account settings now lists and switches active household
memberships, with role-aware settings and realtime subscriptions.

The first route guard is now in place: camera management, pairing-code creation/
revocation, browser-device registration, credential revocation, and household
motion-management mutations require an active owner/admin session. Household-wide
reads and the unfiltered event socket are admin-only; viewer/guest camera and
device reads require active grants. Signaling checks grants continuously, enforces
Talk in the hub, and sends Listen permission to Android/browser producers so
denied audio is never added to the peer connection. Session switching/revocation
closes event and live-view sockets immediately, and account deletion cannot delete
a host household while the user is switched into it.

The authenticated sharing API now creates one-time, email-bound invitations,
stores only token hashes, accepts invitations into active memberships, lists
members/pending invitations, replaces viewer/guest camera grants, and revokes
invitations or members with audit and immediate socket teardown. Guest access
uses the invitation expiry (one to 168 hours) in this bounded alpha design. A
live PostgreSQL 18 run passes all 16 account/sharing integration tests. The web
settings UI now supports manual-code invitation creation and acceptance, pending
invitation revocation, member removal, and independent View/Listen/Talk grants.
Transactional invitation email delivery is deployed through the configured Resend
sender. Inbox, bounce/complaint handling, physical multi-account acceptance, and
independent security review remain evidence gates; the migrations, API, and UI are
now deployed to the private alpha.

An invitation can now be resent (`POST /api/household/invitations/:id/resend`):
it issues a fresh token/expiry, delivers it, and only revokes the original once
the replacement is confirmed created and delivered, so a failed delivery never
leaves the household without a working pending invitation. An automated test now
proves the authorization boundary directly — a viewer session gets 403 from all
six admin-only sharing endpoints (list sharing state, create/resend/revoke
invitation, replace grants, revoke member) — rather than relying only on manual
review of the `authenticateHouseholdAdmin(StateChange)` checks. Remaining gates
for this feature are still inbox/bounce evidence, physical multi-account
acceptance, and independent security review.

September 15 follow-up: accepting an invitation and being removed from a
household now both fire the ADR 0053 `household_membership_changed` security
event (notification-transport work landed September 14). Invitation
create/resend/revoke stay email-only, since a pending invitation targets an
`invitedEmail` with no confirmed Beacon session to alert. A real targeting bug
was found and fixed in the same pass: member removal recorded the event
against the _admin_ who removed them instead of the removed member, so the
one account whose access actually changed never received the alert. A live
PostgreSQL 18 integration assertion proves both paths target the affected
member and was confirmed to fail against the prior code before the fix landed;
the full 168-test backend suite passes.

## Decisions requiring the owner

1. Record physical acceptance with access to the Pixel, a second network and audio
   equipment; nominate reviewers for native accessibility/security.
2. Choose the owned domain, sender identity, support/incident operator, SLA and
   recovery RPO/RTO; approve associated costs/configuration when concrete.
3. MFA/passkeys approved in principle (September 26); still needs the recovery-story
   decision (can a passkey be the only credential on an account?) before
   implementation, and reviewed legal text approved before publication.
4. Choose one later candidate only after its prerequisites and design are reviewable.
   A backlog entry or deployment of this UI batch does not approve it.
5. Camera use-case profiles (doorbell/car/baby monitor/regular) — see
   [camera-use-case-profiles.md](camera-use-case-profiles.md) for the research and
   proposed phasing. Decide which profile (if any) to build first; Phase 3 of that
   doc (continuous/loop recording for driving) additionally needs its own privacy
   sign-off since it is in tension with this doc's no-continuous-recording boundary.
6. Android/web parity pass (U7) — audit is now complete
   ([android-web-parity-audit.md](android-web-parity-audit.md)); review its open
   questions (navigation paradigm, account-creation scope, sequencing) before any
   implementation begins, and sequence it against MFA/passkeys and camera profiles
   rather than assuming all three proceed in parallel (one approved milestone at a
   time).
