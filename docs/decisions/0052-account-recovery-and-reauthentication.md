# ADR 0052: Account recovery and reauthentication

- Status: Accepted
- Date: 2026-09-15

## Context

Beacon had no way for a password user to recover a forgotten password, no
verified-email state, and no way to satisfy the existing 10-minute
sensitive-action reauthentication window (used by account deletion) without a
full sign-out/sign-in. Per the owner-approved core feature completion plan,
step 3 ("account recovery and hardening") requires closing these gaps before
recording access review.

## Decision

Add three independent capabilities, each following the existing hashed-token
pattern used by household invitations (raw token generated in the route,
only its SHA-256 hash ever persisted):

- **Verified email**: `users.email_verified_at`, backfilled for existing and
  all future Google accounts (Google already verifies the address before
  Beacon accepts the sign-in). Password accounts start unverified;
  `POST /api/account/email/verify/request` (authenticated) and
  `POST /api/account/email/verify/confirm` (token-only) manage a 24-hour
  single-use token.
- **Password reset**: `POST /api/auth/password-reset/request` always
  responds `202` and never differs in timing-observable behavior between an
  unknown email, a Google-only account, and a real password account — the
  first two account states are indistinguishable to the caller and the only
  content difference (a "use Google sign-in instead" email vs. a reset link)
  reaches solely the true mailbox owner. A password account gets a one-hour
  single-use token; `POST /api/auth/password-reset/confirm` validates it,
  updates the password, revokes every existing session for that user, and
  emails a change-alert. If Resend is not configured, the endpoint fails
  closed with `503` for every request uniformly, before any user lookup —
  it must never fall back to returning the token in the API response the
  way household invitations do for their trusted, authenticated caller.
- **Reauthentication**: `POST /api/account/reauth` lets a password-account
  session refresh `browser_sessions.reauthenticated_at` by re-entering their
  password, so the existing account-deletion reauth gate (and future
  sensitive-action gates) don't force a full logout every 10 minutes.
  Google-only sessions get `409` and must still sign in again, since there
  is no password to check.

## Consequences

- New tables `email_verification_tokens` and `password_reset_tokens`
  (migration 0019), plus `revokeAllOwned`/`refreshReauthentication` on the
  session repository.
- Non-silenceable push/in-app security alerts (e.g. "your password changed"
  as a push notification, not just email) are explicitly deferred to the
  separate notification security-event outbox work, to avoid conflating two
  different-shaped delivery systems (user-scoped security events vs. the
  existing per-camera household fan-out).
- No new user-facing UI yet; these are backend contracts for the UI pass to
  wire up, consistent with how the recording foundation (ADR 0051) shipped
  its contract ahead of its UI.
- MFA/passkey policy remains an explicit owner decision, out of scope here.

## Rejected alternatives

- Returning the reset token directly in the API response (as household
  invitations do): breaks the security model, since the reset requester has
  proven no ownership of the target email, unlike a household owner
  inviting a known address.
- Auto-sending a verification email at registration: would tie registration
  success to email deliverability and preempt the UI pass's decision on when
  to prompt for verification; kept as an explicit, separately callable
  action instead.
