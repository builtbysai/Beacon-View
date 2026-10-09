# ADR 0090: Live-view interaction and alert links

- Status: Accepted (part of the October 8, 2026 convenience batch, ADR 0089)
- Date: 2026-10-08

## Decision

This covers items C2, C3, C4, C5, C9 and C12 of the batch.

- **Zoom and pan (C3).** The mouse wheel, a two-finger pinch, a drag (when
  zoomed) and a double-click or double-tap zoom the live picture up to 6x.
  The picture always covers the frame, with no empty margins. The zoom is
  local to the viewer and resets for each camera. A "Reset zoom" chip shows
  while zoomed.
- **Snapshot (C4).** A button and the `S` key draw the video's current frame
  into a PNG and save it through the browser's normal download. **Nothing is
  uploaded and Beacon stores nothing.** The button is disabled while the
  camera is paused (privacy mode).
- **Hold-to-talk (C5).** The Talk button and the `T` key do both jobs. A
  press of at least 400 ms is a hold: talking stops when it is released. A
  shorter press is a tap: talking stays on until the next tap. Enter or Space
  on the focused button toggles, as before. Talk still needs the camera's
  Talk grant, and the camera still shows its notice.
- **Keyboard shortcuts (C2).** F full screen, P floating window, M listen,
  T talk, S snapshot, + - 0 zoom, left and right arrows for the previous or
  next camera (they pan when zoomed), ? for the list. Modified keys are never
  shortcuts. Typing in a field, or having a dialog open, switches them off.
  The same code runs in the desktop app.
- **PWA shortcuts (C9).** The web app manifest gains Cameras, Activity and
  Add a camera shortcuts for installed apps. A camera wall shortcut arrives
  with C1.
- **Alerts open the right camera (C12).** Push payloads stay generic (ADR
  0044: version, opaque event ID, category, generic route), so no camera
  identity travels through the push provider. Instead:
  - the service worker and the desktop app open `/activity?alert=<eventId>`
  - once signed in, the app asks `GET /api/notification-events/:eventId`
  - the server answers only for that user's own event, and names a camera
    only if the user can still access it
  - the app opens that camera's live view, or Activity when there is none
    (a security alert, an expired alert, a camera the user lost access to)
  - the ID is removed from the address so a reload doesn't reopen it

## Consequences

- No migration. The new endpoint is read-only and scoped to the signed-in
  user, with `Cache-Control: no-store`.
- Android alerts open the camera too (ADR 0095).
- Zoom does not apply inside a picture-in-picture window (the browser draws
  that window itself).
