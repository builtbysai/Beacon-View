# Deployment

Production deployment is not part of Milestone 3. The Compose file is for
loopback-only local development and contains intentionally weak sample
credentials. Never publish it directly.

A future approved deployment must supply configuration through environment
variables, use TLS, secure cookies, managed secrets, backups, migration release
procedures, shared rate-limit storage for multiple instances, monitoring, audit
retention, incident response, and data-deletion policy. Migrations must be applied
as an explicit release step; the application must not mutate schema at startup.

Production configuration requires HTTPS/WSS origins and rejects the local
insecure opt-in. TLS certificates must chain to platform-trusted roots; clients
never disable verification. Browser upgrades enforce the exact configured
Origin.

Coturn uses its REST shared-secret mechanism. The backend keeps the secret and
issues a distinct HMAC-SHA1 credential with a Unix-expiry username to each
authorized participant for at most ten minutes. Production must provide
reachable UDP and TCP TURN URLs, an external address when NAT requires it,
restricted relay ranges, abuse monitoring, rotation, and capacity planning.
Static local TURN credentials are rejected in production. The optional local
Caddy profile and its development CA are not a deployment solution.

Signaling remains single-instance and in-memory. Horizontal deployment requires
shared signaling state and shared rate-limit storage. This milestone is not
production-ready and makes no application-level end-to-end-encryption claim.
