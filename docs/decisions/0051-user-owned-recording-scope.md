# ADR 0051: User-owned recording scope

- Status: Accepted for the active core-feature milestone
- Date: 2026-09-14

## Context

The existing Google Drive connection uses the least-privileged `drive.appdata`
scope to store Beacon's hidden connection metadata. That scope is not a user-
visible recordings library. The product now needs explicit, short recordings and
recording management while preserving the rule that Beacon does not retain media.

## Decision

Implement recordings as explicit short clips only. A clip must be initiated by a
visible user action or an enabled motion policy, must stop when privacy mode is
enabled, and must have an auditable lifecycle (requested, recording, uploading,
available, failed, deleted).

Use a separate Google OAuth grant with `drive.file` for user-visible recording
files. Do not silently widen the existing sign-in or `drive.appdata` grant. The
camera encrypts a completed clip before upload; Beacon stores only clip metadata,
an opaque Drive file ID, checksum, size, duration, and retention state. Continuous,
hidden, or server-side media recording is out of scope.

## Consequences

- Users must explicitly consent to a second Drive permission and recordings use
  their Drive quota.
- A provider adapter is required for resumable upload, listing, playback
  authorization, deletion, retry, quota errors, and disconnect recovery.
- Cross-household playback must check Beacon grants before returning a provider
  reference; the provider ID alone is never authorization.
- Google OAuth verification and final privacy/retention language remain release
  gates, not prerequisites for the backend schema and contract work.

## Rejected alternatives

- Reusing `drive.appdata`: files would be hidden app data and cannot support a
  user-facing recording library.
- Uploading plaintext media through Beacon: increases server exposure and breaks
  the user-owned-storage privacy boundary.
- Continuous recording: excessive battery, heat, bandwidth, quota, and retention
  risk for the Android-first product.
