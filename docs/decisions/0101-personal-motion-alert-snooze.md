# ADR 0101: Personal motion-alert snooze

Status: Accepted for the owner's October 9, 2026 continuation.

Add 15/30/60-minute motion-alert snooze and early resume to the web/desktop
notification settings. Keep the scope personal to one manager and one camera
device, across that manager's enrolled notification channels. Other managers'
preferences and deliveries remain independent.

Store a nullable `motion_snoozed_until` deadline in notification preferences,
introduced by migration 0037. The authenticated, CSRF-protected manager endpoint
accepts only 0/15/30/60 minutes and derives the deadline from the server clock.
Zero clears snooze. No background reset job is required: motion enqueue eligibility
compares the server event time against the deadline. Expiry does not change the
motion-enabled flag, quiet hours, Home/Away rules, or subscription enrollment.

The ordinary preference endpoint preserves snooze, including changes from older
Android clients. The web autosave chain serializes snooze and ordinary edits per
camera and rolls back failed changes to the last confirmed state. The deadline
shown in the viewer uses local time; focus and periodic refresh remove expired
UI state. Notification settings remount when account/household scope changes.
Server enforcement continues while the viewer is closed.

Snooze discards pending motion outbox rows and rechecks queued/retry eligibility
before claims. It does not release a backlog after expiry. Provider failures must
not resurrect terminal deliveries. An alert already claimed by a running delivery
batch or handed to a provider may still arrive; provider delivery cannot be recalled.
Motion metadata, capture,
recording, problem/health alerts, and security alerts retain their normal behavior.
Quiet hours or Home mode can still suppress motion after snooze ends.

The existing Drizzle snapshots lagged several manually authored migrations.
The new generated snapshot reconciles the current schema; migration 0037 itself
adds only the snooze column and must not replay earlier schema changes. Validate
clean and repeated migration application plus the additive schema verifier.

No new dependency, service, provider permission, or recurring cost is introduced.
Native Android snooze controls and an all-alert/all-camera snooze are outside this
milestone. Production rollout must apply migration 0037 before the updated API.
