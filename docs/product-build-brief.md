You are acting as the founding software architect and senior engineer for a new product tentatively named **Beacon View**.

> **Status note:** This document preserves the original product brief and its
> Milestone 0 assignment for historical context. The repository has progressed
> beyond that assignment; `docs/roadmap.md` is the authority for current scope.

## Product vision

We are building software that turns an unused device with a camera and internet connection into a remotely accessible smart security camera.

The initial positioning is:

“Turn every old phone into a smart security camera in under 60 seconds.”

A user should be able to:

1. Install the application on an old phone.
2. Sign in or pair the phone with their account.
3. Designate that device as a camera.
4. Install or open the application on another device.
5. See the camera online in a dashboard.
6. Start a secure live stream.
7. Receive motion or object-detection alerts.
8. Speak and listen through two-way audio.
9. Manage multiple cameras from one dashboard.
10. Record and review relevant events.
11. Enable privacy modes that stop monitoring when desired.

## Product principles

The product must be:

* Simple enough for a nontechnical consumer to set up.
* Secure and private by default.
* Designed for unreliable consumer networks.
* Efficient enough to run on older phones.
* Modular so additional device platforms can be supported later.
* Cost-conscious, especially regarding video bandwidth and cloud storage.
* Built incrementally rather than as an oversized monolith.
* Clear about whether the camera, microphone, or recording is active.

## Initial scope

Build an **Android-first proof of concept**.

Do not begin with iOS, desktop applications, cloud recording, subscriptions, facial recognition, or enterprise functionality.

The first proof of concept should demonstrate:

* One Android camera device.
* One viewer, initially implemented as a responsive web application.
* Secure user authentication.
* Device registration and pairing.
* Camera online/offline status.
* A live WebRTC video stream.
* Basic one-way audio from camera to viewer, followed by two-way audio if practical.
* Basic motion detection performed on the camera device.
* A simple event list.
* A manual privacy toggle.
* A foundation for multiple cameras, even if only one is initially tested.
* Automated tests for business-critical backend logic.
* Clear setup and developer documentation.

## Recommended architecture

Organize the system into these major components:

### 1. Android camera agent

Preferred implementation:

* Kotlin
* Jetpack Compose
* CameraX
* Native Android WebRTC library
* Foreground service for active camera operation
* Room only if local persistence becomes necessary
* WorkManager for appropriate retryable background work
* Hardware-accelerated H.264 or VP8 encoding where supported

Responsibilities:

* Authenticate the device.
* Register the device with the backend.
* Capture camera video and microphone audio.
* Establish a WebRTC peer connection.
* Send and receive signaling messages.
* Report online status and device health.
* Perform basic local motion detection.
* Support remote start and stop commands.
* Show a persistent foreground notification while acting as a camera.
* Provide an unmistakable local indicator when camera or microphone capture is active.
* Stop capture immediately when privacy mode is enabled.
* Recover cleanly after temporary network interruption.
* Avoid retaining credentials in plaintext.

### 2. Web viewer

Preferred implementation:

* TypeScript
* React
* Vite or Next.js
* Browser WebRTC APIs
* A clean, responsive dashboard

Responsibilities:

* Authentication.
* Camera list.
* Online and offline indicators.
* Camera detail view.
* Start and stop live viewing.
* Display connection state.
* Toggle privacy mode when authorized.
* Show recent motion events.
* Prepare the interface for multiple simultaneous cameras without initially requiring a complex video wall.

### 3. Backend API and signaling service

Preferred implementation for the first version:

* TypeScript
* Node.js
* Fastify or NestJS
* WebSocket signaling
* PostgreSQL
* Prisma or Drizzle ORM
* Redis only when there is a demonstrated need for shared ephemeral state or horizontal scaling

Using TypeScript for both the viewer and initial backend is intentional. It should reduce early complexity and make the MVP easier for a small team to maintain. Do not introduce Go, Rust, Kubernetes, Kafka, or microservices until measurements justify them.

Responsibilities:

* User accounts and sessions.
* Device registration.
* Device pairing.
* Device authorization.
* Camera ownership and sharing model.
* Signaling message exchange.
* Online presence.
* Motion-event metadata.
* Privacy state.
* Audit-sensitive actions.
* Rate limiting.
* Structured logs.
* Health checks.

### 4. WebRTC infrastructure

Use:

