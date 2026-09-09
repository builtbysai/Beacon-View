# ADR 0021: Per-camera motion settings

Status: Accepted.

## Context

The first motion detector used one fixed threshold and 30-second cooldown for
every Android camera source. A camera facing a bright window and a camera in a
quiet hallway need different false-positive tradeoffs. A browser-only setting
would be misleading if an older phone kept reporting with the old setting.

## Decision

Store motion enablement, sensitivity (`low`, `medium`, or `high`), and cooldown
(30, 60, 120, or 300 seconds) on each active Android camera source. Defaults
preserve the existing behavior: enabled, medium sensitivity, and 30 seconds.
The household owner reads the source settings through the existing authenticated
device detail route and changes one source using the existing CSRF-protected
state-change route. The server authorizes household ownership and records an
audit event containing only the camera identifier.

Android obtains settings with its authenticated device status cycle. It changes
the on-device luma detector on its analysis thread without rebuilding the video
capture pipeline. Until a settings response is available, the detector remains
off; a transient refresh failure retains the last successful settings. The
server remains authoritative: it suppresses reports for disabled sources and
uses the configured cooldown inside the atomic ingestion transaction.

## Consequences

No frame, thumbnail, audio, activity zone, schedule, quiet-hour decision, or
person/object label is added. Settings may take up to the existing device
connection-check interval to reach the phone, and a phone that is offline keeps
its last verified setting. A disabled source can still stream live video; this
setting controls motion metadata only. Future schedules, quiet hours, zones,
and calibration need separate data contracts and decisions.

## Validation

Schema validation rejects unsupported settings. PostgreSQL integration tests
cover household isolation, CSRF, device credential access, disabled-source
suppression, configured cooldown boundaries, source resynchronization, and
revocation. Web tests cover lazy loading, per-source saves, retrying a failed
save, disabled controls, and stale device responses. Android unit tests cover
sensitivity, disabled analysis, cooldown selection, and detector baseline reset.
