# View workspace and development handoff

Owner-authorized October 31, 2026 maintenance makes the copied workspace independent of `C:/Dev`; no new product milestone or media feature is part of it. The product is Beacon View, its GitHub origin is Beacon-View, and its local folder remains Beacon-SecureView. Historical package/Compose/application identifiers remain compatible.

## Run and validate

Use Node 22.13–22.x, pnpm 11.9.0, Docker Compose, and Android SDK/JDK as documented in `local-development.md`. The portable shell setup sets `BEACON_ENV_FILE` to `view/backend.env` outside the checkout. The backend loads that exact file without overriding explicit environment values; a configured missing/unreadable file fails startup. An ordinary clone without that variable retains the existing local `.env` fallback. Never overwrite a private file with `.env.example`.

Dependencies are hoisted copies; injected workspace packages are not deduplicated back into junctions. Build/typecheck/test/dev workflows refresh injected packages. Run `pnpm install --frozen-lockfile`, then the reviewed local Compose/migration/dev workflow. Keep API/web/PostgreSQL 3000/5173/5432 independent of Remote's 3010/5174/5433. Tests use an explicit separate `_test` database, typically port 5544; `NODE_ENV=test` is required, and its URL must differ from `DATABASE_URL`. Migrations are explicit, never a side effect of app startup.

`pnpm check` runs formatting/lint/types/tests/build; Android unit/lint/build checks are separate. Physical-device, privacy shutdown and direct/forced-relay streaming acceptance must be reported separately. See `testing-policy.md`; protect realistic regressions without coverage/count targets.

Current private configuration is `view/backend.env`; signing/deployment recovery material is under `signing-and-deployment`, with update signing key `signing-and-deployment/update-signing-key.pem`. `view/legacy-update-signing-key.pem` is a preserved older-location copy, not permission to rotate keys. Installed desktop browser sessions remain in their runtime profile. `.beacon-dev` was historical scratch/evidence; consult the maintenance manifest before relying on old loose scripts or absolute paths.

Read `roadmap.md` for approved product scope and `product-build-brief.md` as historical context. Work on a feature branch. No naming migration, production restart or cloud deployment was performed by this workspace change.

## Workspace and private data

The active Windows workspace is `D:/Dev`. The sibling `D:/Beacon-Private` holds real files, with a restricted owner/SYSTEM/Administrators ACL; it is outside all repositories. Never commit its contents. The encrypted independent workstation backup is under `C:/Users/Saiha/Beacon-Backups`, outside the retired `C:/Dev` tree. Its password is in the private root; a current-Windows-user DPAPI-protected recovery copy is beside the backup. That DPAPI copy is not a portable password-manager escrow. Before changing PCs, export the password securely to the owner's credential store and restore-test it on the destination.

Dot-source `. ./scripts/Enter-Workspace.ps1` before local development. If the workspace/private folder is elsewhere, pass `-PrivateRoot <actual-private-folder>` or set `BEACON_PRIVATE_DIR`; never substitute blank/default credentials when a key is missing. This sets paths, not secret values. Keep the repositories independent. Do not confuse dev, disposable tests, hosted acceptance and production.

Development credentials, local deployment-config copies, signing material, SSH keys and retained test profiles were centralized. Installed apps' live identities/browser sessions, Android/Windows credential stores and server secrets retain their required runtime locations by owner choice. DPAPI identities still depend on the original Windows user/machine; moving their files does not make them portable identities.

No production deployment is part of workspace publication. Existing `beacon-oracle` SSH access remains strict-host-key-checked over Tailscale. Server configuration stays root-owned under `/etc/beacon*`; never render secret-bearing Compose/environment output into reports. Shared Oracle ingress and independent View/Remote relays require coordinated changes. Current committed source need not equal the running backend or downloaded native binaries.

The private audit/maintenance directories record inventory, hashes, backup and cleanup evidence. Treat old handoffs and C-path examples as historical unless explicitly updated. Never recover occupied ports by stopping their owners. Back up before installs/moves/cleanup and test restoration; GitHub protects pushed source, not ignored secrets, databases or enrolled identities.

Current maintenance evidence: [workspace-validation-2026-11-01.md](workspace-validation-2026-11-01.md). This records the actual checks and remaining acceptance gates.
