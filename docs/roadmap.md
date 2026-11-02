# Beacon delivery roadmap

Reviewed November 2, 2026 against the current checkout and GitHub issues, PRs, branches and Actions. This is the single current scope authority. Release gates are in
[pre-deployment-readiness.md](pre-deployment-readiness.md); the testing rules are in
[testing-policy.md](testing-policy.md); every significant decision is an ADR in [decisions](decisions/). Older dated
plans, handoffs and audits were removed on October 12; git history keeps them.

## Where Beacon View is

An owner-only development alpha is reachable at `https://beacon.builtbysai.com`; the owner confirmed there are no external production users. It includes the web/PWA viewer, the Android native camera with a WebView viewer, desktop shells and iOS through the web. This is not a public-beta readiness claim. The repository is public under AGPL-3.0 (ADR 0119).

Development continues on `codex/portable-workspace`; its November 1 maintenance source checkpoint was `d44a8ae`, six commits ahead of `main` (`2e17cc7`) before the documentation review and Activity follow-up. Those commits are pushed, but there is no open PR. They include portable development, dependency patches and replacement signing trust. Running service images were deliberately preserved during credential maintenance; pushed source, hosted services and installed/downloaded native apps are different checkpoints.

The last recorded Android release is `0.1.0-alpha19`. The October 12 release log proves live view, PiP, fullscreen, snapshots, remote Pause/Resume and an FCM heads-up alert on a Pixel viewer with an emulator camera. It explicitly excludes Listen/Talk, forced-relay media and a physical rear camera. September 26 comments on issue #21 contain additional partial two-device evidence, not closure of the complete checklist. These historical passes must be repeated where fresh signing identities/installations affect them.

November 1–2 maintenance completed the inventoried credential rotations, external private-file organization, backup/restore verification and obsolete-artifact cleanup. New desktop update and Android signing identities intentionally require fresh development installs; the owner accepted re-enrollment. No new View backend code or native application release was deployed during that maintenance. The private credential register is complete; key rotation is no longer a prerequisite task to repeat.

Shipped, in outline (the ADR number has the detail):

- Pairing, multi-viewer WebRTC, several cameras per device, privacy mode, listen and talk, browser Camera Mode,
  motion alerts with quiet hours and snooze, camera groups, wall and sleep timer, Home and Away.
- Households, invitations, account recovery, verified email, session and device revocation, account deletion.
- Opt-in encrypted clips in the owner's Google Drive, now in the chunked BCLIP1 format (ADR 0115), with expiry
  reminders (ADR 0116) and retention settings.
- Push notifications (FCM and Web Push), use-case profiles, Cast receiver code (ADR 0097).
- One Add a device flow on web and Android (ADR 0117); apps and downloads in the product, one update manager per kind
  of install, and standby camera fixes (ADR 0118).
- Own TURN relay under Beacon View control (ADR 0114), encrypted off-site backups with a restore drill, monitor and
  [runbook](runbook-outage-and-recovery.md).

## Next work, in order

