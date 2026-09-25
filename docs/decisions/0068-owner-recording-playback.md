# ADR 0068: Owner recording playback

- Status: Accepted for the active recording completion milestone
- Date: 2026-09-24

## Context

ADR 0065 encrypts browser clips before they are uploaded directly to the owner's Google Drive. No authorized download or local playback path existed, leaving successfully uploaded clips unusable in Beacon. Giving the browser a Google Drive access token would expose the broader `drive.file` grant to page script and browser extensions.

## Decision

An authenticated household owner may request playback of a recording created under that same user and household. The repository returns only an available, non-deleted, version-1 encrypted clip. The backend verifies the Drive file metadata, unwraps its per-clip key with the dedicated application key, and streams **ciphertext** from Drive to the authorized browser. It never buffers or decrypts the media. The response is same-origin, `no-store`, and bounded to the recorded byte count; the Google access token never leaves the backend.

The browser checks ciphertext size and SHA-256 against the stored claim, then uses AES-GCM to decrypt locally and creates a temporary object URL for playback. Closing the player or leaving Activity revokes that URL. Playback is rate-limited per account. Non-owners and other households cannot receive the key or ciphertext. The Activity page lists recorded clips for owners; incomplete or failed clips remain visible without a Play action.

## Consequences

Ciphertext now transits Beacon's backend on playback, revising ADR 0065's stronger statement that _no media bytes_ transit the server. Plaintext still never reaches Beacon's backend or Drive. This is storage encryption, not end-to-end encryption, because Beacon can unwrap the clip key. Browser WebCrypto decrypts a whole clip in memory, so large clips may need a future chunked format for older devices. Android's encrypted upload path, Drive disconnect/retry handling, real account playback, and physical-device acceptance remain separate work. No schema migration is required.
