# Beacon delivery roadmap

Updated September 7, 2026. This is the single actionable roadmap. It supersedes the
delivery sequences in `ui-ux-roadmap.md` and `feature-opportunities.md`. Historical
milestone notes are preserved in [roadmap-history.md](roadmap-history.md); they do
not grant new scope. Detailed release gates remain in
[pre-deployment-readiness.md](pre-deployment-readiness.md).

## Current scope and evidence

The existing Oracle private alpha is served at https://beaconapp.duckdns.org. Its
internet availability is not broad-release acceptance. Continue in the existing
`codex/web-experience-rebuild` checkout, preserving its uncommitted work. No new
worktree, commit, push, PR, or scheduled task is authorized in this batch.

Approved now: roadmap reconciliation, the supplied compact auth-card direction,
desktop sidebar collapse, responsive/state audit and fixes, established web
validation, and tested web-only deployment to the existing VM. No backend/schema,
Android release, new infrastructure, email sender change, or legal publication is
part of this UI batch. Finish one bounded batch before selecting another.

Source-verified foundations: Google browser OAuth and Android browser handoff;
password sign-in/registration; browser-session revocation and account deletion;
single-camera native Monitor; web local workspaces; visible capture/privacy;
motion metadata, sensitivity/cooldown and daily time-zone quiet hours; 1/7/30/90-day
metadata retention; device battery/charging; support contact form. These features
still need the physical and operational evidence below. Password reset, verified
password email, MFA/passkeys, sharing, zones, and push notifications are absent.

Owners below are responsibilities, not new assignments to third parties:
**Engineering** = current development task; **Owner** = product/service owner;
**Device tester** = owner operating the Pixel and audio/network equipment;
**Reviewer** = independent security/legal/accessibility reviewer to be nominated.
An item closes only when its linked evidence records date, environment, result,
and remaining limitations; a passing build alone is insufficient.

## Now — release blockers

| ID / priority | Action and owner                                                                     | Acceptance evidence / decision                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1 / P0       | Physical privacy and recovery — Engineering + Device tester                          | Pixel `34171JEHN07672`: local Privacy while offline releases video/audio immediately; restart stays paused; reconnect reconciles safely. Switch front/rear repeatedly; lose/restore Wi-Fi; no stuck camera or rapid retry loop. Record build/device/network and observed capture indicators in [testing-plan.md](testing-plan.md). Still open.                                                                                       |
| N2 / P0       | Google and media acceptance — Device tester + Engineering                            | Android Monitor Google account chooser, cancel/failure/return; Listen starts muted; Talk only after consent; stop/navigation/disconnect/privacy release microphone. Audible speaker/Bluetooth and echo checks, competing talk owners, direct and forced TURN across separate networks. Physical results still open.                                                                                                                  |
| N3 / P0       | Prove backup recovery — Engineering + Owner                                          | Use [Oracle restore procedure](oracle-cloud-staging.md) to restore an encrypted Object Storage snapshot into a separate empty DB; never restore over live DB. Verify migrations and aggregate counts without exposing account data; record elapsed restore time, timer results, encrypted repository integrity, 7 daily/4 weekly/3 monthly retention and expiry. Owner sets RPO/RTO and recovery operator. Restore proof still open. |
| N4 / P0       | Domain and email identity — Owner + Engineering                                      | Owner chooses/owns domain and public operator identity. Plan TLS/OAuth/Android-link migration and rollback before changing DNS. Verify Resend sender, SPF/DKIM/DMARC alignment, delivery and bounce/complaint handling. No purchase, sender/DNS mutation, or email dispatch is implied by UI work.                                                                                                                                   |
| N5 / P0       | Account lifecycle and reauthentication — Engineering + Owner + Reviewer              | Design verified password email, expiring one-time reset with enumeration/rate protections, sensitive-action reauth and security alerts. Preserve Google/password collision handling and session revocation. Owner chooses MFA/passkey policy and recovery rules. Separate approved security batch after sender readiness.                                                                                                            |
| N6 / P0       | Security/release pipeline — Engineering + Owner + Reviewer                           | Review authorization, CSRF, OAuth, pairing, WebSocket/TURN abuse, rate limits and secret redaction; close findings. Generate SBOM; verify hosted CI/branch protection when push authorized; define release signing, AAB/versioning, staged rollout/rollback and Play readiness. Never put signing secrets in git.                                                                                                                    |
| N7 / P0       | Trust and support operations — Owner + Reviewer, Engineering publishes approved copy | Review [legal drafts](legal/), operator/contact/region/retention and Play disclosures. Confirm access/export/correction/deletion identity checks, deadlines, support SLA, incident owner and escalation process. Existing Trust/contact UI is not approval of the legal drafts. Publication awaits owner sign-off.                                                                                                                   |
| N8 / P1       | Web and accessibility completion — Engineering + Owner acceptance                    | Complete U1–U4 below and [responsive audit](responsive-audit.md). Cross-browser keyboard/focus, screen reader, contrast and reduced motion; real-device TalkBack, font scaling, rotation, split-screen, tablet/foldable. Browser emulation cannot close native acceptance.                                                                                                                                                           |
| N9 / P1       | Capacity and operational limits — Engineering + Device tester + Owner                | Measure older-device decoder, CPU/memory, thermal, battery, direct/TURN bandwidth and long-session recovery. Record safe viewer limits and reconnect/load-failure behavior, monitoring/alert ownership. Measurements precede any native workspace playback design.                                                                                                                                                                   |

## Next — approved alpha features and bounded follow-through

This section contains approved behavior to finish or validate, not blanket permission
for every product idea. N1–N9 take precedence. Select the next implementation batch
explicitly where a design, privacy, infrastructure, or release decision is required.

