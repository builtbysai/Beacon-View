# ADR 0039: GitHub-triggered web-only deployment

Status: Proposed

## Context

Web changes currently require a manual source transfer and remote Compose
rebuild after GitHub validation. This is slow and makes it easy to deploy a
different commit from the one that was tested.

## Decision

After the existing `CI` workflow succeeds for a push to `main`, GitHub Actions
will deploy the exact validated commit to the Oracle private-alpha VM. The
workflow uses a protected `production` environment and pinned SSH host keys,
uploads a Git archive, builds a commit-specific web release, recreates only the
`web` service, and verifies `/health` and `/ready`.

The workflow will not run database migrations or change backend, PostgreSQL,
Coturn, Caddy volumes, DNS, TLS, or production secrets.

## Consequences

This removes routine manual web deployment steps while preserving a clear release
boundary for schema and infrastructure changes. The VM remains a single point of
failure, SSH credentials require careful rotation, and real media/TURN and
physical-device acceptance remain separate from CI deployment success.
