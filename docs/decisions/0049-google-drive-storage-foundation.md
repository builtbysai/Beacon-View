# ADR 0049: Google Drive storage foundation

- Status: Accepted bounded foundation; media upload not enabled
- Date: 2026-09-14

## Context

Users requested Google Drive as an optional cloud-storage destination. Beacon must
not silently turn that request into cloud recording or broad Drive access. Google
OAuth refresh tokens also require secure long-term storage and must not be kept in
browser storage.

## Decision

Add an authenticated Google Drive connection using the web-server OAuth flow with
offline access and the least-broad `drive.appdata` scope. The backend stores only
an encrypted refresh token, provider email, and granted scope. The token is bound
to the Beacon account, revocable from Settings, and verified through the Drive API
without exposing an access token to the browser.

The first UI slice exposes connect, status, verify, and disconnect controls and
explicitly states that camera media and recordings are not uploaded. Future
Beacon-owned app-data backup can use the private Drive app-data area. Camera
recording, clips, household exports, retention, deletion, and user-visible Drive
files require a separate consent and privacy design before implementation.

## Consequences

- Drive access is opt-in and scoped to Beacon-owned app data.
- Refresh tokens remain server-side and encrypted with a dedicated application key.
- Revoking or deleting an account removes the stored connection; provider-side
  revocation and data deletion need to be added before public release.
- A configured Google OAuth client and Drive token-encryption key are required to
  enable the feature; local development can leave the feature disabled.