1. **Integrate the maintenance branch before another release.** Prepare a PR from `codex/portable-workspace` to `main`, run the required `validate` and `secrets` checks and the relevant Android/PostgreSQL jobs, then follow the release procedure for an explicitly chosen image. The October 26 scheduled dependency audit on `main` failed with high-severity advisories; the November 1 branch patches passed local validation, but have not cleared `main`'s audit. Re-run the audit against the proposed release and assess the recorded moderate development-tool advisory. Do not disable checks or accidentally retain an old runtime image pin during an intentional code release.
2. **Rebuild with the new signing trust and complete viewer acceptance ([#21](https://github.com/builtbysai/Beacon-View/issues/21)).** Freshly install/re-pair the Android camera/viewer and rebuild desktop feeds/installers using the new update key. Work through the remaining real-media matrix: direct and forced TURN, browser Camera Mode, Listen/Talk including teardown, actual rear-camera switching, revocation/reconnect, Google Drive clip states and mobile/desktop layouts. September evidence of a lingering speaker AudioTrack needs explicit teardown re-check; it is not proof of lingering microphone capture. Record device/build/network and observed results; do not mark #21 closed from a build or health check.
3. **Finish the Activity detail milestone ([#20](https://github.com/builtbysai/Beacon-View/issues/20)).** The owner selected one feed with filters, and the initial category/pagination slice is implemented below. The main timeline already merges motion and a broad household-event allowlist; the separate legacy access-history view has a narrower type union. Next identify missing structured recording/sharing details and wire them deliberately, preserving household/account permissions, pagination and retention. Reuse existing audit data and sanitized fields; do not invent a second audit system or broaden access to account-level security records. Combined-flow acceptance remains open.
4. **Close the release gates below before broadening availability.** Keep device, accessibility, capacity, legal/store and security-review evidence separate from maintenance checks. Do not start deferred features as part of this roadmap review.

## November 2 implementation follow-up

The owner selected one Activity feed with filters. The first implementation slice now adds Motion, Recordings, Devices, Security and Household categories to the existing merged timeline. Category queries apply to saved history before pagination; Recordings can find retained lifecycle events excluded from the camera-focused All default. No new backend event store, payload access or retention policy was introduced. Owner/admin restrictions remain in force and a role downgrade resets private category selection to authorized Motion history. Controls wrap on phones.

[ADR 0124](decisions/0124-unified-activity-category-filters.md) records the contract and evidence. Lint, web typechecking/build, the full web regression suite and isolated Edge phone/desktop checks passed, including automated WCAG checks after UI transitions settled. Issue #20 remains open for richer per-event details and combined-flow acceptance; #21 physical-device acceptance remains open. The implementation is source work on the feature branch and has not been deployed.

## Work ownership

| Can be completed independently                                                                                                                                                                                                         | Needs owner/device evidence                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maintenance PR/CI and dependency fixes; fresh signed build artifacts; implementation and automated authorization/pagination/retention validation of the approved unified Activity feed; automated accessibility/browser-fixture checks | Real camera/media/Listen/Talk/forced-relay acceptance; physical accessibility/capacity checks; Chromecast registration; store/legal/domain decisions and distribution-account actions |

The Activity layout decision is resolved. Begin with the actual existing event model and expose only authorized, sanitized event details; a unified UI must not widen access or turn raw audit records into client payloads. Human/device release gates remain open while independent implementation continues.

## GitHub checkpoint — November 2, 2026

- Open owner-created issues: [#21 physical-device Live Viewer QA](https://github.com/builtbysai/Beacon-View/issues/21) and [#20 Activity metadata](https://github.com/builtbysai/Beacon-View/issues/20); both include September 26 follow-up comments that narrow the remaining work.
- [#19 contextual Camera Settings](https://github.com/builtbysai/Beacon-View/issues/19) and [#22 Browser Camera Mode active settings](https://github.com/builtbysai/Beacon-View/issues/22) are closed. Do not reintroduce them as unimplemented tasks.
- Latest merged PR: [#143 design screenshots](https://github.com/builtbysai/Beacon-View/pull/143), October 13. [#142](https://github.com/builtbysai/Beacon-View/pull/142) records the partial alpha19 device pass. No open PRs, GitHub Releases or milestones were listed at review.
- GitHub Dependabot-alert API access was unavailable for this repository; no zero-alert claim is made.
- Latest Actions run: [October 26 dependency audit, failed](https://github.com/builtbysai/Beacon-View/actions/runs/40327508879), on `main` at `2e17cc7`. The latest main CI run on October 13 passed. Feature-branch pushes alone do not trigger the PR/main CI workflow.

## Open: needs the owner or a device

| Item                                                        | What is needed                                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical acceptance on a phone (N1, N2)                     | Complete issue #21 after fresh signing/install; retain the partial September/October evidence and record the remaining real-device/network checks.       |
| Chromecast (ADR 0097, [guide](google-cast-registration.md)) | The receiver is registered (`E850DDA7`, unpublished). Register a test device by serial, prove playback and revocation, then publish.                     |
| Windows code-signing certificate and Mac notarization       | View desktop Authenticode/notarization remain separate owner/account decisions; Remote's self-signed certificate does not solve View distribution trust. |
| Google Play (see [android-release.md](android-release.md))  | Account identity review and phone verification, an upload key, then store listing and data safety.                                                       |
| Legal and trust copy (N7)                                   | Owner and reviewer approve the [drafts](legal/) and name the operator, contact, region and retention.                                                    |
| Domain and sender identity (N4)                             | Owner decision; plan TLS, OAuth, Android app-links and rollback before any DNS change.                                                                   |
| Accessibility pass (N8)                                     | Automated axe check is clean on 120 states; still needed: keyboard, screen reader and reduced-motion check on real browsers/devices.                     |
| Capacity limits (N9)                                        | Measure older-device decode, CPU, heat, battery and bandwidth; record safe viewer limits.                                                                |
| MFA and passkeys                                            | Approved in principle; needs the recovery decision (can a passkey be the only credential) first.                                                         |
| GitHub review rule                                          | `main` requires a pull request and green `validate` and `secrets` checks; verified at review, with no second reviewer required.                          |

## Deferred: each needs its own approved milestone

Activity zones, richer device health and room labels, account data export and a support center, smart detection
(on-device, behind a flag, measured first), simultaneous native multi-camera playback on Android, an SFU for large
fan-out, IP cameras, an iOS app, continuous or loop recording for driving (needs its own privacy sign-off), and paid
plans. [camera-use-case-profiles.md](camera-use-case-profiles.md) and
[cross-platform-and-iot-research.md](cross-platform-and-iot-research.md) hold the research.

## Hard boundaries

No hidden or continuous recording, no facial recognition or biometric storage, no use of customer media for AI
training, no ads or subscriptions, no cloud recording outside the owner's Google Drive, and no iOS, Kubernetes, Kafka
or microservices unless a later milestone explicitly requires them (see [AGENTS.md](../AGENTS.md)).
