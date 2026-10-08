# ADR 0062: Confirm an expired account-deletion session in place

Status: Accepted, September 23, 2026

## Context

Account deletion requires a sign-in within the previous ten minutes. The web
client previously sent a user whose window expired through a full sign-out and
sign-in, even though `POST /api/account/reauth` already safely refreshes the
window for password accounts.

## Decision

When account deletion returns the recent-authentication response, show a
password confirmation dialog. A successful `POST /api/account/reauth` retries
the already-confirmed account-deletion request. Invalid passwords leave the
dialog open with the server's safe error. Google-only accounts retain the
server's sign-in-again response because there is no password to verify.

## Consequences

The user keeps their current page and does not need to restart the deletion
flow. The backend remains responsible for CSRF validation, rate limiting,
password verification, and the ten-minute window; the browser stores no
credential or reauthentication state.
