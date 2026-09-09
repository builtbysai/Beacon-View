# Beacon SecureView development handoff

Updated September 9, 2026. This is the shortest reliable orientation for a new
development session. GitHub is canonical; the maintained local checkout is
`C:\Dev\Beacon-SecureView`.

## Current source and deployment

- Repository: `Spairkie/Beacon-SecureView`
- Active local branch should be a new `codex/*` feature branch, never `main`.
- Pull requests target `main`; required CI must pass before merge.
- A successful CI run for a push to `main` triggers the protected
  `Deploy web to Oracle` workflow.
- Deployment is web-only. It uploads the validated web artifact to the Oracle
  VM and checks the local HTTPS `/health` and `/ready` endpoints.
- Public private-alpha URL: <https://beaconapp.duckdns.org>
- Deployment details and rollback boundaries: [github-web-deployment.md](github-web-deployment.md)

The repository does not contain production credentials. Keep application secrets
on the VM in `/etc/beacon/production.env`; GitHub's `production` environment
contains only the deployment SSH values (`ORACLE_HOST`, `ORACLE_USER`,
`ORACLE_SSH_PRIVATE_KEY`, and `ORACLE_KNOWN_HOSTS`). Never commit `.env` files,
Android signing material, certificates, screenshots, build output, or
`.beacon-dev` artifacts.

## Local setup

Required tools:

- Node.js 22.13+ within Node 22
- pnpm 11.9.0
- Docker Desktop with Compose
- JDK 17 and Android SDK 35 for Android work

From `C:\Dev\Beacon-SecureView`:

```powershell
pnpm install --frozen-lockfile
.\Start-Beacon.ps1
```

The launcher creates ignored local configuration, starts PostgreSQL and Coturn,
applies migrations, starts the HTTPS/WSS development services, and opens the
viewer. Stop and validate with:

```powershell
.\Stop-Beacon.ps1
.\Test-Beacon.ps1
```

For focused work, use the command matrix in [local-development.md](local-development.md),
[quick-start.md](quick-start.md), and [testing-plan.md](testing-plan.md).
Android hardware testing uses the Pixel serial `34171JEHN07672`; preserve its
app data and do not clean-install without explicit approval.

## Safe continuation prompt

```text
Work in Spairkie/Beacon-SecureView from the latest main.
Goal: <one concrete outcome>
Scope: <files/features allowed to change>
Preserve authentication, authorization, capture visibility, privacy mode,
pairing, and media behavior unless explicitly included above.
Do not redesign unrelated pages or work on main. Create codex/<short-name>,
run relevant checks, review the diff, push the branch, and summarize risks and
manual checks needed before merge.
```

Codex and Claude can work against the same GitHub repository, but each coherent
change should have one branch and one pull request. Resolve conflicts by syncing
with `main`; do not use the old OneDrive checkout.

## Product guardrails and next work

Read [AGENTS.md](../AGENTS.md), this handoff, and [roadmap.md](roadmap.md)
before planning. The product remains an Android-first camera agent with a
responsive web viewer, Fastify/PostgreSQL backend, WebRTC signaling, STUN/TURN,
visible capture controls, privacy mode, pairing, authentication, and media
behavior. Recording, facial recognition, biometric storage, customer-media AI
training, subscriptions, ads, and cross-platform native clients remain outside
current scope.

The owner has deferred page-by-page UI/UX redesign until explicitly directed.
The most useful open evidence work is physical Android privacy/recovery and
media acceptance, backup-restore proof, domain/email identity, security/release
review, legal/trust review, accessibility, and capacity measurements. See N1–N9
in [roadmap.md](roadmap.md); completing a roadmap entry still requires its stated
owner approval and evidence.

## Useful file map

- `apps/web-viewer` — React/Vite viewer and PWA behavior
- `apps/backend` — Fastify API, auth, pairing, signaling, persistence
- `apps/android-camera` — Kotlin/Compose CameraX/WebRTC camera and monitor app
- `packages/shared-types` — shared contracts
- `infrastructure` — local PostgreSQL/Coturn and Oracle deployment material
- `docs/architecture.md` and `docs/threat-model.md` — runtime and security boundaries

The web viewer currently has no committed web manifest or service-worker
registration. It is a responsive HTTPS viewer, not an installable PWA yet; treat
PWA install, offline caching, update behavior, and service-worker security as a
separate explicitly scoped change.
