# GitHub deployment

The repository can deploy a coordinated backend, migration, and web release to
the Oracle private-alpha VM after a successful CI run on `main`. The workflow does
not recreate persistent PostgreSQL data, Coturn, or Caddy volumes.

## Current operational status — October 9, 2026

The workflow is **disabled manually**, confirmed through the GitHub API. A merge
does not deploy automatically. Keep it disabled unless the owner explicitly
approves future automatic releases. For an authorized release, use the exact
CI-validated merged `main` SHA and the manual
[release-directory procedure](development-handoff.md#deploying-a-reviewed-commit).
It uses the same migration, schema verification, backend/web replacement, and TLS
health-check sequence described below. Do not use the historical `/opt/beacon/app`
copy procedure.

## One-time GitHub setup

Completed for the private alpha on September 12, 2026. The GitHub `production`
environment contains the required values, and the Tailscale OIDC trust credential
is restricted to
`repo:builtbysai@37721651/Beacon-View@1309277283:environment:production`, the
`auth_keys` write scope, and `tag:ci`. Keep the following list as the rebuild and
rotation checklist. The subject was updated after the October 9 repository rename;
the audience, scopes and tag were preserved. GitHub uses immutable subjects.

Create a GitHub Environment named `production` and add these environment secrets:

- `ORACLE_USER` — restricted SSH deployment user.
- `ORACLE_SSH_PRIVATE_KEY` — an Ed25519 key used only for deployment.
- `ORACLE_KNOWN_HOSTS` — the pinned `known_hosts` line for the VM's established
  host-key alias (`129.213.128.206`).
- `TS_OAUTH_CLIENT_ID` — the Tailscale workload-identity client ID restricted to
  this GitHub repository and environment.
- `TS_AUDIENCE` — the matching Tailscale workload-identity audience.

Create `tag:ci` in the tailnet policy. Permit that tag to reach only
`beacon-secureview-oracle:22`; do not grant it broad tailnet access. Configure the
federated identity with only the `auth_keys` scope needed to create the temporary
tagged runner node. The workflow uses the private hostname directly, so there is no
`ORACLE_HOST` secret.

Require an environment reviewer if deployments should require approval. The SSH
user should be limited to the directories and commands needed by the workflow,
and TCP 22 must remain closed on the public OCI and host firewalls. Never put the
private key, production environment file, or application secret in the repository.

## VM prerequisites

The VM must already have:

- Docker Engine and Compose.
- `/etc/beacon/production.env` owned by root with mode `600`.
- `/opt/beacon/releases` writable by root.
- Passwordless `sudo` for the deployment user for the required Docker and install
  commands.
- DNS, TLS, backend, PostgreSQL, and Coturn configured according to
  [oracle-cloud-staging.md](oracle-cloud-staging.md).

The workflow first joins the tailnet as an ephemeral `tag:ci` node and verifies
connectivity to `beacon-secureview-oracle`. It then uploads a Git archive to `/tmp`,
extracts it into a commit-specific directory under `/opt/beacon/releases`, builds
the `backend`, `migrate`, `migrate-verify`, and `web` images from that exact source,
starts the existing PostgreSQL service, runs the migration container once, verifies
the resulting PostgreSQL catalog against the checked-in additive migrations, and then
restarts the backend and web services. It then checks `/health` and `/ready` over
HTTPS. An unsuccessful migration or schema verification stops the release before the
backend is restarted. Development releases do not create backups.

## How to deploy

Merge reviewed changes to `main` after PR CI passes, then wait for the merged
commit's CI result. While automatic deployment is disabled, deploy that exact SHA
manually through the release-directory procedure above. If the owner later enables
the workflow, successful push CI on `main` triggers automatic deployment. Its
concurrency group serializes those automatic releases; do not start a simultaneous
manual release.

For a safer first rollout, configure the `production` environment with required
reviewers. A failed health check fails the workflow; inspect the remote web
container and roll back to the previous known-good web release using the existing
Oracle procedure.

The workflow does not prove real WebRTC, TURN relay, physical Android privacy, or
audio behavior. Those remain manual acceptance checks.

The tailnet policy includes saved tests proving that `tag:ci` can reach the Oracle
tailnet address on TCP 22 but cannot reach its web port or the maintainer's Windows
device over SSH. After any policy edit, verify `ssh beacon-oracle` from a
maintainer-owned device before ending the change window.
