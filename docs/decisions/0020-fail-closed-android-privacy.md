# ADR 0020: Keep Android privacy paused when synchronization fails

Status: Accepted for local implementation; physical failure testing remains open.

## Context

Android stopped capture before sending a local privacy request, but resumed it on
a network failure. A late viewer callback could also call the preview factory
without checking privacy. A motion report racing with privacy returned 401, which
made Android discard a valid device pairing.

## Decision

Keep an explicit local privacy gate. A local pause blocks capture immediately and
persists an unconfirmed pause flag after media shutdown. Failed synchronization
leaves the camera and microphone off. The service restores that flag on restart and
retries synchronization through its existing heartbeat loop. Confirmation of privacy
on, or a successful explicit Resume request, clears pending intent. A remote resume
cannot override an unconfirmed local pause.

The capture factory checks the gate, including calls from late viewer-ready events.
Local privacy requests are serialized, stale request completions are ignored, and
HTTP responses do not override newer observed signaling state. Startup snapshots
are accepted only when no privacy decision changed since their request began.

Privacy remains available even when microphone or notification permission is absent.
The camera UI distinguishes capture being off locally from server synchronization
still being pending. No new permission, media collection, or background service is
introduced. The existing foreground notification remains visible.

Motion ingestion still rejects unauthorized, disabled, private, or unavailable
sources. For a valid, non-revoked device credential, a suppressed source report
returns 409 without storing an event. Android treats this as a terminal report
outcome without discarding pairing. Invalid and revoked credentials still return
401 and trigger the existing pairing-required path. Foreign and missing sources
receive the same generic unavailable response for valid device credentials.

## Validation and limitations

Android unit tests cover failed pause and resume, pending intent across reconstructed
state, duplicate actions, stale HTTP/startup responses, newer remote pauses, and
motion response classification. PostgreSQL API tests verify no event is stored while
privacy is on, valid pairing remains intact, and invalid/revoked credentials remain
unauthorized. Debug and unsigned release builds and Android lint are required.

Physical confirmation of the capture indicators during network loss, process restart,
and recovery remains required. The preference write is checked and a generic failure
is logged; Android storage failure or app-data removal cannot guarantee retention of
local intent. This does not establish a globally versioned privacy protocol or replace
cross-device race and reconnect acceptance.
