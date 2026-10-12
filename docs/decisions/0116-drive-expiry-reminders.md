# ADR 0116: Remind the owner when Google Drive stops working

- Status: Accepted (2026-10-12)

## Context

Google can stop accepting the Drive connection (access removed in the Google account, six months unused, a
password change). Until now Beacon only noticed when someone tried to record or opened Settings, and the owner
learned about it as a failed clip.

## Decision

- The backend checks every owner's live connection hourly (the existing health check, which already refreshes at
  most hourly per owner) and marks it expired, with an audit entry, when Google rejects it.
- An owner whose connection expired gets an email at once, then another every three days, five in total. It
  names what stopped working (new clips cannot be saved; clips already in Drive are safe) and links to
  Settings, Data & storage. A reconnect clears the history, so a later expiry starts again from the first email.
  Nothing is sent if email delivery is not configured.
- The web app shows a banner on every page while the connection is expired, with a Reconnect button that
  connects in place. It can be put away for the visit and returns on the next one. The Android app shows the
  same banner on its home screens; because the phone app cannot run Google's consent screen for Drive, its
  button opens the web app's Data & storage settings.
- A push notification was considered and not added: the notification categories are for cameras and security,
  and a storage reminder does not fit them.

## Consequences

- Migration 0040 adds the reminder count and time to the connection record.
- The web app now checks Drive status for the owner on every page (two and a half seconds after load when no
  camera is on screen), instead of only when a record button could be shown.
