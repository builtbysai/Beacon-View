# ADR 0107: Live viewer control bar keeps four controls

- Status: Accepted
- Date: 2026-10-10

## Context

The web live view (browser, installed PWA and the desktop app, which loads the
same viewer) showed up to eleven round buttons in one row, plus a permanent
sleep-timer panel over the top-right of the picture and a separate "stream
details" chip. On a phone the row scrolled sideways, so controls were hidden,
and the panels covered part of the video.

## Decision

- The bar keeps **Audio, Talk, Record and More**. Each is shown only when the
  viewer's permissions and platform allow it, exactly as before.
- **More** is a menu inside the live surface (not a portal, so it remains
  visible in full screen). It has two groups:
  - Camera: pause or resume the camera, switch camera, ignore areas.
  - Viewer options: save snapshot, cast, picture in picture, full screen,
    picture fit (Fit or Fill, remembered on this device), stream details and
    the sleep timer.
- The **sleep timer** controls only this viewer's connection, so it is a viewer
  option. It cycles Off, 15, 30 and 60 minutes. It no longer takes space on the
  picture; only the "finished" notice with **Resume viewing** appears, and only
  after it ends.
- Camera configuration (video quality, orientation, recording preferences,
  motion detection and schedules) already lives in Camera Settings and was not
  duplicated in the viewer. The Android camera fixes capture at 640 by 480 at
  24 frames per second today, so there is no quality choice to move yet.
- Nothing is removed: every control and keyboard shortcut still exists.

## Consequences

- Seven controls take one extra tap. Audio, Talk and Record, the actions used
  during an event, stay one tap away.
- The responsive audit script opens the menu at every viewport and fails if it
  leaves the screen.
