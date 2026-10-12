# ADR 0119: Security review before the repository goes public

- Status: Accepted (2026-10-12). The review is done; the repository is still private until the owner decides.

## Context

GitHub Actions minutes are billing-blocked on a private repository, and a public repository would lift that.
Going public publishes every file and every commit forever, so this review came first.

## What was checked

| Check                                                                                                                                             | Result                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gitleaks over the whole history (`detect --log-opts=--all`, 409 commits, 8.8 MB)                                                                  | No findings                                                                                                                                                                                                                                                            |
| Files that could hold keys (`*.pem`, `*.key`, `*.p12`, `*.jks`, `*.keystore`, `.env`, `google-services.json`, service-account JSON) in any commit | None. Only `*.env.example` files and source files with "credential" in the name                                                                                                                                                                                        |
| Private keys, cloud keys, SSH keys in tracked text                                                                                                | None                                                                                                                                                                                                                                                                   |
| Workflows                                                                                                                                         | No `pull_request_target`. CI runs on `pull_request` with read-only permissions. The deploy workflow only runs after CI on `main` of this repository, behind the `BEACON_AUTO_DEPLOY` variable and the `production` environment. The desktop release workflow is manual |
| Secrets in Actions                                                                                                                                | Only referenced as `secrets.*`; fork pull requests never receive them                                                                                                                                                                                                  |
| Test data                                                                                                                                         | Addresses are documentation ranges (`192.0.2.x`) or `example.test`                                                                                                                                                                                                     |

## What a public repository would reveal (accepted or to trim)

1. The production server's public address, in `.github/workflows/deploy-web.yml`, `docs/github-web-deployment.md` and `docs/development-handoff.md` (an SSH host-key alias). The address is in public DNS anyway, public SSH is closed (administration is over Tailscale only), so this is information, not access. Trim it from the docs before publishing.
2. The Android sideload app is signed with the owner's debug key, and its certificate fingerprint is in `assetlinks.json` (a fingerprint is public by design). The key itself is private. Before the Play Store, create a dedicated upload key (already a deferred item).
3. Internal handoff documents (`docs/OMARCHY-*.md`, `docs/handoff-*.md`, `docs/development-handoff.md`) name local Windows paths, the owner's Windows user name, provider names and the Firebase project and service-account addresses. None is a credential. They are working notes and should move out of the public tree (or be squashed out of history) before publishing.
4. No `LICENSE` file exists. Publishing without one means "all rights reserved", which is safe but not open source. The owner has to choose: keep it source-available under a custom notice, or pick a license (AGPL-3.0 keeps a hosted fork honest; MIT/Apache-2.0 do not). This is a business decision, not a technical one.
5. No `SECURITY.md`. Add one with a contact address and a request for private disclosure before going public.

## Decision

- The history can be published as it is: nothing in it needs rewriting for secrecy.
- Before the switch, in one small change: remove the internal handoff files and the server address from public docs, add `LICENSE` (owner's choice) and `SECURITY.md`, and turn on GitHub secret scanning and push protection.
- Keep production secrets, the update-signing key, signing keystores and the production environment out of the repository as they are today (`/etc/beacon/*.env` on the server; the owner's credential store locally).
- Rotate nothing for this reason alone. Rotate the TURN secret, Resend key and notification keys only if the owner finds a copy outside the places listed in `docs/OMARCHY-SECRETS-HANDOFF.md`.

## Not done

- No third-party penetration test. The threat model (`docs/threat-model.md`) is the author's own.
- Dependencies are scanned weekly by `dependency-audit.yml` and not re-scanned here.
