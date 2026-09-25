# ADR 0069: Android encrypted recording upload

- Status: Accepted for the active recording completion milestone
- Date: 2026-09-25

## Context

Android could capture a short motion clip and upload it directly to the owner's Google Drive, but that path sent plaintext. The backend therefore rejected every device upload after web/PWA recording adopted the AES-GCM envelope in ADR 0065. Loading an entire clip into memory would also be a poor fit for older camera devices.

## Decision

Android generates a fresh 256-bit data key and 96-bit IV for every clip and streams the local MP4 through AES-GCM into a second cache file. It deletes the plaintext before requesting an upload session. The device sends the ciphertext byte count, SHA-256, original media type, data key, IV, and envelope version through its authenticated Beacon request. The backend authorizes that device credential against the requested recording, wraps the per-clip key with `RECORDING_ENCRYPTION_KEY`, stores the envelope metadata, and opens an `application/octet-stream` Drive upload session. Android uploads only the ciphertext directly to Drive and deletes both cache files after success or failure.

Completion remains credential-bound. The backend verifies the Drive file's size, type, recording marker, and recording ID before marking it available. Owner playback continues to use ADR 0068's browser-side integrity check and AES-GCM decryption.

## Consequences

Android and web/PWA recordings now use the same version-1 envelope and owner playback path. The plaintext and ciphertext briefly coexist in app-private cache while encryption runs; neither is uploaded to Beacon. Interrupted Drive uploads still need explicit retry and stale-upload recovery. Physical Pixel capture, upload, playback, cleanup, low-storage, and process-interruption evidence remain required before recording is release-ready.
