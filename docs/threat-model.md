# Threat model draft

## Scope and assets

This draft covers the planned Android camera, web viewer, backend, PostgreSQL,
signaling channel, and TURN relay. Protected assets include account and device
credentials, camera authorization, presence data, private media, event metadata,
and access audit history.

## Trust boundaries and principal threats

- Untrusted clients cross the backend API boundary: validate every input and
  authorize every camera action to prevent spoofing and insecure direct access.
- Browser, Android, backend, database, and TURN are separate trust zones. Use TLS
  in production and protect credentials at rest.
- Logs may become a disclosure channel. Redact authorization and session headers;
  never log secrets, pairing codes, or media.
- Pairing and authentication endpoints will face guessing, replay, enumeration,
  and denial-of-service threats. Later milestones require expiry, rate limits,
  credential rotation/revocation, and audit events.
- TURN can be abused as an open relay. Production configuration requires dynamic,
  short-lived credentials, TLS, network controls, monitoring, and capacity limits.
- A compromised or misleading camera UI can violate physical privacy. Capture must
  always have unmistakable local indicators and privacy mode must stop it.

## Milestone 0 controls

Environment values are validated without logging their contents; sensitive HTTP
headers are redacted; services bind to loopback for local development; sample
credentials are explicitly local-only; no capture permissions or media paths
exist. This is a draft, not a production security assessment or an encryption
claim.
