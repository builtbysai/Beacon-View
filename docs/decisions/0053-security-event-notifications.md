# ADR 0053: Security event notifications

- Status: Accepted
- Date: 2026-09-15

## Context

Step 1 of the core feature completion plan calls for "a shared security-event
outbox for sign-in, password/email changes, membership changes, device
revocation, and account deletion" that "cannot be silenced like motion
alerts." The existing notification transport (ADR 0044) is entirely
camera/device-centric: every row in `notification_events` joins against a
per-`(user_id, device_id)` row in `notification_preferences` to decide
whether to fire, and quiet hours can suppress it. Security events have no
device and must never be suppressible by a preference toggle.

## Decision

Add `category = 'security'` to `notification_events` (migration 0020) and a
dedicated `PostgresNotificationRepository.recordSecurityEvent()` path that
skips the preference/quiet-hours join entirely — there is nothing in Beacon
for a user to disable it with, which is what "cannot be silenced" means here.
It reuses the same `notification_outbox` fan-out, worker, and delivery code
as motion/offline/recovered, so no changes were needed to
`notification-job.ts` or `notification-delivery.ts`.

Wired into five triggers, all targeting the acting/affected user directly:

- **Sign-in**: `/api/auth/login`, the web Google OAuth callback,
  `/api/mobile/auth/google`, and `/api/mobile/auth/login` — all four session-
  issuing paths.
- **Email verified**: `/api/account/email/verify/confirm`.
- **Device revoked**: both `/api/devices/:deviceId/revoke` and
  `DELETE /api/devices/:deviceId`.
- **Household membership changed**: accepting an invitation and revoking a
  member.

**Password changes and account deletion are deliberately excluded** from
this push/in-app path. Both revoke every one of the user's sessions, and
`PostgresSessionRepository.revoke`/`revokeAllOwned` cascade that into
revoking every push subscription tied to those sessions — an outbox entry
for either would almost never have a live subscription left to reach by the
time the worker picks it up. Both already get (or now get) an email alert
instead, which doesn't depend on a still-active session:
`deliverPasswordChangedAlert` (ADR 0052) and the new
`deliverAccountDeletedAlert`, sent synchronously before the account row (and
its cascading subscriptions) are gone.

The web service worker and the Android FCM handler both maintain a small
category-to-copy map and silently drop anything not in it — `security` had
to be added to both or the alert would never have displayed despite reaching
the device. Payload content stays as generic as the existing categories
(no event-type detail, just `category` and a `route` hint to `/settings`),
consistent with motion/offline/recovered never revealing camera identity in
the push payload either.

## Consequences

- Every login (not just "new device") triggers an alert to a user's other
  active devices. This is simple and matches the plan's literal wording, but
  risks alert fatigue for people who sign in often; a future device-
  recognition heuristic could narrow this without changing the outbox
  itself.
- Recipients are the acting/affected session's own user, not necessarily a
  household's owner, when an admin (not the owner) performs a shared-
  household action. Acceptable for the current single-owner-household-in-
  practice deployment; revisit if multi-admin households become common.
- No web/Android UI surfaces a "security events" history yet; this ships the
  backend contract and delivery pipeline, consistent with how recording
  (ADR 0051) and account recovery (ADR 0052) shipped ahead of their UI.

## Rejected alternatives

- Extending `enqueueMotion`'s shared private `#enqueueEvent` helper by
  loosening its `deviceId: string` (required) parameter to optional: kept
  the two paths separate instead, since threading an optional device through
  a helper whose entire cache-key and preference-join logic assumes one
  present would have made the "cannot be silenced" property harder to see
  by inspection, not easier.
- Also recording password-changed/account-deletion as outbox events "for
  completeness": rejected once the session-revocation-cascade analysis above
  showed they would almost never deliver, which would be a false sense of
  coverage worse than the current explicit email-only path.
