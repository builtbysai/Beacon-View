# ADR 0071: Browser recording upload retry

- Status: Accepted for the active recording completion milestone
- Date: 2026-09-25

## Context

Web and PWA recording discarded the locally encrypted clip as soon as a Google Drive upload failed. The owner saw a generic error and had to capture a different clip. Drive quota exhaustion, an expired authorization grant, a stale resumable session, and a temporary provider failure all looked the same.

## Decision

The browser retains the encrypted clip, its one-time encryption envelope, and upload metadata in memory after a failed upload. The record control becomes a retry action. A retry reuses the existing resumable session for temporary and quota failures, opens a new session after authorization or session expiry, and retries only Beacon completion when Drive already returned a provider file ID. The owner can explicitly discard the pending clip, and leaving the page reports abandonment when no upload attempt is active.

Drive responses are classified into quota, authorization, expired-session, temporary, and unknown failures with actionable messages. No plaintext clip, Drive token, or pending recording is written to browser storage.

## Consequences

Transient failures no longer require a second recording, and an owner can free Drive space or reconnect access before retrying the same encrypted bytes. Refreshing or closing the page discards the in-memory clip, after which Beacon's failure transition or stale recovery releases the server record. Background persistence and cross-device retries remain out of scope because they would require a separately reviewed encrypted local-storage lifecycle.
