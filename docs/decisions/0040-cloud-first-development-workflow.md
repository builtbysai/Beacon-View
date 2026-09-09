# Decision 0040: Cloud-first development workflow

## Status

Accepted — 2026-09-09

## Decision

Use GitHub as the source of truth and GitHub Codespaces as the default
development environment. Keep changes on feature branches and merge through
pull requests protected by CI. Continue deploying the web service from `main`
through the protected `production` environment.

## Rationale

This removes the OneDrive checkout from the normal workflow, gives Codex and
Claude a reproducible workspace, and keeps development secrets separate from
production deployment secrets. The dev container provisions Node 22, pnpm,
Docker-in-Docker, PostgreSQL, Coturn, and the local example environment.

The workflow does not grant AI agents production credentials. A pull request
and required CI checks remain the review and release boundary.

## Consequences

- Codespaces compute and storage may incur charges.
- Physical Android checks still require a local or dedicated Android setup.
- A maintainer must merge the pull request before deployment.
- GitHub-hosted deployment SSH access still depends on Oracle firewall access;
  the first production run must verify this path.