| ID  | Scope / owner                                                        | Acceptance evidence and boundary                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Quiet hours, sensitivity and retention — Engineering + Device tester | Already implemented (ADRs 0021, 0023, 0025). Validate time-zone/overnight behavior and stale-client server suppression; false-positive tuning on device. Quiet hours suppress motion metadata, not capture; notification schedules are a separate feature.                                                                                                                              |
| A2  | Existing account controls — Engineering + Owner                      | Browser-session inventory/revocation and confirmed account deletion exist (ADRs 0026, 0032). Verify logout/removal/error UI and retention disclosures; account access/export/correction remains an operational release gate, not an invented download button.                                                                                                                           |
| A3  | Existing health and setup — Engineering + Device tester              | State-specific web guidance is implemented for ready, offline, privacy, disabled, revoked and source-missing devices (ADR 0036), using existing state only. The 129-capture audit covers offline/privacy details. Physical Android permission, battery-optimization and reconnect guidance still needs N1/N2 device evidence. New telemetry and room metadata need a reviewed contract. |
| A4  | Android Monitor capacity study — Engineering + Device tester         | Measure N9 first. Produce a bounded workspace design only after evidence. Current native playback stays single-camera. Simultaneous native playback requires a separate approved milestone even if measurements pass.                                                                                                                                                                   |

## UI/UX completion — current approved batch

| ID  | Deliverable / owner                                                          | Acceptance evidence                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Compact auth card — Engineering                                              | Approx. 440px Paper/Evening card, existing Beacon icon system, Google mark/arrow primary, explicit divider, password fields and visibility control, honest account creation/OAuth failures, compact capture disclosure. No remote fonts or fake reset capability. Password/error forms may scroll on short screens.                                                                         |
| U2  | Desktop sidebar collapse — Engineering                                       | Accessible icon names and hover/focus labels, keyboard toggle, persisted browser preference, storage-failure fallback, usable sign-out/trust links; expanded/collapsed layouts; mobile labels/navigation unchanged.                                                                                                                                                                         |
| U3  | Systematic viewport/state audit — Engineering                                | 320px, 390px, tablet, 1280×800, ultrawide; auth/register/OAuth failures, Home, Cameras, Activity, Settings, device states, Add camera/pairing, Monitor/Live, Trust/contact. Include empty/error/loading/long content, dark theme and enlarged type. Fix causes of overflow; retain usable list/form/history/legal scroll. Record browser versions and screenshots, not only DOM assertions. |
| U4  | Finish design-package screen details — Engineering + Owner visual acceptance | Mobile Activity/Settings/device states and wide Monitor remain within current backend/media contracts. Preserve independent streams and explicit Listen/Talk. Validate web tests, lint, types/build and review incremental diff; deploy web only and verify public assets, TLS and `/ready`.                                                                                                |

## Later / deferred — requires a separate approved milestone

| Candidate / proposed owner                                               | Required design and acceptance before implementation                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push notifications + preferences + security alerts / Engineering + Owner | Opt-in permission, transport/device subscription lifetime, delivery/retry/dedup, rate limits, private lock-screen copy, immediate unsubscribe/mute, abuse and support handling. Security-alert design belongs with N5. |
| Notification quiet hours/schedules / Engineering + Owner                 | Define per-user vs per-camera semantics and time zones; preserve existing metadata quiet hours and capture/privacy semantics.                                                                                          |
| Activity zones/calibration / Engineering + Device tester                 | Apply on device to the existing luma detector, no frame upload; persistent source/orientation mapping and measured false positives/CPU/heat. Privacy masks require a distinct capture/rendering design.                |
| Household sharing / Engineering + Owner + Reviewer                       | Recovery/security notifications first; explicit invitations, role/camera permissions, guest expiry/revocation and authorization/audit tests.                                                                           |
| Rich device health, room labels / Engineering + Owner                    | Minimal telemetry/retention contract, actionable warnings, manual room labels; no inferred location/maps or unnecessary collection.                                                                                    |
| Account data export, expanded support center / Engineering + Owner       | Define authorized scope, identity verification, data minimization and secure delivery; complete recovery/support process. Existing contact form does not prove a support SLA.                                          |
| Recordings/clips, cloud recording / Owner + Reviewer                     | Separate consent, storage/key-management, deletion/export/backup semantics, costs and threat model. No current media upload or recording implementation is authorized.                                                 |
| Smart detection / Owner + Device tester + Reviewer                       | Separate on-device experiment, feature flag, thermal/battery/false-positive measurements. Never facial recognition or biometric identity storage.                                                                      |
| Paid plans/subscriptions, ads / Owner + Reviewer                         | No implementation now; separate approved milestone and renewed product/legal/privacy review. ADR 0031 currently prohibits advertising and customer-media AI training.                                                  |
| iOS, desktop, IP cameras; cloud-synced workspaces / Owner + Engineering  | Separate platform/security/data-flow/cost design and milestone approval. No native multi-camera playback without separate explicit approval.                                                                           |

**Hard boundaries:** no cloud recording, facial recognition, biometric storage,
customer-media AI training, subscriptions, ads, iOS/desktop expansion, or simultaneous
native multi-camera playback in current scope. Facial recognition remains excluded;
do not interpret the historical object-detection brief as permission to add it.

## Decisions requiring the owner

1. Record physical acceptance with access to the Pixel, a second network and audio
   equipment; nominate reviewers for native accessibility/security.
2. Choose the owned domain, sender identity, support/incident operator, SLA and
   recovery RPO/RTO; approve associated costs/configuration when concrete.
3. Approve account verification/reset/reauth and MFA/passkey recovery design before
   the security feature batch; approve reviewed legal text before publication.
4. Choose one later candidate only after its prerequisites and design are reviewable.
   A backlog entry or deployment of this UI batch does not approve it.
