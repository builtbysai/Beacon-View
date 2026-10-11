# Feature notes

Behaviour details moved out of the README (V38). Each section names the decision record that explains it.

## Camera wall

Web/desktop Camera wall supports named camera groups and saved tile order/columns
on the current browser, scoped to account and household (ADR 0098). Open Camera
wall, choose **New group / layout**, select/reorder cameras, then save. Layouts do
not sync across installations. Browser storage failures are explained in the UI.

## Activity, connection details and clips

Activity supports 24-hour, 7-day, 30-day, all-time, and local-calendar Since date
filters with a reset action. Camera/date filters query saved history; text search,
event kinds, counts, and sorting cover loaded pages. Load more extends those
results. Preferences stay local to the account and household.

Connection details provides manual refresh, device connection guidance, and a
local troubleshooting report you can preview and copy. The report omits names,
identifiers, credentials, and raw connection data. It describes a backend status
snapshot; video, audio, and notification delivery require separate checks.
Choose **Check setup** for read-only camera, Drive, and alert-preference checks,
with explicit manual permission and delivery steps. It never starts capture.

Clips offers **Bookmark clip** and **Bookmarked only**. Bookmarks save identifiers
in this browser for the account and household; they do not bypass access or keep
clips past retention. Load more extends the clips searched by these filters.

## Alert snooze and sleep timer

Web/desktop notification settings offer personal per-camera motion-alert snooze
for 15/30/60 minutes and early resume. Server deadlines work while the viewer is
closed. Camera capture and history continue; quiet hours and Home/Away rules still
apply, and problem/security alerts keep their usual behavior. Migration 0037 is
required before rolling out this API change.

Full web/desktop live views offer an optional 15/30/60-minute sleep timer.
Expiry stops this viewing session (including Talk, PiP and Cast), with an explicit
Resume viewing button. It does not pause camera capture and cannot execute while
the browser or computer is suspended; it checks expiry on wake (ADR 0099).
