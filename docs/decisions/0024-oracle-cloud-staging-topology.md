# ADR 0024: Oracle Cloud Always Free staging topology

Status: Accepted for private cloud staging only.

## Decision

Use one Oracle Always Free ARM virtual machine for an internet-reachable private
test environment. The VM runs Caddy, the static web viewer, the Fastify API and
signaling service, Coturn, and PostgreSQL as Docker Compose services. Caddy serves
the viewer and proxies `/api` from one HTTPS/WSS origin. PostgreSQL has no host port.

Open only TCP 80/443, TCP/UDP 3478, and the bounded TCP/UDP TURN relay range.
Restrict SSH to the owner's current public IP at both OCI and host firewalls. Coturn
uses a newly generated REST shared secret, a stable public IPv4 address, and the
configured DNS hostname. Backend migrations remain an explicit release command;
application startup does not mutate the database schema.

Secrets live only in an owner-readable VM environment file, never in Git, image
layers, application logs, or the local development environment.

## Consequences

This moves testing off the local LAN and enables physical Android acceptance over
ordinary internet connections. It is intentionally a single-instance staging setup:
there is no high availability, managed secrets integration, or production account
lifecycle. Daily encrypted off-VM PostgreSQL backups, a separate-database restore
verification, and basic five-minute availability monitoring are installed for the
private alpha. They are not substitutes for scheduled restore drills, centralized
observability, or an independent security review. It does not satisfy the release
gates in `pre-deployment-readiness.md` and must not be described as production-ready.
