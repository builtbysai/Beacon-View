# ADR 0041: Extract feature boundaries before expanding the product

Status: Accepted for the maintainability milestone. The native monitor modules named below were removed by ADR 0121.

## Context

The Android activity had grown to 2,391 lines and combined lifecycle orchestration,
permissions, pairing, camera-mode presentation, monitor presentation, native playback,
account UI, and navigation. The web application shell and backend application assembly
had similarly begun accumulating domain models, feature UI, validation schemas, session
security, and route registration in single files. Adding recovery, notifications, and
household authorization directly to those files would make security review and regression
testing progressively harder.

## Decision

Refactor by cohesive feature boundary without changing runtime behavior, APIs, storage,
or security policy:

- `MainActivity` owns Android lifecycle, permission launchers, inbound links, top-level
  mode selection, and dependency composition.
- `CameraModeUi` owns pairing, welcome, and camera-device presentation.
- `MonitorUi` coordinates native monitor state and actions. Reusable monitor rendering,
  navigation, deterministic presentation rules, and native playback live in separate
  modules.
- Web domain contracts live outside the application shell, and independently useful
  screens such as access history, diagnostics, pending-device guidance, pairing links,
  mobile authentication return, trust/privacy, account settings, device choice, and the
  pairing dialog are feature components. Live-view status copy is a pure presentation
  policy tested independently from WebRTC transport. WebRTC statistics parsing and
  direct-versus-TURN path classification are also pure, focused, and independently
  tested.
- Backend HTTP validation, session/CSRF policy, and persistence contracts are independent
  modules. Authentication, account lifecycle, enrollment, and service health/contact are
  registered as cohesive route groups with explicit dependencies.
- Camera API presentation has one policy for presence age, active producer connections,
  privacy, enabled state, and viewer counts across list and detail endpoints.
- PostgreSQL motion settings, event insertion, cooldown, quiet-hours, history, and
  retention queries live behind an internal repository while `MilestoneStore` remains
  the stable application-facing facade.
- PostgreSQL audit insertion, access-history projection, and fixed security retention
  live behind a separate internal repository. Transaction callers pass their existing
  database client so account and pairing audit rows keep the original atomicity.
- Pairing-code creation, revocation, one-time redemption, registration throttling, and
  their transactional audit events live behind a pairing repository. Browser-session
  creation, rolling-expiry lookup, listing, and revocation live behind a separate session
  repository so future account-security work does not expand the store facade.
- Password and Google account creation, identity lookup, avatar updates, and deletion
  live behind an account repository. Account and household creation continue to share
  one transaction with their audit record.
- Device inventory, camera-source synchronization, browser-device registration,
  heartbeat health, privacy/revocation lifecycle, and signaling identity lookup live
  behind a device repository. Authorization-sensitive SQL remains centralized while
  the application store stays a stable facade.
- Web household-event transport owns WebSocket connection, bounded reconnect backoff,
  session-loss handling, malformed-message isolation, and cleanup; the application shell
  handles only feature-specific state transitions.
- Backend application assembly contains no route handlers. Authentication, account
  lifecycle, enrollment, camera management, activity/motion, device runtime, and service
  routes register themselves through explicit dependency contracts.
- New security-sensitive features must have a service/policy boundary, persistence
  contract, route registration module, and focused tests before UI integration.

Mechanical extraction is followed by the same unit, integration, lint, type, and build
checks used before extraction. No dependency is added merely to perform a refactor.

## Consequences

The Android activity is small enough to review as orchestration rather than as the whole
application. Shared authentication policy has one backend implementation, and schemas no
longer obscure application assembly. Some feature modules remain large and will be split
further by state holder/use case as tests are added. This ADR does not authorize household
sharing, notifications, new authentication methods, or recording; their security and data
contracts remain separate milestones.