* WebRTC for low-latency media.
* STUN for network discovery.
* TURN as a fallback when a direct connection cannot be established.
* Coturn for local development and an initial self-managed deployment, unless a managed TURN provider is chosen.

The signaling channel must never be treated as proof of authorization. Every camera access request must be checked against backend permissions.

Design for peer-to-peer streaming where possible, but do not assume all users can connect peer to peer. Detect and report whether a connection is direct or relayed.

### 5. Object detection

Do not add full object detection to the first streaming milestone.

After stable streaming and motion detection are working, create a separate experimental module for on-device person detection using an appropriate mobile runtime such as TensorFlow Lite, MediaPipe, or ONNX Runtime Mobile.

Object detection must:

* Run at a reduced sampling rate.
* Avoid processing every full-resolution frame.
* Be disabled on unsupported or overheated devices.
* Report confidence and category metadata.
* Never silently upload raw frames to an AI service.
* Remain behind a feature flag until evaluated.

## Proposed repository structure

Create or adapt a monorepo resembling:

/apps
/android-camera
/web-viewer
/backend

/packages
/shared-types
/api-client
/config

/infrastructure
/docker
/coturn
/database

/docs
architecture.md
threat-model.md
local-development.md
product-requirements.md
testing-plan.md
deployment.md
decisions/

Use shared schemas where practical, but do not force Android Kotlin models to depend directly on TypeScript packages.

## Core data model

Start with entities similar to:

User

* id
* email
* passwordHash or externalAuthId
* createdAt
* updatedAt

Household

* id
* name
* ownerId

HouseholdMember

* householdId
* userId
* role

CameraDevice

* id
* householdId
* name
* platform
* publicDeviceId
* credentialHash
* status
* privacyMode
* lastSeenAt
* createdAt
* updatedAt

PairingCode

* id
* codeHash
* expiresAt
* claimedAt
* cameraDeviceId

CameraPermission

* cameraDeviceId
* userId
* role

MotionEvent

* id
* cameraDeviceId
* eventType
* confidence
* occurredAt
* thumbnailReference, initially nullable
* metadata

ConnectionAudit

* id
* cameraDeviceId
* userId
* action
* result
* occurredAt
* metadata

Do not store raw access tokens or pairing codes.

## Security requirements

Treat security as a release-blocking requirement.

Implement or document:

* TLS for all production traffic.
* Secure password hashing when passwords are used.
* Short-lived access tokens and securely handled refresh tokens.
* Per-device credentials.
* Rotatable and revocable device credentials.
* Expiring one-time pairing codes.
* Authorization checks on every camera operation.
* Rate limits for login, pairing, signaling, and camera access.
* Protection against insecure direct object references.
* Input validation using schemas.
* No secrets committed to source control.
* Environment-variable validation at application startup.
* Secure Android credential storage.
* Minimal personally identifiable information.
* Audit events for camera access and permission changes.
* A basic threat model.
* Dependency scanning and static analysis.
* Logging that excludes passwords, tokens, pairing codes, private media, and sensitive session information.

Do not claim end-to-end encryption unless the implementation and threat model justify that claim. Clearly document what WebRTC encrypts, what the signaling server can see, what TURN relays can observe, and how recordings would be protected in a future version.

## Privacy requirements

Implement:

* A visible capture indicator on the camera device.
* An explicit privacy-mode control.
* Immediate shutdown of camera and microphone capture when privacy mode is enabled.
* Clear permission requests.
* No hidden recording.
* No facial recognition.
* No biometric identity database.
* No automatic cloud uploads in the MVP.
* A clear event-retention setting for metadata.
* Deletion of a camera and its associated data.
* Session history showing recent viewer access where practical.

## Reliability requirements

Account for:

* Wi-Fi changes.
* Cellular-to-Wi-Fi transitions.
* Temporary internet loss.
* Camera app restarts.
* Backend restarts.
* Expired authentication.
* Viewer refreshes.
* Device sleep and battery optimization.
* Multiple viewers requesting the same camera.
* Multiple cameras associated with one account.
* Duplicate signaling messages.
* Stale WebSocket sessions.
* TURN fallback.
* Low-bandwidth connections.
* Device overheating.
* Low battery.
* Camera or microphone permission revocation.

Use explicit connection-state machines instead of scattered Boolean flags.

## Multiple-device rules

For the MVP:

