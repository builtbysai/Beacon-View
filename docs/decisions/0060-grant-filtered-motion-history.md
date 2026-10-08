# ADR 0060: Grant-filtered motion history for household viewers

Status: Accepted, September 23, 2026

## Context

Home and Activity show recent motion to every signed-in household role, but
`GET /api/motion-events` previously required an administrator. Viewers could see
their granted cameras but received a permission error for those cameras' motion.
Household audit events contain broader membership and security information and
remain administrator-only.

## Decision

Authenticate any active household session for the motion history read. For a
viewer or guest, resolve the currently accessible camera sources and apply those
IDs in the motion history SQL before ordering and pagination. An empty grant
list returns no events. The requested camera filter is also subject to the
grant filter. Owners and admins keep their full household motion history.
History deletion and the household audit endpoint remain administrator-only.

Home's recent-motion preview clears stale data after a failed refresh and lets
the user retry.

## Consequences

The history query and camera grant lookup are separate reads, as they are for
other viewer camera operations. Revocation invalidates sessions and subsequent
requests use current grants. A concurrent grant change could race with an
in-flight history request; this does not expand the response beyond the grants
resolved for that request.
