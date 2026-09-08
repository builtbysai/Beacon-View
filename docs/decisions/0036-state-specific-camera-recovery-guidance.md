# ADR 0036: State-specific camera recovery guidance

## Context

The web viewer distinguished ready, offline, privacy, disabled, and revoked camera states, but most recovery copy was a single sentence. The dashboard does not receive Android permission settings and cannot inspect local operating-system capture indicators. Generic advice could therefore imply a remote diagnosis or confirmed capture shutdown that Beacon had not observed.

## Decision

Device details derive consumer guidance from existing device state only. Revoked and disabled registrations direct the owner to fresh one-time pairing. Privacy guidance states that live viewing is blocked immediately and that remote capture shutdown occurs when the device receives the state; the camera device remains the source of truth for immediate local shutdown. Offline guidance separates Android and attended-browser recovery steps and explicitly says the dashboard cannot inspect local power, network, or permissions. Connected devices receive compact readiness guidance.

The model adds no telemetry, permission API, backend route, or automatic remediation. Attention states expand their guidance by default; healthy guidance stays collapsed. Camera cards retain short status copy, while device details provide the recovery sequence.

## Consequences

Owners get specific next steps without Beacon claiming knowledge it does not have. Physical-device verification remains required for permission changes, battery optimization, privacy shutdown, and reconnect behavior. Future telemetry must receive a separate data-minimization and retention review before it changes these claims.