* One account may own multiple cameras.
* A camera may have only one active viewer session initially unless the architecture can safely support more.
* When a second viewer requests access, return a clear “camera already in use” result.
* Do not duplicate the upstream stream for multiple viewers during the first milestone.
* Design interfaces so a future selective forwarding unit or media server can be added if multi-viewer streaming becomes commercially necessary.
* Assign every device a stable server-issued identifier.
* Do not rely on a device name as an identifier.
* Handle duplicated names in the interface.
* Define ownership, administrator, viewer, and guest permissions.

## Development rules

Before implementing large changes:

1. Inspect the repository.
2. Summarize the current state.
3. State assumptions.
4. Propose the smallest testable change.
5. Implement it.
6. Run formatting, linting, type checking, and tests.
7. Review the diff.
8. Document remaining risks.

Never hide a failed test or unresolved security issue.

Do not add dependencies unless needed. Explain important dependency choices in an architecture decision record.

Prefer boring, mature technology over novelty.

Avoid premature abstractions. However, isolate platform-specific camera, signaling, and authentication behavior behind clear interfaces.

## Testing strategy

Include:

* Backend unit tests.
* API integration tests.
* Authorization tests.
* Pairing expiration tests.
* Device credential revocation tests.
* Signaling state-machine tests.
* Web component tests for critical states.
* Android unit tests for non-UI state logic.
* Android instrumentation tests where they provide meaningful confidence.
* Manual WebRTC test instructions across different networks.
* A test matrix covering direct and TURN-relayed connections.
* Tests for privacy-mode shutdown.
* Tests for reconnect behavior.

## Observability

Add:

* Structured logs.
* Request IDs.
* Connection IDs.
* Camera IDs represented safely in logs.
* Health endpoints.
* Basic metrics for active cameras, active viewers, failed pairings, signaling failures, WebRTC connection outcomes, and TURN usage.

Do not log media payloads.

## Local development

Provide a Docker Compose environment for the services that benefit from containers, including:

* PostgreSQL
* Coturn
* Backend, if appropriate

The Android emulator or physical Android device and the web viewer may run outside Docker.

Provide:

* `.env.example`
* Database migrations
* Seed data where useful
* One-command or clearly sequenced startup instructions
* Troubleshooting instructions for local network and TURN configuration
* Instructions for using a physical Android device on the same LAN

## Initial milestones

Work in this order:

### Milestone 0: Repository foundation

* Create the monorepo.
* Add formatting, linting, tests, environment validation, CI, documentation skeleton, and Docker Compose.
* Add an architecture document and threat-model draft.
* Do not implement streaming yet.

### Milestone 1: Accounts and camera registration

* User authentication.
* Camera-device registration.
* Expiring pairing codes.
* Camera list in the web viewer.
* Online and offline status.
* Authorization tests.

### Milestone 2: WebRTC video

* Android camera capture.
* WebSocket signaling.
* Browser viewer.
* STUN configuration.
* TURN fallback.
* Connection status and errors.
* One active viewer per camera.
* No recording.

### Milestone 3: Audio and privacy

* Camera-to-viewer audio.
* Two-way audio.
* Privacy-mode state.
* Immediate media shutdown.
* Capture indicators.
* Access audit events.

### Milestone 4: Motion events

* Lightweight on-device motion detection.
* Motion-event metadata.
* Event list in the viewer.
* Debouncing and cooldown.
* No object recognition yet.

### Milestone 5: Hardening

* Reconnection handling.
* Network changes.
* Low-bandwidth behavior.
* Device health.
* Security review.
* Dependency review.
* End-to-end test plan.
* Initial deployment documentation.

### Milestone 6: Object-detection experiment

* Feature-flagged person detection.
* Performance and heat measurement.
* Confidence thresholds.
* False-positive evaluation.
* No facial recognition.

## Current assignment

Start with **Milestone 0 only**.

First inspect the existing repository. If the repository is empty, propose the exact directory structure and dependency choices.

Then produce:

1. A brief architecture summary.
2. A list of assumptions.
3. The proposed repository tree.
4. The dependency list with reasons.
5. A threat-model outline.
6. The implementation plan for Milestone 0.
7. The Milestone 0 implementation.
8. Commands for running and validating the project.
9. Test and lint results.
10. A list of decisions that require human approval.

Do not begin Milestone 1 until Milestone 0 has been reviewed and accepted.

When there is ambiguity, choose a sensible MVP default, document the decision, and continue unless the decision would create a material security, privacy, legal, or irreversible infrastructure commitment.
