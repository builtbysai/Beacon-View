# Deployment

Production deployment is not part of Milestone 2. The Compose file is for
loopback-only local development and contains intentionally weak sample
credentials. Never publish it directly.

A future approved deployment must supply configuration through environment
variables, use TLS, secure cookies, managed secrets, backups, migration release
procedures, shared rate-limit storage for multiple instances, monitoring, audit
retention, incident response, and data-deletion policy. Migrations must be applied
as an explicit release step; the application must not mutate schema at startup.

Production signaling requires TLS/WSS, trusted proxy and Origin configuration,
connection limits, and shared ephemeral state before adding replicas. Coturn
requires public addressing, short-lived credentials, restricted relay ranges,
abuse monitoring, and capacity planning. Static local TURN credentials must never
be deployed. This milestone is not production-ready and makes no
application-level end-to-end-encryption claim.
