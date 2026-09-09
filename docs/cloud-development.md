# Cloud development workflow

GitHub is the source of truth. A local checkout is optional. The recommended
environment is GitHub Codespaces, which creates a disposable VS Code workspace
from `.devcontainer/devcontainer.json`.

## Start a workspace

1. On GitHub, choose **Code** -> **Codespaces** -> **New with options**.
2. Select `main` and the Beacon SecureView dev container.
3. Let the one-time setup install pnpm, create the ignored local backend
   environment, start PostgreSQL and Coturn, and apply migrations.
4. Run `pnpm dev` and open forwarded port 5173.

Codespaces uses the safe values from `apps/backend/.env.example`. It does not
need or receive Oracle production secrets. Never add production secrets as
Codespaces secrets.

## Prompt-driven work with Codex or Claude

Use one feature branch and pull request per coherent change. A useful prompt is:

```text
Work in Spairkie/Beacon-SecureView from main.
Goal: <one concrete outcome>
Scope: <files/features allowed to change>
Preserve: authentication, authorization, capture visibility, privacy mode,
pairing, and media behavior unless explicitly included above.
Do not redesign unrelated pages or work on main.
Run relevant checks, review the diff, commit to codex/<short-name>, push it,
and summarize risks and manual checks.
```

Codex connected to GitHub can create a cloud task against the repository and
push its branch or pull request. Claude can use the same repository through a
Codespace or its GitHub-connected coding workflow. Both should treat the PR as
the handoff boundary: review the diff, wait for required checks, and merge only
when approved.

## Release path

```text
prompt -> cloud workspace -> codex/* branch -> PR -> CI -> merge to main
       -> protected production deployment -> /health and /ready checks
```

See [`github-web-deployment.md`](github-web-deployment.md) for deployment
details. Deployment is web-only and does not migrate production or change
backend, Coturn, TLS, or DNS configuration.

## Costs and limitations

Stop or delete idle Codespaces; compute and storage may be billable. A `main`
prebuild can make startup faster but is optional and should be enabled only
after confirming the account budget. Physical Android checks still require a
local or dedicated Android-capable environment.
