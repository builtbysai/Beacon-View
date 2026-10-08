# ADR 0088: Picture-in-picture and background viewing

- Status: Accepted (owner-requested October 8, 2026)
- Date: 2026-10-08

## Context

The owner asked for picture-in-picture (PiP) on all platforms, with live
video that keeps playing in the background. Before this, a live camera
stopped being visible whenever the person left the app or tab:

- On a phone, leaving the Android app stopped the stream.
- In mobile browsers, a backgrounded tab stops rendering.
- On desktop, minimizing or closing to the tray hid it.

## Decision

The full live view floats in a system PiP window on every platform. It
also floats automatically when the person leaves while a camera is
playing.

- **Web (PWA and browsers):** `usePictureInPicture` adds a picture-in-picture
  button to the full live view.
  - **Chrome and Edge:** the standard API, plus the Media Session
    `enterpictureinpicture` action for automatic floating when the tab is
    hidden.
  - **Safari:** the standard API on macOS, `webkitSetPresentationMode` on
    iPhone and iPad, and the `autopictureinpicture` attribute for automatic
    floating when going Home.
  - **Firefox:** no API, so the button is hidden; Firefox's own PiP toggle
    on the video still works.
  - Media Session metadata names the window and OS controls after the
    camera.
  - Home tiles never float.
  - Closing the live view closes its floating window, since the stream ends.
  - The video element survives reconnects, so the floating window does too.
- **Desktop (Electron):** Chromium's video PiP works in the shell.
  - Minimizing or closing to the tray while a live camera plays floats it.
    The shell runs a fixed script with a user gesture, because Electron
    windows have no tab-hide trigger.
  - Reopening the window docks a video the shell floated. One the person
    floated with the button stays put.
  - A floating camera counts as "in use", so automatic updates (ADR 0085)
    wait.
- **Android:** the live view floats on Home or Recents (Android 12+
  auto-enter; Android 8–11 via the activity's user-leave-hint listener),
  and from a new picture-in-picture button.
  - The floating window shows the video only.
  - Everything lives in the live view (`LivePictureInPicture.kt`), using the
    activity's listener APIs, so no other screen floats.
  - `MainActivity` declares `supportsPictureInPicture` and handles size and
    orientation changes itself. Floating, and also rotating, therefore no
    longer restart the activity and drop the stream. This is safe because
    the UI is Compose (it reads configuration live) and capture runs in
    `CameraForegroundService`.
  - If the person turned PiP off for Beacon in system settings, the button
    says how to turn it back on.

## Privacy and resources

- PiP is viewing only. It never starts capture, and Talk keeps its own
  rules (web Talk stops when the page is hidden).
- Closing the floating window ends the viewing session as before. On
  Android the activity stops, and the stream closes.
- Nothing plays with the screen off. Background viewing means a visible
  floating window, never hidden playback.

## Consequences

- Viewing other pages inside Beacon closes the floating window. A mini
  player that persists across in-app navigation would need the live session
  hoisted out of the live view; it is not part of this change.
- Android behavior was verified on an Android 16 emulator: Home floats the
  live video and it keeps playing, the button floats it, returning restores
  the full view, leaving the live view disables floating, and rotation keeps
  the stream. Android 8–11 rely on the leave-hint path, which was not run on
  a device.
