# ADR 0095: Android and desktop entry points

- Status: Accepted (part of the October 8, 2026 convenience batch, ADR 0089)
- Date: 2026-10-08

## Context

Milestone 2 gave the web viewer (and so the desktop app) zoom, snapshots,
hold-to-talk, and alert links. Milestone 5 brings the same to the Android
viewer, and adds the entry points that skip navigation: launcher shortcuts,
the desktop tray, and Android alert taps.

## Decision

- **Android live view (C3, C4, C5).**
  - **Zoom:** pinch, drag to pan, double tap to reset, up to 6x. The same
    clamping math as the web viewer (no empty margins). The renderer is
    transformed in place; nothing is re-encoded. TalkBack gets Zoom in, Zoom
    out and Reset zoom actions. The floating (picture-in-picture) window
    shows the whole picture.
  - **Snapshot:** the current frame is saved as a PNG to `Pictures/Beacon` on
    the phone (Android 10+; Beacon's own picture folder before that, which
    needs no storage permission). It is never uploaded or sent anywhere, and
    the file name carries the camera name and time.
  - **Hold-to-talk:** the Talk button keeps its tap-to-start, tap-to-stop
    behavior. Holding it for 400 ms or more talks only while it is pressed. A
    touch cancelled by a permission sheet counts as a release. Talking is
    still shown on screen and by Android's microphone indicator.
- **Alerts open the right camera on Android (C12).** The push still carries
  only the opaque event ID (ADR 0044). Tapping it opens the app with that ID;
  once signed in, the app asks `GET /api/notification-events/:eventId` and
  opens the camera live, or Activity when there is none. Each alert now has
  its own pending intent, so a later alert can't rewrite an earlier one's
  target. A target nobody acts on within two minutes is dropped, so a late
  sign-in never jumps to an old alert.
- **Android launcher shortcuts (C10).** Static: Cameras and Activity. Dynamic:
  up to two favorite cameras, which open that camera live. Dynamic shortcuts
  show camera names on the home screen, so they are removed on sign-out.
  Shortcut and alert intents carry only a camera ID, an event ID or a page
  name, each validated before use.
- **Desktop tray (C11).** The web app tells the desktop shell its favorite
  cameras (up to six, the Home favorites or the first four when none are
  chosen). The tray lists them as "Watch <name>", plus "Camera wall" when
  there are two or more. Entries open the camera live in the app. The list is
  validated again in the main process (UUID IDs, short names), and the
  menu only builds same-origin paths. Sign-out clears it. Older desktop apps
  ignore the new bridge method.

## Consequences

- No migration and no new server endpoint (the alert endpoint is ADR 0090's).
- Favorites stay a per-device choice (web localStorage, Android store), so
  the desktop tray follows the favorites of the web app inside it.
- Android snapshots on Android 9 and older stay in the app's own folder.
- Not verified on a real two-finger gesture in the emulator (it cannot
  inject multi-touch without root); the zoom math is unit-tested and the
  wiring is the standard Compose transform gesture detector.
