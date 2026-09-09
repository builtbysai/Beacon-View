# 0014: On-device motion metadata

## Status

Accepted for the first motion-events slice.

## Decision

Android Camera Mode samples a small fixed grid from CameraX's luma plane at no
more than two samples per second. A motion event requires a meaningful fraction
of samples to cross a brightness-difference threshold. The initial detector and
backend both applied a 30-second cooldown.

[ADR 0019](0019-atomic-motion-ingestion.md) strengthens the backend cooldown and
authorization checks against concurrent reports and management changes.

Only the server-issued camera-source identifier, server timestamp, event type,
and normalized scene-change confidence are stored. Frames, thumbnails, audio,
pixel samples, network addresses, and recognition labels are not retained or
uploaded. The backend accepts reports only from the credential belonging to the
same enabled, non-private camera source.

## Consequences

This is inexpensive enough for older devices and creates no media-storage
system. It can produce false positives from abrupt lighting changes or camera
movement, so the interface describes confidence as scene change rather than
human presence. Person/object detection, notifications, schedules, quiet hours,
zones, and thumbnails remain separate future decisions. Per-camera enablement,
sensitivity, and a selected 30-second, one-minute, two-minute, or five-minute
cooldown are governed by [ADR 0021](0021-per-camera-motion-settings.md).

The initial event list was capped at the latest 100 records per household. This
limit is superseded by [ADR 0018](0018-motion-history-pagination.md), which adds
household-scoped server filtering and cursor pagination.
Household owners can clear all motion metadata through a CSRF-protected action;
the deletion is audited without retaining deleted event contents. Automated
time-based deletion and a configurable retention duration are still required
before production release.
