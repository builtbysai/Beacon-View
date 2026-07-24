# Deployment

Production deployment is not part of Milestone 1. The Compose file is for
loopback-only local development and contains intentionally weak sample
credentials. Never publish it directly.

A future approved deployment must supply configuration through environment
variables, use TLS, secure cookies, managed secrets, backups, migration release
procedures, shared rate-limit storage for multiple instances, monitoring, audit
retention, incident response, and data-deletion policy. Migrations must be applied
as an explicit release step; the application must not mutate schema at startup.

TURN dynamic credentials, external addressing, relay exposure, and capacity are
still deferred. This milestone is not production-ready and makes no
end-to-end-encryption claim.
