# ADR 0026: Browser-session inventory and revocation

Status: Accepted

## Context

Browser sessions are securely hashed and individually revocable, but an owner
previously had no way to inspect or remove a specific active browser session.
This makes a lost or shared browser unnecessarily difficult to contain.

## Decision

The Settings page lists the authenticated account's active browser sessions by
last activity time and identifies only the current browser. It deliberately
does not expose IP addresses, user agents, device names, token values, browser
fingerprints, or session identifiers in audit metadata.

Owners can revoke any listed session through a CSRF-protected, user-scoped API.
Revoking the current browser clears its local signed-in state immediately. Each
revocation creates a count-free audit event that identifies neither the session
nor the browser.

## Consequences

Lost browser access can be contained without revoking Android camera
credentials or signing out every browser. This does not provide email
verification, password reset, MFA, or a full account-deletion workflow; those
remain separate account-lifecycle release work.
