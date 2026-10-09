# ADR 0105: Rename the camera product without migrating installed identity

Status: accepted for the authorized Beacon View rename, October 9, 2026.

Beacon is becoming an umbrella for independent View and Remote products. Rename
camera-facing copy and the GitHub repository to Beacon View; preserve Android
package IDs, desktop application identity, deep links, Cast namespace, database
and Compose names, secret directories, Tailscale hostname and deployment paths.

Those internal identifiers anchor installed credentials, pairing, updates,
persistent volumes and network access. Changing them provides little benefit and
requires separate migration and rollback evidence. Update the existing GitHub
OIDC trust subject for the repository rename while preserving its access scope.

Existing downloaded installers and external registration labels require explicit
follow-up; source branding does not imply new signed binaries were distributed.
See `docs/beacon-view-rename.md` for retained identifiers and operational status.
