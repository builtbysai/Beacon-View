# ADR 0103: Read-only setup health checks

Status: Accepted for the owner-approved convenience completion, October 9, 2026.

Connection details offers an explicit setup check using existing authenticated
diagnostics, Drive status, and personal notification preference endpoints. Each
failed endpoint remains unknown independently. The household/role-scoped page
aborts pending checks when it unmounts. No new backend service or permission grant
is introduced.

The checks do not start capture, request permissions, send alerts, or make clips.
Remote permissions, privacy behavior, media playback, recording integrity, and
actual delivery require deliberate manual/device validation. Online and connected
are configuration observations, not a claim that the complete workflow works.

Existing settings and camera links provide the next steps. Status is a snapshot;
rerun after changing settings. Notification preferences do not prove receiver
enrollment or override snooze, quiet hours, or privacy mode.
