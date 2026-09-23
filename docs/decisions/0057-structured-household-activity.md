# 0057: Structured household Activity identity

## Decision

Keep household Activity in the existing `audit_events` table. The owner and
administrator API projects `householdId`, `publicDeviceId`, `cameraSourceId`,
`deviceName`, and `sourceName` alongside the existing actor, event type, time,
success flag, and metadata. The source ID is the public camera ID used by the
viewer. Activity resolves current device and source records within the event's
household, while event metadata takes priority for names captured at the time
of a rename, creation, or removal. Missing or deleted identities remain null.

Source synchronization records `camera_source_added` only when a source row is
first inserted. Repeated Android source reports and browser camera registration
update device-reported facing and capabilities without creating Activity noise.
Source removal records the captured public IDs and names. The Activity camera
filter and navigation use the explicit source ID;
navigation is offered only when that source is in the viewer's current camera
list. Source and time filtering happen in the Activity query before pagination,
so a filtered feed can find relevant events beyond the first page.

## Rationale

Audit events already carry household scope, actor, device identity, and durable
timestamps. A second generic timeline store would duplicate these records.
Structured API fields keep the web viewer from guessing identity from optional
metadata strings. Name snapshots retain useful history after renames and
removal. The existing 90 day audit retention and owner/administrator access
rule continue to apply.

## Limits

Older events without a public source ID cannot be filtered or opened as a
specific camera. This is intentional; guessing from names could select the
wrong source. Motion events remain in their dedicated store and are merged by
the web viewer. Recording and sharing events keep their existing metadata and
will receive richer per event fields in a later Activity checkpoint.
