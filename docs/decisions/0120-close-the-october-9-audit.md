# ADR 0120: Close the October 9 audit

- Status: Accepted (2026-10-12)

## Context

The October 9 audit (findings F1 to F13 and V1 to V90) was worked through over three days. Most findings were fixed and
deployed (ADRs 0106 to 0118). A few were left open on purpose and the long document no longer matched the code.

## Decision

The audit is closed. The long document was replaced by [the closure record](../audit-2026-10-09-closure.md), which
says what happened to each remaining finding. Findings that were fixed keep their ADR as the record.

Fixed in this last pass:

- **V50 restart:** after a phone restarts, or the app is updated, a camera that was running shows a "Beacon camera is
  off, tap to turn it back on" notification. The camera does not start by itself: Android 14 forbids starting a camera
  service from the background, and capture must always be visible to the person with the phone.
- **V79 Activity paging:** the merged timeline hides events older than the point a still-loading feed has reached, so
  nothing appears out of order or goes missing at a page boundary.
- **F2 content-security policy:** `object-src 'none'` and `base-uri 'self'` are now enforced. The wider policy stays
  report-only because the browser sends clips straight to Google Drive and the Cast sender loads Google scripts, and
  enforcing it needs a pass over those flows on real devices. Drive's upload host was added to the report-only policy.

Closed without a change, with the reason in the closure record: V61 (the brightness and rotation fixes are in; the rest
needs field data), V34, V35, V36, V37, F8, F5, V14, V58, V11, V13, V15, V17, V18, V54, V85 and the other Low items.

## Consequences

Anything found later gets its own ADR or issue, not a place in an old audit.
