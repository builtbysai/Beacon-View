# ADR 0039: GitHub-triggered coordinated deployment

Status: Accepted (tailnet and GitHub environment configured; workflow pending merge)

## Context

Web changes currently require a manual source transfer and remote Compose
rebuild after GitHub validation. This is slow and makes it easy to deploy a
different commit from the one that was tested.

## Decision

After the existing `CI` workflow succeeds for a push to `main`, GitHub Actions
will deploy the exact validated commit to the Oracle private-alpha VM. The
workflow uses a protected `production` environment and pinned SSH host keys,
joins the private Tailscale network as an ephemeral workload-identity-authenticated
`tag:ci` node that can reach only the VM's SSH port,
uploads a Git archive, builds commit-specific backend, migration, and web images,
applies the versioned migrations, recreates the backend and web services, and
verifies `/health` and `/ready`.

The workflow does not recreate persistent PostgreSQL data, Coturn, or Caddy
volumes, and does not change DNS, TLS, or production secrets.

## Consequences

This removes routine manual release steps while keeping schema changes in an
explicit migration container. The VM remains a single point of
failure, the Tailscale federated identity and SSH credentials require careful
rotation/review, and real media/TURN and
physical-device acceptance remain separate from CI deployment success.
