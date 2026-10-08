# ADR 0078: Client-captured, independently encrypted clip thumbnails

- Status: Accepted for the active Activity/Clips milestone; Android capture is
  follow-up work, not covered by this pass
- Date: 2026-09-26

## Context

The Clips library shows a generic icon instead of a thumbnail because
recordings are encrypted before Beacon's backend ever sees them (ADR 0065).
Beacon's backend does hold the means to unwrap a clip's per-recording key
(ADR 0068), but generating a thumbnail by decrypting a clip server-side and
extracting a frame would mean the backend routinely decrypts media -- a real
change to the privacy model the product brief treats as the top priority,
not something to introduce as a side effect of a UI nicety.

## Decision

The capturing device (browser camera mode or the live viewer's manual
recorder today; Android's motion recorder as later, separate work) grabs one
frame locally at the start of a recording, encodes it as a small JPEG, and
encrypts and uploads it exactly like the clip itself: a fresh per-thumbnail
AES-256-GCM key, ciphertext-only upload to Drive, the data key sent once
over the authenticated session for Beacon to wrap with
`RECORDING_ENCRYPTION_KEY`. This reuses the clip's existing encrypt/upload
primitives (`encryptClip`, `uploadClipToDrive`) unchanged.

- `recordings` gains `thumbnail_provider_file_id`, `thumbnail_byte_size`,
  `thumbnail_checksum_sha256`, `thumbnail_mime_type`, and the matching
  `thumbnail_encryption_*` triple -- the same envelope shape as the clip's
  own fields, all nullable. A clip is fully usable with no thumbnail.
- `POST /api/recordings/:id/thumbnail-upload-session` and
  `.../thumbnail-complete` (owner, plus device-credential equivalents for a
  future Android sender) mirror the clip's own upload-session/complete
  routes and verification.
- `GET /api/recordings/:id/thumbnail` follows the exact same access rule as
  clip playback (ADR 0068, this milestone's viewer-access fix): owner/admin
  always, a viewer/guest only for a camera they're granted. It relays
  ciphertext and the wrapped key over headers; the browser decrypts locally,
  same as the clip.
- A thumbnail upload failing (capture unsupported, network error, Drive
  quota) never fails or blocks the clip itself -- it is fire-and-forget,
  logged and swallowed, exactly like a missed auto-recording never fails
  the motion report that triggered it.
- Capture happens once at recording start via a temporary off-DOM
  `<video>` + canvas against the same `MediaStream` already being recorded,
  not a second camera access request.

## Consequences

- No new decryption capability was added anywhere; the thumbnail is exactly
  as protected, and exactly as much "storage encryption, not end-to-end,"
  as the clip it belongs to (ADR 0065's caveat applies identically).
- Every clip now potentially uploads two small Drive objects instead of
  one. The thumbnail is capped well under a clip (a few hundred KB), so
  this is a minor storage/quota cost, not a meaningful one.
- Android's motion-triggered recordings will show the generic icon until
  Android implements the matching capture-and-upload step described here;
  this ADR fixes the contract that follow-up work implements against.
- A clip recorded before this change, or one whose thumbnail upload never
  completed, simply has no thumbnail -- the UI must treat it as optional,
  never assume one exists.
