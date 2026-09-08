# ADR 0029: Private-alpha service monitoring

Status: Accepted for the single-VM Oracle private alpha.

## Decision

Run a root-owned systemd timer every five minutes on the Oracle VM. It verifies the
public HTTPS readiness endpoint, which verifies a PostgreSQL query, and required
backend, PostgreSQL, and Coturn containers.
On the first continuous failure it sends one plain-text alert through the already
configured Resend account; when the service recovers it sends one recovery email. The
monitor stores only an alert-state marker on the VM, not response bodies, cookies,
credentials, or media.

## Consequences

This is basic availability monitoring for a single machine, not centralized logs,
metrics, tracing, TURN allocation monitoring, capacity alerts, or an on-call system.
It deliberately sends no periodic healthy email and rate-limits a continuous outage to
one alert. The Resend onboarding sender is appropriate only while delivery is limited
to the owner’s verified address; a verified owned domain is required before using this
for broader operators or users.
