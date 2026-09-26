# ADR 0077: Time-limited external recording share links

- Status: Accepted for the active Activity/Clips milestone
- Date: 2026-09-26

## Context

The Clips library (Activity/Clips redesign) lets any household member with
camera access play and download a clip, but there was no way to get a clip to
someone outside the household at all. Ad hoc workarounds (downloading a clip
and emailing the file) bypass Beacon's access model entirely and leave no
record of who a clip was shared with or for how long.

ADR 0065/0068 establish that Beacon's backend holds the means to unwrap a
clip's per-recording key but is not supposed to decrypt media itself; only an
authorized browser does that, using WebCrypto, after the backend relays
ciphertext. Guest links (0066) already prove the same shape for live viewing:
an unauthenticated, token-based, expiring, revocable grant.

## Decision

A household owner can create one active share link per recording. Creating a
new link for a recording that already has one revokes the old link first --
at most one link is ever valid for a given clip, so "who can currently open
this clip" stays answerable at a glance.

- `recording_share_links` stores a hashed token (`generateToken()` +
  `hashSecret()`, the same primitives as pairing codes and invitations),
  `expires_at` (owner-chosen, capped at 72 hours), and `revoked_at`.
- `POST /api/recordings/:id/share-links` (owner only) creates a link and
  returns the raw token/URL exactly once, exactly like a pairing code or
  invitation token; it is never stored or returned again.
- `GET /api/recordings/:id/share-links` (owner only) reports whether an
  active link exists and its expiry, without exposing the token.
- `DELETE /api/recordings/share-links/:linkId` (owner only) revokes it early.
- `GET /api/shared-recordings/:token` and
  `GET /api/shared-recordings/:token/playback` are unauthenticated, rate
  limited by token and by IP, and fail closed on expiry, revocation, or a
  recording that is no longer `available`. Playback follows the exact same
  ciphertext-relay contract as ADR 0068's owner playback route: the backend
  unwraps the per-recording key and hands it to the requesting browser over
  response headers; it never decrypts the clip itself. The recipient's
  browser (an unauthenticated page, the same pattern GuestViewPage already
  uses for live guest access) decrypts locally.
- Creating a link requires an explicit confirmation step in the UI stating
  that anyone with the link can view the clip until it expires or is
  revoked, satisfying the product brief's consent requirement for anything
  that extends media access beyond the household.
- Link creation, access, and revocation are recorded as household activity
  events (`recording_share_link_created`, `recording_share_link_revoked`)
  so an owner can audit who a clip was exposed to and when.

## Consequences

- The security model is unchanged: Beacon's backend still only ever handles
  ciphertext, exactly as ADR 0065/0068 describe. A share link is an
  authorization change (who may ask for the key), not a cryptography change.
- A leaked link grants playback to anyone until it expires or is revoked --
  the 72-hour cap and one-active-link-per-recording rule bound the blast
  radius, but this is a real, intentional trade-off the owner opts into
  per clip, not a default-on behavior.
- The unauthenticated playback route is a new anonymous attack surface;
  it is rate-limited per token and per IP and never reveals whether a
  token is invalid vs. expired vs. revoked (all fail the same way) to avoid
  leaking link state to someone guessing tokens.
- No download-and-forward protection exists once a clip is decrypted client
  side -- this shares Beacon's clip the same way downloading it already did,
  just without requiring a Beacon account first.
