# ADR 0065: Encrypted browser recording export

- Status: Accepted for the active core-feature milestone
- Date: 2026-09-24

## Context

ADR 0051 requires a completed clip to be encrypted before upload to the user's
Google Drive. The existing browser and Android uploaders sent raw media to a
resumable Drive URL, which violated that requirement. The recording library and
playback route are not yet implemented, so this decision only establishes the
safe capture-to-storage boundary.

## Decision

The web/PWA captures a completed clip locally, generates a unique 256-bit
AES-GCM key and 96-bit IV, and uploads only the resulting ciphertext with
`application/octet-stream`. The Drive filename uses the `.beacon` suffix. The
backend verifies ciphertext size and MIME type before marking a recording
available.

The browser submits the per-clip key over the authenticated HTTPS request only
so the backend can encrypt it using the dedicated 32-byte
`RECORDING_ENCRYPTION_KEY` before it is persisted with recording metadata. The
server never receives or persists media bytes. It redacts the transient key
from request logs. This protects Drive-stored media from disclosure as a normal
video file and keeps the direct-upload boundary intact.

The legacy Android upload and completion endpoints return a clear `409` until
the Android client implements this envelope. This fails closed: a device cannot
export plaintext recording data during the transition.

## Consequences

- This is storage encryption, not end-to-end encryption. Beacon's application
  key can unwrap a stored per-clip key, so no end-to-end encryption claim is
  permitted.
- Recording storage needs an independent deployment secret and key-rotation
  plan before public release.
- An authorized ciphertext-download and local-decryption playback flow remains
  required before presenting recordings as playable in the product.
- Android motion recording is temporarily unable to upload clips. It continues
  to record only through its visible capture path and receives the explicit
  update-required error instead of exporting plaintext.
