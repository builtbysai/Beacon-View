# Beacon delivery roadmap

Updated October 12, 2026. This is the single current scope authority. Release gates are in
[pre-deployment-readiness.md](pre-deployment-readiness.md); the testing rules are in
[testing-policy.md](testing-policy.md); every significant decision is an ADR in [decisions](decisions/). Older dated
plans, handoffs and audits were removed on October 12; git history keeps them.

## Where Beacon View is

A private alpha running on one Oracle Cloud VM at `https://beacon.builtbysai.com`, with the web app and installable
PWA, an Android camera and viewer app (sideloaded, `0.1.0-alpha12`), a Windows, Mac and Linux desktop app (unsigned,
with signed update feeds) and iOS as a web app. The repository is public under AGPL-3.0 (ADR 0119).

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

## Open: needs the owner or a device

| Item                                                        | What is needed                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Physical acceptance on a phone (N1, N2)                     | Privacy and recovery, front and rear switching, denied permissions, Google account flows, Listen and Talk, on a real phone and network. |
| Chromecast (ADR 0097, [guide](google-cast-registration.md)) | The receiver is registered (`E850DDA7`, unpublished). Register a test device by serial, prove playback and revocation, then publish.    |
| Windows code-signing certificate and Mac notarization       | Owner purchase and Apple account; until then installers show a first-launch warning.                                                    |
| Google Play (see [android-release.md](android-release.md))  | Account identity review and phone verification, an upload key, then store listing and data safety.                                      |
| Legal and trust copy (N7)                                   | Owner and reviewer approve the [drafts](legal/) and name the operator, contact, region and retention.                                   |
| Domain and sender identity (N4)                             | Owner decision; plan TLS, OAuth, Android app-links and rollback before any DNS change.                                                  |
| Accessibility pass (N8)                                     | Keyboard, screen reader, contrast and reduced-motion check on real browsers and devices.                                                |
| Capacity limits (N9)                                        | Measure older-device decode, CPU, heat, battery and bandwidth; record safe viewer limits.                                               |
| MFA and passkeys                                            | Approved in principle; needs the recovery decision (can a passkey be the only credential) first.                                        |
| GitHub review rule                                          | `main` needs a pull request and green `validate` and `secrets` checks; no second reviewer is required.                                  |

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
