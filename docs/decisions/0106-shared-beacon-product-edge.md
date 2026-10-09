# ADR 0106: Share only the Beacon frontend edge

Beacon Remote requires a dedicated HTTPS origin while reusing this VM. Add a
small `beacon-edge` Docker network to View's web/Caddy container and import optional
root-owned non-secret product hostname routes from `/etc/beacon/products`.
The backend, PostgreSQL and Coturn retain their existing network and credentials.
Remote joins only this frontend network with its own private web container; its
backend and database stay on a separate internal network.

This preserves one public TLS edge and existing certificate storage, avoids a
second public port or paid proxy service, and keeps product source/build/data
independent. An empty Caddy import glob is valid, so View still deploys by itself.
Do not put credentials in route fragments or attach product backends/databases
to the shared edge. Route files require root ownership and review. One frontend
can reach another frontend; this is not isolation against a fully compromised VM.

Create the host products directory before replacing web. Validate the Caddyfile
both with no fragments and with each installed product route. Keep the previous
image/configuration for rollback and verify View independently after replacement.
Remote manages its own deployment and backup/restore acceptance. View's automatic
deployment workflow remains disabled.

Sources: [Caddy imports](https://caddyserver.com/docs/caddyfile/directives/import),
[Docker Compose network isolation](https://docs.docker.com/reference/compose-file/networks/).
