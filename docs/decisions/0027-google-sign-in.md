# ADR 0027: Google sign-in without automatic account merging

Status: Accepted

## Decision

Beacon uses Google's authorization-code flow for web sign-in with only the
`openid`, `email`, and `profile` scopes. The backend validates Google ID tokens
with Google's maintained server library and accepts only verified email claims.
It stores Google's immutable subject identifier as the federated identity; an
email address is not used as the identity key.

When a verified Google email already belongs to a password-based Beacon account,
Beacon refuses to create or merge the Google identity automatically. The account
owner must first authenticate to the existing account and explicitly link it in
a later, separately designed flow.

## Consequences

Google-only accounts do not receive a password hash. Existing password sign-in
continues to use the same Argon2 verification and rate limits. OAuth state is
kept in a short-lived, secure, HttpOnly cookie and callback request logging is
disabled to avoid retaining authorization codes.

The Google client secret belongs only in the VM's protected environment file.
Email verification, password reset, and explicit account linking remain
separate account-lifecycle work.

(Superseded for Android by ADR 0121: the app now uses the same system-browser hand-off as the desktop app, returning to `beaconsecureview://auth/desktop`. The paragraph below describes the older `auth/mobile` flow.)

Android monitor sign-in returns to the installed app through the exact
`beaconsecureview://auth/mobile` callback. The callback contains only a
high-entropy, single-use handoff code that expires after ten minutes; the app
exchanges it with the backend over TLS for the account session. Session tokens
and Google authorization codes are never placed in the app-link URI. The
verified HTTPS mobile callback remains accepted for release builds whose app
links are verified, while the custom scheme makes locally signed and sideloaded
builds reliable as well.
