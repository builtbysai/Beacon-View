# ADR 0002: Authentication, pairing, and presence

- Status: Accepted
- Date: 2026-07-23

## Decision

Use PostgreSQL with explicit Drizzle migrations as the authorization state
authority. Accounts own one household. Passwords use Argon2id. Browser and Android
credentials are separate opaque 32-byte tokens stored only as SHA-256 hashes.
Browser authentication uses an HttpOnly `SameSite=Lax` cookie with a double-submit
CSRF value also checked against its server-side hash.

Use ten-character, 50-bit, one-time pairing codes. Lock and consume the code in
the transaction that creates a camera and its credential. Derive camera presence
from 30-second heartbeats with a 90-second online threshold. Use in-process rate
limits for the single-instance MVP.

## Consequences

Revocation and pairing invariants live in PostgreSQL and work immediately on one
instance. Raw tokens and pairing codes cannot be recovered from the database.
Multiple backend replicas are not supported safely until rate limits use shared
storage. Production requires TLS, an explicit migration release step, and secure
environment configuration. No media or signaling capability is introduced.
