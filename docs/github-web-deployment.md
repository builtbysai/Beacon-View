# GitHub web deployment

The repository can deploy the web viewer to the Oracle private-alpha VM after a
successful CI run on `main`. The workflow is intentionally web-only: it does not
run migrations or recreate the backend, PostgreSQL, Coturn, or persistent Caddy
volumes.

## One-time GitHub setup

Create a GitHub Environment named `production` and add these environment secrets:

- `ORACLE_HOST` — VM hostname or IP address.
- `ORACLE_USER` — restricted SSH deployment user.
- `ORACLE_SSH_PRIVATE_KEY` — an Ed25519 key used only for deployment.
- `ORACLE_KNOWN_HOSTS` — the pinned `known_hosts` line for the VM.

Require an environment reviewer if deployments should require approval. The SSH
user should be limited to the directories and commands needed by the workflow,
and TCP 22 should remain restricted by the OCI and host firewalls. Never put the
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

The workflow uploads a Git archive to `/tmp`, extracts it into a commit-specific
directory under `/opt/beacon/releases`, builds the `web` image from that exact
source, and runs `docker compose build web` followed by
`docker compose up -d --no-deps web`. It then checks `/health` and `/ready` over
HTTPS. It does not apply database migrations; backend or schema releases remain
deliberate separate operations.

## How to deploy

Merge reviewed web changes to `main`. After the `CI` workflow succeeds, the
`Deploy web to Oracle` workflow runs automatically. The deployment is serialized
so two web releases cannot replace one another concurrently.

For a safer first rollout, configure the `production` environment with required
reviewers. A failed health check fails the workflow; inspect the remote web
container and roll back to the previous known-good web release using the existing
Oracle procedure.

The workflow does not prove real WebRTC, TURN relay, physical Android privacy, or
audio behavior. Those remain manual acceptance checks.
