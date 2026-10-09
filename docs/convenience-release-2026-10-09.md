# Convenience private-alpha release — October 9, 2026

The owner explicitly authorized commit, merge, GitHub push and Oracle deployment.
[PR 94](https://github.com/builtbysai/Beacon-View/pull/94) merged the completed
convenience roadmap and testing policy into main. Deployed source:
`4d3bb30f9fe6e12d11951527a392db8d3695c919`.

[Final PR CI](https://github.com/builtbysai/Beacon-View/actions/runs/37973294063)
and [merged-main CI](https://github.com/builtbysai/Beacon-View/actions/runs/37973820439)
passed validation, PostgreSQL integration, clean/repeated migrations, schema
verification, secret scanning and SBOM checks. Android was skipped because the
change did not touch Android or CI configuration. Earlier CI failures exposed a
schedule-initialization race and a snooze test mount-order race; both were fixed
without removing tests or weakening assertions. The existing Vite large-chunk
warning remains.

## Oracle execution and verification

The automatic deployment workflow was confirmed `disabled_manually` using the
GitHub API and left disabled. The exact validated main source was uploaded with
`git archive` and extracted under
`/opt/beacon/releases/web-4d3bb30f9fe6e12d11951527a392db8d3695c919`.
Both root-owned environment files were used in place, without copying secrets.
The release built backend, migrate, migrate-verify and web, applied migration
0037, verified the additive schema contract, and replaced only backend and web.

Verified after release:

- Both service Compose labels point to the exact release directory above.
- PostgreSQL remains healthy with its previous uptime; Coturn was not restarted.
- Local TLS-routed and public `/health` and `/ready` return healthy responses.
- The catalog independently confirms `notification_preferences.motion_snoozed_until`
  is a nullable timestamp with time zone.
- Signed-out diagnostics and the new snooze mutation return HTTP 401.
- Cast receiver returns HTTP 200, and backend Cast ID remains `E850DDA7`.
- Public JavaScript matches the deployed container file, and includes setup checks
  and bookmarks. `assets/index-CtrWlWw5.js` SHA-256:
  `cb66cfdbd8c50db932526087ee774f9c46eb40884c19be8e3e61e5e2d02bce51`.

The brief initial TLS connection failure recovered through the documented startup
retry. Temporary local/remote upload archives were removed. Prior images were
preserved as `beacon-backend-rollback:33c4848` and
`beacon-web-rollback:33c4848`; the previous release source remains available.
Migration 0037 is additive and compatible with the prior backend. No data-volume
reset, retained backup, backup-timer change, credential change or Cast publication
was performed.

## Remaining acceptance

This confirms release identity, schema, HTTP access gates and service readiness.
It does not prove physical Android privacy/capture, real WebRTC/TURN audio/video,
Cast playback/revocation, encrypted clip round trips or notification delivery.
Those remain separate acceptance gates in the roadmap.

The documentation follow-up corrects stale automatic-deployment claims and records
this evidence. It changes no executable code or runtime configuration, so it does
not require another service rollout.
